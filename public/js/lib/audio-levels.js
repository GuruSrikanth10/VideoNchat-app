// Audio levels from the Web Audio API: the lobby's microphone meter and
// the "speaking" highlight on tiles. Browsers only run audio after the
// person interacts with the page, so meters start on the first gesture.

let context = null;
const waiting = [];

function startContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;
    context = new AudioContextClass();
    for (const start of waiting.splice(0)) start();
  }
  if (context.state === "suspended") context.resume().catch(() => {});
}

for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, startContext, { capture: true, passive: true });
}

// Calls onLevel(0..1) about ten times a second while the track plays.
export class LevelMeter {
  #source = null;
  #timer = null;
  #stopped = false;

  constructor(track, onLevel) {
    const start = () => {
      if (this.#stopped) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      this.#source = context.createMediaStreamSource(new MediaStream([track]));
      this.#source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.#timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      }, 100);
    };
    if (context) start();
    else waiting.push(start);
  }

  stop() {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#source?.disconnect();
  }
}

// Calls onChange(true/false) when someone starts or stops speaking, with a
// little hysteresis so the highlight doesn't flicker between words.
export class SpeakingDetector {
  #meter;

  constructor(track, onChange, { threshold = 0.12, onDelay = 150, offDelay = 700 } = {}) {
    let speaking = false;
    let changingSince = 0;
    this.#meter = new LevelMeter(track, (level) => {
      const loud = level > threshold;
      if (loud === speaking) {
        changingSince = 0;
        return;
      }
      const now = Date.now();
      changingSince ||= now;
      if (now - changingSince >= (loud ? onDelay : offDelay)) {
        speaking = loud;
        changingSince = 0;
        onChange(speaking);
      }
    });
  }

  stop() {
    this.#meter.stop();
  }
}
