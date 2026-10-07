// Shows live captions at the bottom of the stage: one line per speaker,
// the latest words last. Lines fade away after a few quiet seconds.
const SHOWN = 160; // characters per line
const QUIET_MS = 6000;
const MAX_SPEAKERS = 3;

export class CaptionDisplay {
  #root;
  #lines = new Map(); // speaker ID -> { item, text, done, timer }

  constructor(root) {
    this.#root = root;
  }

  // Interim text replaces the speaker's unfinished words; final text is
  // kept, and the line shows the end of it all.
  show(id, name, { text, final }) {
    let line = this.#lines.get(id);
    if (!line) {
      const item = document.createElement("p");
      item.className = "caption";
      const who = document.createElement("span");
      who.className = "caption__name";
      const words = document.createElement("span");
      words.className = "caption__text";
      item.append(who, words);
      line = { item, who, words, done: "" };
      this.#lines.set(id, line);
      this.#root.append(item);
      // Only the most recent speakers.
      while (this.#lines.size > MAX_SPEAKERS) this.remove(this.#lines.keys().next().value);
    }
    line.who.textContent = name;
    const all = `${line.done} ${text}`.trim();
    if (final) line.done = all.slice(-SHOWN * 2);
    line.words.textContent = all.length > SHOWN ? `…${all.slice(-SHOWN)}` : all;
    this.#root.hidden = false;
    clearTimeout(line.timer);
    line.timer = setTimeout(() => this.remove(id), QUIET_MS);
  }

  remove(id) {
    const line = this.#lines.get(id);
    if (!line) return;
    clearTimeout(line.timer);
    line.item.remove();
    this.#lines.delete(id);
    if (!this.#lines.size) this.#root.hidden = true;
  }

  clear() {
    for (const id of [...this.#lines.keys()]) this.remove(id);
  }
}
