// The pre-join lobby: camera preview, microphone meter, device choices,
// your name and who's already in the meeting.
import { LevelMeter } from "../lib/audio-levels.js";
import { DevicePicker } from "./devices.js";
import { setIcon } from "./icons.js";
import { describeKeys, shortcutFor } from "./shortcuts.js";
import { strings } from "../strings.js";

const $ = (id) => document.getElementById(id);

const withShortcut = (text, action) =>
  strings.controls.withShortcut(text, describeKeys(shortcutFor(action)));

const initialsOf = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("") || "?";

// Plain-language help for each getUserMedia error.
export function describeMediaError(error, { partial = null } = {}) {
  const s = strings.mediaErrors;
  const reason = Object.hasOwn(s.reasons, error.name) ? s.reasons[error.name] : s.other;
  const next = partial === "audio" ? s.micOnly : partial === "video" ? s.cameraOnly : s.watchOnly;
  return `${reason} ${next}`;
}

export class Lobby {
  #media;
  #peek;
  #onJoin;
  #meter = null;
  #peekTimer = null;
  #picker;
  #joining = false;

  // peek() resolves to { ok, count, full }; onJoin(name) resolves to true
  // once in the call (false to stay in the lobby). toggleMic() and
  // toggleCamera() are shared with the call's own buttons, as is
  // flipCamera(), which switches between the front and back cameras.
  constructor({ media, initialName, peek, onJoin, toggleMic, toggleCamera, flipCamera }) {
    this.#media = media;
    this.#peek = peek;
    this.#onJoin = onJoin;

    $("lobby-name").value = initialName;
    this.#updateInitials();
    $("lobby-name").addEventListener("input", () => {
      $("name-error").textContent = "";
      $("lobby-name").removeAttribute("aria-invalid");
      this.#updateInitials();
    });

    $("lobby-mic").addEventListener("click", toggleMic);
    $("lobby-camera").addEventListener("click", toggleCamera);
    $("lobby-flip").addEventListener("click", flipCamera);
    $("media-retry").addEventListener("click", () => this.#startMedia());
    $("lobby-form").addEventListener("submit", (event) => {
      event.preventDefault();
      this.#join();
    });

    this.#picker = new DevicePicker({
      media,
      selects: {
        videoinput: $("lobby-videoinput"),
        audioinput: $("lobby-audioinput"),
        audiooutput: $("lobby-audiooutput"),
      },
    });

    this.onMediaChange = () => this.#render();
    media.addEventListener("change", this.onMediaChange);
    media.addEventListener("trackchange", this.onMediaChange);
  }

  async start() {
    const name = $("lobby-name");
    if (name.value) $("join-button").focus();
    else name.focus();
    this.#refreshRoomInfo();
    this.#peekTimer = setInterval(() => this.#refreshRoomInfo(), 5000);
    await this.#startMedia();
  }

  destroy() {
    clearInterval(this.#peekTimer);
    this.#meter?.stop();
    this.#media.removeEventListener("change", this.onMediaChange);
    this.#media.removeEventListener("trackchange", this.onMediaChange);
    $("lobby-video").srcObject = null;
  }

  async #startMedia() {
    $("media-status").hidden = true;
    const error = await this.#media.start();
    this.#render();
    await this.#picker.refresh();
    if (error) {
      const partial = this.#media.mic ? "audio" : this.#media.camera ? "video" : null;
      $("media-status").querySelector(".lobby__status-text").textContent = describeMediaError(
        error,
        { partial },
      );
      $("media-status").hidden = false;
    }
  }

  #render() {
    const media = this.#media;
    const micOn = Boolean(media.mic) && media.micEnabled;
    const cameraOn = Boolean(media.camera) && media.cameraEnabled;

    const video = $("lobby-video");
    const cameraTrack = media.camera;
    if (cameraTrack && video.srcObject?.getVideoTracks()[0] !== cameraTrack) {
      video.srcObject = new MediaStream([cameraTrack]);
    } else if (!cameraTrack) {
      video.srcObject = null;
    }
    video.closest(".tile").dataset.videoOff = String(!cameraOn);
    // Only the front camera is shown like a mirror.
    video.classList.toggle("tile__video--mirrored", media.facing !== "environment");

    const mic = $("lobby-mic");
    mic.disabled = !media.mic;
    mic.dataset.active = String(!micOn);
    mic.setAttribute("aria-label", micOn ? strings.lobby.micOff : strings.lobby.micOn);
    mic.title = withShortcut(mic.getAttribute("aria-label"), "mic");
    setIcon(mic.querySelector("svg"), micOn ? "mic" : "mic-off");

    const camera = $("lobby-camera");
    camera.dataset.active = String(!cameraOn);
    camera.setAttribute("aria-label", cameraOn ? strings.lobby.cameraOff : strings.lobby.cameraOn);
    camera.title = withShortcut(camera.getAttribute("aria-label"), "camera");
    setIcon(camera.querySelector("svg"), cameraOn ? "video" : "video-off");

    // Restart the meter whenever the microphone track changes.
    if (this.#meter?.track !== media.mic) {
      this.#meter?.stop();
      this.#meter = null;
      $("mic-meter").style.setProperty("--level", "0");
      if (media.mic) {
        this.#meter = new LevelMeter(media.mic, (level) => {
          const shown = this.#media.micEnabled ? level : 0;
          $("mic-meter").style.setProperty("--level", shown.toFixed(2));
        });
        this.#meter.track = media.mic;
      }
    }
  }

  #updateInitials() {
    $("lobby-initials").textContent = initialsOf($("lobby-name").value);
  }

  async #refreshRoomInfo() {
    const reply = await this.#peek();
    const info = $("room-info");
    if (!reply.ok) {
      info.textContent = "";
      return;
    }
    if (reply.full) info.textContent = strings.lobby.roomFull;
    else if (reply.count === 0) info.textContent = strings.lobby.nobodyHere;
    else info.textContent = strings.lobby.peopleHere(reply.count);
  }

  async #join() {
    if (this.#joining) return;
    const input = $("lobby-name");
    const name = input.value.trim().slice(0, 40);
    if (!name) {
      $("name-error").textContent = strings.lobby.nameRequired;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    this.#joining = true;
    const button = $("join-button");
    button.disabled = true;
    button.textContent = strings.lobby.joining;
    const joined = await this.#onJoin(name);
    if (!joined) {
      button.disabled = false;
      button.textContent = strings.lobby.joinNow;
    }
    this.#joining = false;
  }
}
