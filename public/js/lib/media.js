// The local camera and microphone. Falls back from camera + mic, to mic
// only, to camera only, to nothing (watch-only), and keeps going when
// devices are unplugged.

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };

export class LocalMedia extends EventTarget {
  mic = null;
  camera = null;
  micEnabled = true;
  cameraEnabled = true;
  error = null; // the getUserMedia error, if devices couldn't start
  deviceIds = { audioinput: null, videoinput: null, audiooutput: null };
  // Devices chosen last time: asked for, but not required, at start.
  preferred = {};

  // The self view shows whatever the camera currently is.
  stream = new MediaStream();

  static supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async start({ audio = true, video = true } = {}) {
    if (!LocalMedia.supported()) {
      this.error = { name: "SecurityError" };
      return this.error;
    }
    const attempts = [
      { audio, video },
      ...(audio && video
        ? [
            { audio: true, video: false },
            { audio: false, video: true },
          ]
        : []),
    ].filter((a) => a.audio || a.video);

    let firstError = null;
    for (const attempt of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: attempt.audio && this.#constraints("audioinput", AUDIO, { preferred: true }),
          video: attempt.video && this.#constraints("videoinput", VIDEO, { preferred: true }),
        });
        this.#setTrack("mic", stream.getAudioTracks()[0] ?? null);
        this.#setTrack("camera", stream.getVideoTracks()[0] ?? null);
        this.micEnabled = Boolean(this.mic);
        this.cameraEnabled = Boolean(this.camera);
        // A partial success is still worth reporting (e.g. no camera).
        this.error = attempt.audio === audio && attempt.video === video ? null : firstError;
        this.#emit("change");
        return this.error;
      } catch (err) {
        firstError ??= err;
        // Permission denied applies to every attempt; don't ask again.
        if (err.name === "NotAllowedError" || err.name === "SecurityError") break;
      }
    }
    this.micEnabled = false;
    this.cameraEnabled = false;
    this.error = firstError;
    this.#emit("change");
    return this.error;
  }

  setMicEnabled(enabled) {
    if (!this.mic) return false;
    this.micEnabled = enabled;
    this.mic.enabled = enabled;
    this.#emit("change");
    return true;
  }

  // Turning the camera off stops it, so its light goes out too.
  async setCameraEnabled(enabled) {
    if (enabled === this.cameraEnabled) return true;
    if (!enabled) {
      this.cameraEnabled = false;
      this.camera?.stop();
      this.#setTrack("camera", null);
      this.#emit("change");
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: this.#constraints("videoinput", VIDEO),
      });
      this.cameraEnabled = true;
      this.#setTrack("camera", stream.getVideoTracks()[0]);
      this.#emit("change");
      return true;
    } catch (err) {
      this.error = err;
      this.#emit("change");
      return false;
    }
  }

  async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      audioinput: devices.filter((d) => d.kind === "audioinput"),
      videoinput: devices.filter((d) => d.kind === "videoinput"),
      audiooutput: devices.filter((d) => d.kind === "audiooutput"),
    };
  }

  // Switches to another camera or microphone without leaving the call.
  async useDevice(kind, deviceId) {
    this.deviceIds[kind] = deviceId;
    if (kind === "audiooutput") {
      this.#emit("change");
      return true;
    }
    const isAudio = kind === "audioinput";
    if (!isAudio && !this.cameraEnabled) return true; // used next time it's on
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        isAudio
          ? { audio: this.#constraints(kind, AUDIO) }
          : { video: this.#constraints(kind, VIDEO) },
      );
      const track = isAudio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (isAudio) {
        this.mic?.stop();
        track.enabled = this.micEnabled;
        this.#setTrack("mic", track);
      } else {
        this.camera?.stop();
        this.#setTrack("camera", track);
      }
      this.#emit("change");
      return true;
    } catch (err) {
      this.error = err;
      return false;
    }
  }

  // Applies a constraint (e.g. noiseSuppression) to the live microphone.
  async tuneMic(constraints) {
    try {
      await this.mic?.applyConstraints({ ...this.mic.getConstraints(), ...constraints });
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.mic?.stop();
    this.camera?.stop();
  }

  // An explicitly chosen device is required ("exact"); a remembered one
  // is only preferred ("ideal"), so a missing device can't break startup.
  #constraints(kind, base, { preferred = false } = {}) {
    const chosen = this.deviceIds[kind];
    if (chosen) return { ...base, deviceId: { exact: chosen } };
    const remembered = preferred ? this.preferred[kind] : null;
    return remembered ? { ...base, deviceId: { ideal: remembered } } : base;
  }

  #setTrack(slot, track) {
    const old = this[slot];
    if (old) this.stream.removeTrack(old);
    this[slot] = track;
    if (track) {
      this.stream.addTrack(track);
      // An unplugged device ends its track: fall back to the default one.
      track.addEventListener("ended", () => {
        if (this[slot] !== track) return;
        this.#setTrack(slot, null);
        this.deviceIds[slot === "mic" ? "audioinput" : "videoinput"] = null;
        this.#emit("deviceended", { slot });
        if (slot === "camera" && this.cameraEnabled) {
          this.cameraEnabled = false;
          this.setCameraEnabled(true);
        } else if (slot === "mic") {
          this.useDevice("audioinput", null);
        }
        this.#emit("change");
      });
    }
    this.#emit("trackchange", { slot, track });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
