// Sends files to everyone in the call over the WebRTC data channels, peer
// to peer: files never pass through the server, and people who join later
// don't get them.
//
// On a channel, a file is a JSON header ({ type: "file", id, name, size }),
// binary chunks, then { type: "file-end", id }. Files to the same person go
// one at a time, so their chunks never mix.
import { strings } from "../strings.js";

export const MAX_FILE_SIZE = 50_000_000; // "50 MB", as the app says
const CHUNK = 16 * 1024;
const HIGH_WATER = 1024 * 1024; // pause sending above this much buffered
const LOW_WATER = 256 * 1024;

// "820 kB", "4.2 MB".
export function formatSize(bytes, locale = strings.locale) {
  const [value, unit] =
    bytes >= 1_000_000
      ? [bytes / 1_000_000, "megabyte"]
      : [Math.max(bytes / 1000, 0.1), "kilobyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

// A safe file name to show and save: no paths or control characters.
export function cleanFileName(name) {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const unsafe = /[\u0000-\u001f\u007f/\\]+/g;
  const cleaned = String(name ?? "")
    .replace(unsafe, "_")
    .trim();
  return cleaned.slice(-200) || "file";
}

export class FileShare extends EventTarget {
  #peers = new Map(); // peer ID -> { channel, queue, incoming }

  attach(peerId, channel) {
    const entry = { channel, queue: Promise.resolve(), incoming: null };
    this.#peers.set(peerId, entry);
    channel.bufferedAmountLowThreshold = LOW_WATER;
    channel.addEventListener("message", ({ data }) => this.#receive(peerId, entry, data));
    channel.addEventListener("close", () => {
      if (entry.incoming) this.#emit("failed", { peerId, id: entry.incoming.id });
      entry.incoming = null;
    });
  }

  detach(peerId) {
    const entry = this.#peers.get(peerId);
    if (entry?.incoming) this.#emit("failed", { peerId, id: entry.incoming.id });
    this.#peers.delete(peerId);
  }

  // How many people a file would go to right now.
  get reachable() {
    return [...this.#peers.values()].filter((entry) => entry.channel.readyState === "open").length;
  }

  // Sends a file to everyone reachable. onProgress(fraction) follows the
  // whole send. Resolves to how many people got it.
  async send(file, { id, onProgress = () => {} }) {
    const targets = [...this.#peers.values()].filter((e) => e.channel.readyState === "open");
    const total = file.size * targets.length || 1;
    let sent = 0;
    const results = await Promise.allSettled(
      targets.map((entry) => {
        entry.queue = entry.queue
          .catch(() => {})
          .then(() =>
            this.#sendTo(entry.channel, file, id, (bytes) => {
              sent += bytes;
              onProgress(sent / total);
            }),
          );
        return entry.queue;
      }),
    );
    onProgress(1);
    return results.filter((result) => result.status === "fulfilled").length;
  }

  async #sendTo(channel, file, id, progressed) {
    channel.send(
      JSON.stringify({ type: "file", id, name: cleanFileName(file.name), size: file.size }),
    );
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      if (channel.readyState !== "open") throw new Error("The connection closed");
      if (channel.bufferedAmount > HIGH_WATER) await drained(channel);
      const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
      channel.send(chunk);
      progressed(chunk.byteLength);
    }
    channel.send(JSON.stringify({ type: "file-end", id }));
  }

  #receive(peerId, entry, data) {
    if (typeof data !== "string") {
      const incoming = entry.incoming;
      if (!incoming) return;
      incoming.chunks.push(data);
      incoming.received += data.byteLength;
      // More than announced: something is wrong; drop it.
      if (incoming.received > incoming.size) {
        entry.incoming = null;
        this.#emit("failed", { peerId, id: incoming.id });
        return;
      }
      this.#emit("progress", {
        peerId,
        id: incoming.id,
        fraction: incoming.received / incoming.size,
      });
      return;
    }
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message?.type === "file") {
      const size = Number(message.size);
      if (typeof message.id !== "string" || !Number.isFinite(size) || size < 0) return;
      if (size > MAX_FILE_SIZE) return; // too big: ignored
      if (entry.incoming) this.#emit("failed", { peerId, id: entry.incoming.id });
      entry.incoming = {
        id: message.id.slice(0, 64),
        name: cleanFileName(message.name),
        size,
        chunks: [],
        received: 0,
      };
      this.#emit("incoming", { peerId, id: entry.incoming.id, name: entry.incoming.name, size });
    } else if (message?.type === "file-end" && entry.incoming?.id === message.id) {
      const { id, name, size, chunks, received } = entry.incoming;
      entry.incoming = null;
      if (received !== size) return this.#emit("failed", { peerId, id });
      // Never anything a browser would render: a same-origin blob: URL
      // showing someone's HTML could run it as this site.
      const blob = new Blob(chunks, { type: "application/octet-stream" });
      this.#emit("received", { peerId, id, name, blob });
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

const drained = (channel) =>
  new Promise((resolve) => {
    channel.addEventListener("bufferedamountlow", resolve, { once: true });
    channel.addEventListener("close", resolve, { once: true });
  });
