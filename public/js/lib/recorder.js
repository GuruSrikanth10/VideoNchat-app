// Records the call on this device: every tile drawn onto one canvas, and
// everyone's audio mixed together. The file is saved when it stops; nothing
// is uploaded anywhere.
import { bestGrid } from "../ui/tiles.js";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const GAP = 8;
const TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export class CallRecorder {
  #getTiles;
  #getAudioTracks;
  #canvas = null;
  #context = null;
  #audio = null;
  #mix = null;
  #sources = new Map(); // track -> audio source node
  #recorder = null;
  #chunks = [];
  #clock = null;
  #frames = 0;

  static supported() {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof AudioContext !== "undefined" &&
      "captureStream" in HTMLCanvasElement.prototype &&
      TYPES.some((type) => MediaRecorder.isTypeSupported(type))
    );
  }

  // getTiles() lists what to draw: [{ video, name, videoOff, screen }].
  // getAudioTracks() lists every audio track to mix in.
  constructor({ getTiles, getAudioTracks }) {
    this.#getTiles = getTiles;
    this.#getAudioTracks = getAudioTracks;
  }

  get active() {
    return this.#recorder?.state === "recording";
  }

  start() {
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = WIDTH;
    this.#canvas.height = HEIGHT;
    this.#context = this.#canvas.getContext("2d");
    this.#audio = new AudioContext();
    this.#mix = this.#audio.createMediaStreamDestination();
    this.#syncAudio();
    this.#draw();

    const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const stream = new MediaStream([
      ...this.#canvas.captureStream(FPS).getVideoTracks(),
      ...this.#mix.stream.getAudioTracks(),
    ]);
    this.#chunks = [];
    this.#recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
    this.#recorder.addEventListener("dataavailable", ({ data }) => {
      if (data.size) this.#chunks.push(data);
    });
    this.#recorder.start(1000);

    this.#clock = new Worker("/js/lib/recorder-clock.js");
    this.#clock.addEventListener("message", () => this.#tick());
    this.#clock.postMessage(Math.round(1000 / FPS));
  }

  // Resolves to the recording as a Blob.
  stop() {
    const recorder = this.#recorder;
    if (!recorder) return Promise.resolve(null);
    this.#clock?.terminate();
    this.#clock = null;
    return new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const blob = new Blob(this.#chunks, { type: recorder.mimeType });
          for (const track of recorder.stream.getTracks()) track.stop();
          for (const source of this.#sources.values()) source.disconnect();
          this.#sources.clear();
          this.#audio.close().catch(() => {});
          this.#recorder = null;
          resolve(blob);
        },
        { once: true },
      );
      recorder.stop();
    });
  }

  #tick() {
    this.#draw();
    // People come and go; check the audio mix a few times a second.
    if (++this.#frames % 6 === 0) this.#syncAudio();
  }

  #syncAudio() {
    const tracks = new Set(this.#getAudioTracks().filter((t) => t.readyState === "live"));
    for (const [track, source] of this.#sources) {
      if (!tracks.has(track)) {
        source.disconnect();
        this.#sources.delete(track);
      }
    }
    for (const track of tracks) {
      if (this.#sources.has(track)) continue;
      const source = this.#audio.createMediaStreamSource(new MediaStream([track]));
      source.connect(this.#mix);
      this.#sources.set(track, source);
    }
  }

  // A shared screen gets most of the frame; otherwise everyone is in a grid.
  #draw() {
    const ctx = this.#context;
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const tiles = this.#getTiles();
    if (!tiles.length) return;
    const screen = tiles.find((tile) => tile.screen);
    if (screen && tiles.length > 1) {
      const others = tiles.filter((tile) => tile !== screen);
      const side = Math.round(WIDTH * 0.22);
      this.#drawTile(screen, GAP, GAP, WIDTH - side - GAP * 3, HEIGHT - GAP * 2);
      const height = Math.min((HEIGHT - GAP * (others.length + 1)) / others.length, side * 0.75);
      others.forEach((tile, i) =>
        this.#drawTile(tile, WIDTH - side - GAP, GAP + i * (height + GAP), side, height),
      );
      return;
    }
    // The same 16:9 grid as the call's stage, centred in the frame.
    const { cols, rows, tileWidth } = bestGrid(
      tiles.length,
      WIDTH - GAP * 2,
      HEIGHT - GAP * 2,
      16 / 9,
      GAP,
    );
    const width = tileWidth;
    const height = tileWidth / (16 / 9);
    const top = (HEIGHT - (rows * height + (rows - 1) * GAP)) / 2;
    tiles.forEach((tile, i) => {
      const row = Math.floor(i / cols);
      // A short last row is centred too.
      const inRow = Math.min(cols, tiles.length - row * cols);
      const left = (WIDTH - (inRow * width + (inRow - 1) * GAP)) / 2;
      this.#drawTile(
        tile,
        left + (i % cols) * (width + GAP),
        top + row * (height + GAP),
        width,
        height,
      );
    });
  }

  #drawTile({ video, name, videoOff, screen }, x, y, width, height) {
    const ctx = this.#context;
    ctx.fillStyle = "#181b21";
    ctx.fillRect(x, y, width, height);
    if (!videoOff && video.readyState >= 2 && video.videoWidth) {
      // Screens are shown whole; cameras fill the tile.
      const scale = (screen ? Math.min : Math.max)(
        width / video.videoWidth,
        height / video.videoHeight,
      );
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.drawImage(video, x + (width - w) / 2, y + (height - h) / 2, w, h);
      ctx.restore();
    } else {
      const radius = Math.min(width, height) * 0.18;
      ctx.fillStyle = "#2f62e9";
      ctx.beginPath();
      ctx.arc(x + width / 2, y + height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.round(radius * 0.8)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(name), x + width / 2, y + height / 2);
    }
    // The name, bottom left.
    ctx.font = "500 16px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = name.length > 40 ? `${name.slice(0, 39)}…` : name;
    const labelWidth = ctx.measureText(label).width + 20;
    ctx.fillStyle = "rgb(0 0 0 / 60%)";
    ctx.fillRect(x + 8, y + height - 36, labelWidth, 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 18, y + height - 22);
  }
}

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("") || "?";

// Saves a recording through the browser's downloads.
export function saveRecording(blob, name) {
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
