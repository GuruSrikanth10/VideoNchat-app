// The video stage: one tile per participant (and per shared screen),
// keyed by ID, laid out by CSS according to how many there are.
import { icon } from "./icons.js";
import { describe } from "../lib/stats.js";

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("") || "?";

export class Tiles {
  #root;
  #tiles = new Map();

  constructor(root) {
    this.#root = root;
  }

  // Creates or updates a participant's tile.
  upsert(id, { name, self = false, stream, audio, video, quality, stats }) {
    let tile = this.#tiles.get(id);
    if (!tile) {
      tile = this.#create(id, self);
      this.#tiles.set(id, tile);
      this.#root.append(tile.root);
      this.#relayout();
    }
    if (name !== undefined) {
      tile.name = name;
      tile.label.textContent = self ? `${name} (you)` : name;
      tile.initials.textContent = initials(name);
      tile.root.setAttribute("aria-label", self ? `${name} (you)` : name);
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
    if (quality !== undefined) {
      tile.quality.dataset.quality = quality ?? "unknown";
      tile.quality.title = describe(stats ?? { rtt: null, lossPercent: null, kbps: null }, quality);
      tile.quality.setAttribute("aria-label", tile.quality.title);
    }
    return tile;
  }

  // A participant's shared screen gets its own, larger tile.
  showScreen(id, { name, stream, self = false }) {
    const key = `screen:${id}`;
    let tile = this.#tiles.get(key);
    if (!tile) {
      tile = this.#create(key, false, true);
      this.#tiles.set(key, tile);
      this.#root.prepend(tile.root);
      this.#relayout();
    }
    const label = self ? "Your screen" : `${name}'s screen`;
    tile.label.textContent = label;
    tile.root.setAttribute("aria-label", label);
    if (tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      this.#play(tile.video);
    }
  }

  hideScreen(id) {
    this.remove(`screen:${id}`);
  }

  setSpeaking(id, speaking) {
    const tile = this.#tiles.get(id);
    if (tile) tile.root.dataset.speaking = String(speaking);
  }

  remove(id) {
    const tile = this.#tiles.get(id);
    if (!tile) return;
    tile.root.remove();
    this.#tiles.delete(id);
    if (!id.startsWith("screen:")) this.hideScreen(id);
    this.#relayout();
  }

  clear() {
    for (const id of [...this.#tiles.keys()]) if (id !== "self") this.remove(id);
  }

  // Plays every remote video again, e.g. after a click unblocks autoplay.
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

  #create(id, self, screen = false) {
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

    const avatar = document.createElement("div");
    avatar.className = "tile__avatar";
    avatar.setAttribute("aria-hidden", "true");
    const initialsBadge = document.createElement("span");
    initialsBadge.className = "tile__initials";
    avatar.append(initialsBadge);

    const caption = document.createElement("figcaption");
    caption.className = "tile__caption";
    const micState = icon("mic-off", "icon tile__mic-off");
    micState.setAttribute("hidden", "");
    const label = document.createElement("span");
    label.className = "tile__name";
    caption.append(micState, label);

    const quality = document.createElement("span");
    quality.className = "tile__quality";
    quality.setAttribute("role", "img");
    quality.setAttribute("aria-label", "Measuring connection");
    quality.title = "Measuring connection";
    quality.dataset.quality = "unknown";
    quality.hidden = self || screen;

    root.append(video, avatar, caption, quality);
    return { root, video, initials: initialsBadge, label, micState, quality, name: "" };
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
    const people = [...this.#tiles.keys()].filter((id) => !id.startsWith("screen:")).length;
    const screens = this.#tiles.size - people;
    this.#root.dataset.count = String(people);
    this.#root.dataset.screens = String(screens);
    // While someone presents, people share the column beside the screen.
    this.#root.style.setProperty("--rows", String(Math.max(people, 1)));
  }
}
