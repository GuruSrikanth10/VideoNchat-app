// Camera, microphone and speaker pickers, used in the lobby and in the
// in-call settings. Choices are remembered for next time.
import { local } from "../lib/storage.js";

const STORAGE_KEY = "videonchat:devices";
const LABELS = { videoinput: "Camera", audioinput: "Microphone", audiooutput: "Speaker" };

export function rememberedDevices() {
  try {
    return JSON.parse(local.get(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const speakerSupported = () =>
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export class DevicePicker {
  #media;
  #selects;
  #onSpeaker;

  // selects: { videoinput, audioinput, audiooutput } <select> elements.
  constructor({ media, selects, onSpeaker }) {
    this.#media = media;
    this.#selects = selects;
    this.#onSpeaker = onSpeaker;
    for (const [kind, select] of Object.entries(selects)) {
      select.addEventListener("change", () => this.#choose(kind, select.value));
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", () => this.refresh());
  }

  async refresh() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await this.#media.listDevices();
    for (const [kind, select] of Object.entries(this.#selects)) {
      const field = select.closest(".field-group");
      const list = devices[kind];
      if (kind === "audiooutput" && (!speakerSupported() || list.length === 0)) {
        if (field) field.hidden = true;
        continue;
      }
      if (field) field.hidden = false;
      const current = this.#current(kind);
      select.replaceChildren(
        ...list.map((device, index) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `${LABELS[kind]} ${index + 1}`;
          option.selected = device.deviceId === current;
          return option;
        }),
      );
      if (list.length === 0) {
        const option = document.createElement("option");
        option.textContent = `No ${LABELS[kind].toLowerCase()} found`;
        select.append(option);
      }
      select.disabled = list.length === 0;
    }
  }

  #current(kind) {
    const media = this.#media;
    if (kind === "audioinput") return media.mic?.getSettings().deviceId ?? media.deviceIds[kind];
    if (kind === "videoinput") {
      return media.camera?.getSettings().deviceId ?? media.deviceIds[kind];
    }
    return media.deviceIds[kind] ?? "default";
  }

  async #choose(kind, deviceId) {
    const ok = await this.#media.useDevice(kind, deviceId);
    if (ok) {
      local.set(STORAGE_KEY, JSON.stringify({ ...rememberedDevices(), [kind]: deviceId }));
      if (kind === "audiooutput") await this.#onSpeaker?.(deviceId);
    }
    await this.refresh();
  }
}
