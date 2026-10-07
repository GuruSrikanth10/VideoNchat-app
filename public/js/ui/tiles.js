// The video stage: one tile per participant (and per shared screen),
// keyed by ID.
//
// Layouts:
// - grid: every tile the same size, as large as the stage allows. The best
//   number of columns is computed from the stage's size and kept up to
//   date as it changes.
// - focus: one tile (a pinned person, or else a shared screen) takes most
//   of the stage, and the others sit in a strip beside or below it.
import { icon, setIcon } from "./icons.js";
import { describe } from "../lib/stats.js";
import { strings } from "../strings.js";

const GAP = 12;

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("") || "?";

// The column count that makes tiles largest, for `count` tiles of the
// given aspect ratio in a width x height box. Exported for tests.
export function bestGrid(count, width, height, aspect, gap = GAP) {
  let best = { cols: 1, rows: 1, tileWidth: 0 };
  for (let cols = 1; cols <= Math.max(count, 1); cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    const byHeight = ((height - gap * (rows - 1)) / rows) * aspect;
    const tileWidth = Math.max(0, Math.min(byWidth, byHeight));
    if (tileWidth > best.tileWidth) best = { cols, rows, tileWidth };
  }
  return best;
}

export class Tiles {
  #root;
  #tiles = new Map();
  #pinned = null;
  #onFlipCamera;
  #onFirstFrame;

  // onFlipCamera() is called by your own tile's "Switch camera" button, and
  // onFirstFrame(id) when someone's video first shows a picture.
  constructor(root, { onFlipCamera = () => {}, onFirstFrame = () => {} } = {}) {
    this.#root = root;
    this.#onFlipCamera = onFlipCamera;
    this.#onFirstFrame = onFirstFrame;
    new ResizeObserver(() => this.#relayout()).observe(root);
  }

  // Creates or updates a participant's tile. For your own tile, `mirrored`
  // flips the video like a mirror and `canFlip` offers a camera switch.
  upsert(
    id,
    { name, self = false, stream, audio, video, hand, quality, stats, mirrored, canFlip },
  ) {
    let tile = this.#tiles.get(id);
    if (!tile) {
      tile = this.#create(id, { self });
      this.#tiles.set(id, tile);
      this.#root.append(tile.root);
      this.#relayout();
    }
    if (name !== undefined) {
      tile.name = name;
      const label = self || tile.self ? strings.tiles.you(name) : name;
      tile.label.textContent = label;
      tile.initials.textContent = initials(name);
      tile.root.setAttribute("aria-label", label);
      this.#labelActions(tile);
    }
    if (stream && tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      this.#play(tile.video);
    }
    if (audio !== undefined) {
      tile.root.dataset.muted = String(!audio);
      // <svg> has no `hidden` property, so toggle the attribute.
      tile.micState.toggleAttribute("hidden", audio);
    }
    if (video !== undefined) tile.root.dataset.videoOff = String(!video);
    if (hand !== undefined) {
      tile.root.dataset.hand = String(Boolean(hand));
      tile.handState.toggleAttribute("hidden", !hand);
    }
    if (mirrored !== undefined) tile.video.classList.toggle("tile__video--mirrored", mirrored);
    if (canFlip !== undefined && tile.buttons.flip) tile.buttons.flip.hidden = !canFlip;
    if (quality !== undefined) {
      tile.quality.dataset.quality = quality ?? "unknown";
      tile.quality.title = describe(stats ?? { rtt: null, lossPercent: null, kbps: null }, quality);
      tile.quality.setAttribute("aria-label", tile.quality.title);
    }
    return tile;
  }

  // A participant's shared screen gets its own tile, in the spotlight.
  showScreen(id, { name, stream, self = false }) {
    const key = `screen:${id}`;
    let tile = this.#tiles.get(key);
    if (!tile) {
      tile = this.#create(key, { screen: true });
      this.#tiles.set(key, tile);
      this.#root.prepend(tile.root);
    }
    tile.name = self ? strings.tiles.yourScreen : strings.tiles.screenOf(name);
    tile.label.textContent = tile.name;
    tile.root.setAttribute("aria-label", tile.name);
    this.#labelActions(tile);
    if (tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      this.#play(tile.video);
    }
    this.#relayout();
  }

  hideScreen(id) {
    this.remove(`screen:${id}`);
  }

  // What a recording draws: every tile, screens first.
  snapshot() {
    return [...this.#tiles.values()]
      .map((tile) => ({
        video: tile.video,
        name: tile.name,
        videoOff: tile.root.dataset.videoOff === "true",
        screen: tile.root.classList.contains("tile--screen"),
      }))
      .sort((a, b) => Number(b.screen) - Number(a.screen));
  }

  has(id) {
    return this.#tiles.has(id);
  }

  // A reaction floats up from the bottom of the sender's tile.
  react(id, emoji) {
    const tile = this.#tiles.get(id);
    if (!tile) return;
    const bubble = document.createElement("span");
    bubble.className = "tile__reaction";
    bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = emoji;
    // A little sideways drift, so a burst doesn't stack up in one column.
    bubble.style.setProperty("--drift", `${Math.round(Math.random() * 40 - 20)}px`);
    tile.root.append(bubble);
    const done = () => bubble.remove();
    bubble.addEventListener("animationend", done);
    setTimeout(done, 4000); // in case animations are off
  }

  setSpeaking(id, speaking) {
    const tile = this.#tiles.get(id);
    if (tile) tile.root.dataset.speaking = String(speaking);
  }

  // Puts a tile in the spotlight (or takes it out again).
  pin(id) {
    this.#pinned = this.#pinned === id ? null : id;
    for (const tile of this.#tiles.values()) this.#labelActions(tile);
    this.#relayout();
  }

  get pinned() {
    return this.#pinned;
  }

  remove(id) {
    const tile = this.#tiles.get(id);
    if (!tile) return;
    tile.root.remove();
    this.#tiles.delete(id);
    if (this.#pinned === id) this.#pinned = null;
    if (!id.startsWith("screen:")) this.hideScreen(id);
    this.#relayout();
  }

  clear() {
    for (const id of [...this.#tiles.keys()]) if (id !== "self") this.remove(id);
  }

  // Plays every video again, e.g. after a click unblocks autoplay.
  resumeAll() {
    for (const { video } of this.#tiles.values()) this.#play(video);
  }

  // Routes remote audio to the chosen speaker, where supported.
  async setSpeaker(deviceId) {
    for (const { video } of this.#tiles.values()) {
      if (!video.muted && typeof video.setSinkId === "function") {
        await video.setSinkId(deviceId ?? "").catch(() => {});
      }
    }
  }

  #create(id, { self = false, screen = false }) {
    const root = document.createElement("figure");
    root.className = screen ? "tile tile--screen" : "tile";
    root.dataset.id = id;
    if (self) root.dataset.self = "true";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    // Your own audio is never played back to you (and screens carry none).
    video.muted = self || screen;
    video.classList.add("tile__video");
    if (self) video.classList.add("tile__video--mirrored");
    if (!self && !screen) {
      // Audio can arrive first, so wait for an actual picture.
      const firstFrame = () => {
        if (!video.videoWidth) return;
        video.removeEventListener("loadeddata", firstFrame);
        video.removeEventListener("resize", firstFrame);
        this.#onFirstFrame(id);
      };
      video.addEventListener("loadeddata", firstFrame);
      video.addEventListener("resize", firstFrame);
    }

    const avatar = document.createElement("div");
    avatar.className = "tile__avatar";
    avatar.setAttribute("aria-hidden", "true");
    const initialsBadge = document.createElement("span");
    initialsBadge.className = "tile__initials";
    avatar.append(initialsBadge);

    const caption = document.createElement("figcaption");
    caption.className = "tile__caption";
    const handState = icon("hand", "icon tile__hand");
    handState.setAttribute("hidden", "");
    const micState = icon("mic-off", "icon tile__mic-off");
    micState.setAttribute("hidden", "");
    const label = document.createElement("span");
    label.className = "tile__name";
    caption.append(handState, micState, label);

    const quality = document.createElement("span");
    quality.className = "tile__quality";
    quality.setAttribute("role", "img");
    quality.setAttribute("aria-label", strings.quality.measuring);
    quality.title = strings.quality.measuring;
    quality.dataset.quality = "unknown";
    quality.hidden = self || screen;

    // Pin, full screen and picture-in-picture, shown on hover or focus.
    const actions = document.createElement("div");
    actions.className = "tile__actions";
    const pin = this.#actionButton("pin", () => this.pin(id));
    const fullscreen = this.#actionButton("maximize", () => {
      if (document.fullscreenElement === root) document.exitFullscreen();
      else root.requestFullscreen?.().catch(() => {});
    });
    fullscreen.hidden = !document.fullscreenEnabled;
    const pip = this.#actionButton("monitor", () => {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture();
      else video.requestPictureInPicture?.().catch(() => {});
    });
    pip.hidden = self || !document.pictureInPictureEnabled;
    actions.append(pin, fullscreen, pip);
    const buttons = { pin, fullscreen, pip };
    if (self) {
      buttons.flip = this.#actionButton("switch-camera", () => this.#onFlipCamera());
      buttons.flip.setAttribute("aria-label", strings.media.switchCamera);
      buttons.flip.title = strings.media.switchCamera;
      buttons.flip.hidden = true;
      actions.append(buttons.flip);
    }

    root.append(video, avatar, caption, quality, actions);
    const tile = {
      root,
      video,
      initials: initialsBadge,
      label,
      micState,
      handState,
      quality,
      name: "",
      self,
    };
    tile.buttons = buttons;
    return tile;
  }

  #actionButton(iconName, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile__action";
    button.append(icon(iconName));
    button.addEventListener("click", onClick);
    return button;
  }

  #labelActions(tile) {
    if (!tile.buttons) return;
    const id = tile.root.dataset.id;
    const pinned = this.#pinned === id;
    const who = tile.name || strings.tiles.thisTile;
    const { pin, fullscreen, pip } = tile.buttons;
    pin.setAttribute("aria-label", pinned ? strings.tiles.unpin(who) : strings.tiles.pin(who));
    pin.setAttribute("aria-pressed", String(pinned));
    pin.title = pin.getAttribute("aria-label");
    setIcon(pin.querySelector("svg"), pinned ? "pin-off" : "pin");
    fullscreen.setAttribute("aria-label", strings.tiles.fullscreen(who));
    fullscreen.title = fullscreen.getAttribute("aria-label");
    pip.setAttribute("aria-label", strings.tiles.pictureInPicture(who));
    pip.title = pip.getAttribute("aria-label");
  }

  #play(video) {
    video.play().catch((err) => {
      // Autoplay with sound needs a user gesture; ask for one. (AbortError
      // just means a newer stream replaced this one.)
      if (err.name === "NotAllowedError") {
        document.dispatchEvent(new CustomEvent("autoplay-blocked"));
      }
    });
  }

  #relayout() {
    const ids = [...this.#tiles.keys()];
    const people = ids.filter((id) => !id.startsWith("screen:")).length;
    const screens = ids.length - people;
    const latestScreen = ids.find((id) => id.startsWith("screen:"));
    const main = this.#tiles.has(this.#pinned) ? this.#pinned : latestScreen;

    this.#root.dataset.count = String(people);
    this.#root.dataset.screens = String(screens);
    for (const [id, tile] of this.#tiles) tile.root.toggleAttribute("data-main", id === main);

    if (main && ids.length > 1) {
      this.#root.dataset.layout = "focus";
      this.#root.style.setProperty("--rows", String(Math.max(ids.length - 1, 1)));
      return;
    }
    this.#root.dataset.layout = "grid";
    const { width, height } = this.#root.getBoundingClientRect();
    if (!width || !height) return;
    // Landscape stages get 16:9 tiles; tall phone screens get portrait ones.
    const aspect = width >= height ? 16 / 9 : 3 / 4;
    const gap = parseFloat(getComputedStyle(this.#root).columnGap) || GAP;
    const { tileWidth } = bestGrid(ids.length, width, height, aspect, gap);
    this.#root.style.setProperty("--tile-width", `${Math.floor(tileWidth)}px`);
    this.#root.style.setProperty("--tile-aspect", String(aspect));
  }
}
