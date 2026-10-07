// Screen sharing as a small state machine: idle -> requesting -> sharing.
// The capture always stops when sharing ends, whether from our own button
// or the browser's "Stop sharing" bar.

export class ScreenShare extends EventTarget {
  state = "idle";
  track = null;
  stream = null;

  static supported() {
    return Boolean(navigator.mediaDevices?.getDisplayMedia);
  }

  get active() {
    return this.state === "sharing";
  }

  // Resolves to true if sharing started, false if the person cancelled.
  async start() {
    if (this.state !== "idle") return this.active;
    this.state = "requesting";
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      this.track = this.stream.getVideoTracks()[0];
      this.track.contentHint = "detail"; // favour sharp text over motion
      this.track.addEventListener("ended", () => this.stop());
      this.state = "sharing";
      this.#emit();
      return true;
    } catch (err) {
      this.state = "idle";
      if (err.name === "NotAllowedError" || err.name === "AbortError") return false;
      throw err;
    }
  }

  stop() {
    if (this.state !== "sharing") return;
    this.track.stop();
    this.track = null;
    this.stream = null;
    this.state = "idle";
    this.#emit();
  }

  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
