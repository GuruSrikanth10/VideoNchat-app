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
  // "user" (front) or "environment" (back) once someone switches cameras.
  facingMode = null;
  // Audio and video effects, applied now and whenever a device restarts.
  effects = { noiseSuppression: true, backgroundBlur: false };

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

  // Which way the camera faces, as far as we can tell.
  get facing() {
    return this.camera?.getSettings?.().facingMode || this.facingMode || "user";
  }

  // Switches between the front and back cameras (on phones and tablets).
  async flipCamera() {
    const previous = this.facing;
    const next = previous === "environment" ? "user" : "environment";
    this.deviceIds.videoinput = null;
    if (!this.cameraEnabled || !this.camera) {
      this.facingMode = next; // used next time the camera starts
      this.#emit("change");
      return true;
    }
    // Many phones can't open both cameras at once, so stop this one first.
    this.camera.stop();
    for (const facingMode of [{ exact: next }, previous]) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { ...VIDEO, facingMode },
        });
        this.facingMode = facingMode === previous ? previous : next;
        this.#setTrack("camera", stream.getVideoTracks()[0]);
        this.#emit("change");
        return this.facingMode === next;
      } catch (err) {
        this.error = err; // try to get the old camera back
      }
    }
    this.cameraEnabled = false;
    this.#setTrack("camera", null);
    this.#emit("change");
    return false;
  }

  // Switches to another camera or microphone without leaving the call.
  async useDevice(kind, deviceId) {
    this.deviceIds[kind] = deviceId;
    if (kind === "videoinput") this.facingMode = null; // the device decides
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

  // Turns the microphone's noise suppression on or off.
  async setNoiseSuppression(on) {
    this.effects.noiseSuppression = on;
    if (!this.mic) return true; // applied when the mic starts
    await this.tuneMic({ noiseSuppression: on });
    if (this.mic.getSettings().noiseSuppression === on) return true;
    // Some browsers (Chrome) can't change it on a live track, so the same
    // microphone is opened again. The old track has to stop first: while it
    // runs, Chrome hands back the same source with the old setting.
    const { deviceId } = this.mic.getSettings();
    this.mic.stop();
    for (const setting of [on, !on]) {
      this.effects.noiseSuppression = setting;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...this.#constraints("audioinput", AUDIO),
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
        });
        const track = stream.getAudioTracks()[0];
        track.enabled = this.micEnabled;
        this.#setTrack("mic", track);
        this.#emit("change");
        return setting === on;
      } catch (err) {
        this.error = err; // try to get the mic back as it was
      }
    }
    this.#setTrack("mic", null);
    this.#emit("change");
    return false;
  }

  // Whether the camera can blur the background by itself, as some browsers
  // can on some systems. Nothing leaves the device either way.
  get canBlur() {
    const blur = this.camera?.getCapabilities?.().backgroundBlur;
    return Array.isArray(blur) && blur.includes(true);
  }

  async setBackgroundBlur(on) {
    this.effects.backgroundBlur = on;
    if (!this.camera) return true; // applied when the camera starts
    if (!this.canBlur) return false;
    try {
      await this.camera.applyConstraints({ ...this.camera.getConstraints(), backgroundBlur: on });
      return true;
    } catch {
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
  #constraints(kind, defaults, { preferred = false } = {}) {
    const base = { ...defaults };
    if (kind === "audioinput") base.noiseSuppression = this.effects.noiseSuppression;
    // Only asked for when wanted; browsers that can't blur ignore it.
    if (kind === "videoinput" && this.effects.backgroundBlur) base.backgroundBlur = true;
    const chosen = this.deviceIds[kind];
    if (chosen) return { ...base, deviceId: { exact: chosen } };
    if (kind === "videoinput" && this.facingMode) return { ...base, facingMode: this.facingMode };
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
