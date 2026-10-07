// Live captions of your own speech, made by the browser's speech
// recognition (the Web Speech API). Some browsers, Chrome among them, send
// the audio to their speech service to do this, so it's only ever on when
// you turn it on.
const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

export class SpeechCaptioner {
  #recognition = null;
  #wanted = false;
  #paused = false;
  #onCaption;
  #onError;

  static supported() {
    return typeof Recognition === "function";
  }

  // onCaption({ text, final }) gets each update; onError(name) is called
  // when captions can't go on (e.g. "not-allowed").
  constructor({ onCaption, onError = () => {}, lang = navigator.language }) {
    this.#onCaption = onCaption;
    this.#onError = onError;
    if (!SpeechCaptioner.supported()) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.addEventListener("result", (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript.trim();
        if (text) this.#onCaption({ text, final: result.isFinal });
      }
    });
    recognition.addEventListener("error", (event) => {
      // Silence and brief network trouble are normal; anything else stops.
      if (event.error === "no-speech" || event.error === "aborted" || event.error === "network") {
        return;
      }
      this.#wanted = false;
      this.#onError(event.error);
    });
    // Recognition ends by itself every so often; keep it going (after a
    // moment, so being offline doesn't make it spin).
    recognition.addEventListener("end", () => {
      setTimeout(() => {
        if (this.#wanted && !this.#paused) this.#start();
      }, 300);
    });
    this.#recognition = recognition;
  }

  get active() {
    return this.#wanted;
  }

  start() {
    this.#wanted = true;
    if (!this.#paused) this.#start();
  }

  stop() {
    this.#wanted = false;
    this.#recognition?.abort();
  }

  // While you're muted, nothing is listened to.
  setPaused(paused) {
    if (paused === this.#paused) return;
    this.#paused = paused;
    if (paused) this.#recognition?.abort();
    else if (this.#wanted) this.#start();
  }

  #start() {
    try {
      this.#recognition?.start();
    } catch {
      // already started
    }
  }
}
