# ADR 0001: Native WebRTC signalled over Socket.IO

- Status: accepted (implemented in Phase 2)
- Date: 2026-10-07

## Context

Calls used PeerJS for WebRTC signalling and Socket.IO for presence and
chat. That meant two realtime channels and two identities per person: a
socket ID and a PeerJS ID that the server had to trust. It caused several
problems:

- The PeerJS server's WebSocket handling broke Socket.IO's WebSocket
  upgrade.
- PeerJS auto-answered calls from anyone.
- `peer.call()` needs a local stream, so people without a camera couldn't
  start connections.
- There was little control over renegotiation and ICE restarts.
- The `peer` server package's last stable release was in December 2023.

## Options

1. **Keep PeerJS** (with the Phase 0 fixes): the smallest change. It
   keeps every limitation above.
2. **Native `RTCPeerConnection`, signalled over the existing Socket.IO
   connection**: one channel and server-assigned identity. It adds
   watch-only participants, ICE restarts and two fewer dependencies, at
   the cost of about 300 lines of negotiation code that we own.
3. **An SFU** (LiveKit, mediasoup): scales well beyond 6 people, but it
   needs extra infrastructure and cost, and is overkill for small rooms.

## Decision

Option 2. Signalling follows MDN's perfect negotiation pattern. Every
connection carries a fixed set of three transceivers (microphone, camera,
screen) whose tracks are swapped with `replaceTrack()`, so devices and
presenting change without renegotiation. The server stamps the sender on
every signal and only relays within a room. While a participant
reconnects, signals for them are queued.

## Consequences

- Rooms are a full mesh, so they're capped (`MAX_ROOM_SIZE`, default 6).
  Video bitrate drops as rooms grow. Moving to an SFU (option 3) is the
  path if larger rooms become a goal, and the protocol's
  membership/identity layer would carry over.
- Without a TURN server, people behind strict NATs can't connect. Set
  `TURN_URLS`/`TURN_SECRET` or `ICE_SERVERS` (see `.env.example`).
- The end-to-end suite (Chromium and Firefox with fake media) is what
  keeps the negotiation code honest.
