// One RTCPeerConnection per remote participant (a "full mesh"), signalled
// over Socket.IO using the "perfect negotiation" pattern from MDN.
//
// Every connection carries the same three transceivers, in this order:
//   0: microphone, 1: camera, 2: screen share
// Local tracks are swapped in with replaceTrack(), so muting, turning the
// camera on or off, switching devices and sharing the screen never need a
// renegotiation. Transceivers are always sendrecv, so someone without a
// camera still receives everyone else's video.

export const SLOTS = ["mic", "camera", "screen"];
const KIND = { mic: "audio", camera: "video", screen: "video" };

// Video bitrate per sender, by how many people are in the call. Everyone
// uploads one stream per participant, so quality goes down as rooms grow.
export function videoLimitsFor(participantCount) {
  if (participantCount <= 2) return { maxBitrate: 1_500_000, scaleResolutionDownBy: 1 };
  if (participantCount === 3) return { maxBitrate: 1_000_000, scaleResolutionDownBy: 1 };
  if (participantCount === 4) return { maxBitrate: 700_000, scaleResolutionDownBy: 1.5 };
  return { maxBitrate: 450_000, scaleResolutionDownBy: 2 };
}

export class PeerMesh extends EventTarget {
  #peers = new Map();
  #tracks = { mic: null, camera: null, screen: null };
  #selfId;
  #send;
  #iceServers;
  #videoLimits = videoLimitsFor(2);

  // send(signal) delivers { to, description | candidate } to the server.
  constructor({ selfId, send, iceServers = [] }) {
    super();
    this.#selfId = selfId;
    this.#send = send;
    this.#iceServers = iceServers;
  }

  setIceServers(iceServers) {
    this.#iceServers = iceServers;
  }

  // Starts a connection to someone already in the room: we make the offer.
  call(remoteId) {
    this.#ensure(remoteId, true);
  }

  has(remoteId) {
    return this.#peers.has(remoteId);
  }

  ids() {
    return [...this.#peers.keys()];
  }

  // Remote streams for a participant: { media: mic + camera, screen }.
  streams(remoteId) {
    const peer = this.#peers.get(remoteId);
    return peer ? { media: peer.media, screen: peer.screen } : null;
  }

  connection(remoteId) {
    return this.#peers.get(remoteId)?.pc ?? null;
  }

  // Sends `track` (or nothing, if null) in `slot` to everyone.
  setTrack(slot, track) {
    this.#tracks[slot] = track;
    for (const peer of this.#peers.values()) this.#applyTrack(peer, slot);
  }

  setVideoLimits(limits) {
    this.#videoLimits = limits;
    for (const peer of this.#peers.values()) this.#applyVideoLimits(peer);
  }

  async handleSignal({ from, description, candidate }) {
    const peer = this.#ensure(from, false);
    const { pc } = peer;
    try {
      if (description) {
        const readyForOffer =
          !peer.makingOffer &&
          (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;
        // On a collision the impolite side ignores the other offer; the
        // polite side rolls its own back (setRemoteDescription does that).
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        peer.isSettingRemoteAnswerPending = description.type === "answer";
        await pc.setRemoteDescription(description);
        peer.isSettingRemoteAnswerPending = false;
        if (description.type === "offer") {
          for (const slot of SLOTS) this.#applyTrack(peer, slot);
          await pc.setLocalDescription();
          this.#send({ to: from, description: pc.localDescription.toJSON() });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn("WebRTC signalling failed:", err);
    }
  }

  remove(remoteId) {
    const peer = this.#peers.get(remoteId);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    this.#peers.delete(remoteId);
    peer.pc.close();
  }

  closeAll() {
    for (const id of this.ids()) this.remove(id);
  }

  #ensure(remoteId, initiator) {
    const existing = this.#peers.get(remoteId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.#iceServers });
    const peer = {
      id: remoteId,
      pc,
      // IDs are compared so both sides agree on who is polite.
      polite: this.#selfId > remoteId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      media: new MediaStream(),
      screen: new MediaStream(),
      restartTimer: null,
    };
    this.#peers.set(remoteId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.#send({ to: remoteId, description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn("Creating a WebRTC offer failed:", err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.#send({ to: remoteId, candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ transceiver, track }) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(transceiver)];
      if (!slot) return;
      const stream = slot === "screen" ? peer.screen : peer.media;
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      this.#emit("track", { id: remoteId, slot, track });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      clearTimeout(peer.restartTimer);
      if (state === "connected") this.#applyVideoLimits(peer);
      // A failed connection gets new ICE candidates (e.g. after a network
      // change). "disconnected" often heals by itself, so wait a little.
      if (state === "failed") pc.restartIce();
      if (state === "disconnected") {
        peer.restartTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") pc.restartIce();
        }, 4000);
      }
      this.#emit("state", { id: remoteId, state });
    };

    if (initiator) {
      for (const slot of SLOTS) {
        pc.addTransceiver(this.#tracks[slot] ?? KIND[slot], { direction: "sendrecv" });
      }
    }
    return peer;
  }

  #applyTrack(peer, slot) {
    const transceiver = peer.pc.getTransceivers()[SLOTS.indexOf(slot)];
    if (!transceiver || transceiver.stopped) return;
    if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
    const track = this.#tracks[slot];
    if (transceiver.sender.track !== track) {
      transceiver.sender.replaceTrack(track).catch(() => {});
    }
  }

  async #applyVideoLimits(peer) {
    const sender = peer.pc.getTransceivers()[SLOTS.indexOf("camera")]?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      Object.assign(params.encodings[0], this.#videoLimits);
      await sender.setParameters(params);
    } catch {
      // Not every browser allows this before the first frame; it's an
      // optimisation, so carry on.
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
