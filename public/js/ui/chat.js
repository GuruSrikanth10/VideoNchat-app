// The chat panel: messages, the typing indicator and the composer.
// Remote text only ever goes into textContent.
import { strings } from "../strings.js";

const timeFormat = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const MAX_LENGTH = 1000;

// Splits text into strings and http(s) links. Exported for tests.
export function linkify(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/gi)) {
    // Trailing punctuation usually belongs to the sentence, not the link.
    const url = match[0].replace(/[.,!?;:)\]]+$/, "");
    if (match.index > last) parts.push(text.slice(last, match.index));
    let valid = null;
    try {
      valid = new URL(url);
    } catch {
      // not a URL after all
    }
    parts.push(valid && /^https?:$/.test(valid.protocol) ? { href: valid.href, text: url } : url);
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export class Chat {
  #list;
  #typing;
  #typers = new Map(); // participant ID -> { name, timer }
  #seen = new Set();
  #selfId = null;

  #jump;

  constructor({ list, typing, form, input, counter, jump, onSend, onTyping }) {
    this.#list = list;
    this.#typing = typing;
    this.#jump = jump;
    this.#wireComposer({ form, input, counter, onSend, onTyping });
    // "New messages" button: jump down, and hide it once you're there.
    jump.addEventListener("click", () => this.#scrollToBottom());
    list.parentElement.addEventListener("scroll", () => {
      if (this.#isAtBottom()) jump.hidden = true;
    });
  }

  setSelf(id) {
    this.#selfId = id;
  }

  add({ id, from, name, text, ts }) {
    if (this.#seen.has(id)) return; // history replays after a reconnect
    this.#seen.add(id);
    this.setTyping(from, name, false);

    const mine = from === this.#selfId;
    const previous = this.#list.lastElementChild;
    const grouped = previous?.dataset.from === from && ts - Number(previous.dataset.ts) < 120_000;

    const item = document.createElement("li");
    item.className = mine ? "message message--mine" : "message";
    item.dataset.from = from;
    item.dataset.ts = String(ts);
    if (grouped) item.classList.add("message--grouped");

    const meta = document.createElement("div");
    meta.className = "message__meta";
    const author = document.createElement("span");
    author.className = "message__author";
    author.textContent = mine ? strings.chat.you : name;
    const time = document.createElement("time");
    time.className = "message__time";
    time.dateTime = new Date(ts).toISOString();
    time.textContent = timeFormat.format(ts);
    meta.append(author, time);

    const body = document.createElement("p");
    body.className = "message__text";
    for (const part of linkify(text)) {
      if (typeof part === "string") {
        body.append(part);
      } else {
        const link = document.createElement("a");
        link.href = part.href;
        link.textContent = part.text;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        body.append(link);
      }
    }

    item.append(meta, body);
    const atBottom = this.#isAtBottom();
    this.#list.append(item);
    // Don't yank someone who scrolled up to read; offer a way down instead.
    if (atBottom || mine) this.#scrollToBottom();
    else this.#jump.hidden = false;
    this.#list.dispatchEvent(new CustomEvent("chat:new", { bubbles: true, detail: { mine } }));
  }

  setTyping(from, name, typing) {
    const current = this.#typers.get(from);
    clearTimeout(current?.timer);
    if (typing) {
      // Expire on our own in case the "stopped" notice never arrives.
      const timer = setTimeout(() => this.setTyping(from, name, false), 4000);
      this.#typers.set(from, { name, timer });
    } else {
      this.#typers.delete(from);
    }
    const names = [...this.#typers.values()].map((t) => t.name);
    this.#typing.textContent = names.length ? strings.chat.typing(names) : "";
  }

  #wireComposer({ form, input, counter, onSend, onTyping }) {
    // Remaining characters, shown only when the limit gets close.
    const updateCounter = () => {
      const left = MAX_LENGTH - input.value.length;
      counter.textContent = left <= 200 ? strings.chat.charactersLeft(left) : "";
    };
    let typingSentAt = 0;
    let idleTimer;
    const stopTyping = () => {
      clearTimeout(idleTimer);
      if (typingSentAt) onTyping(false);
      typingSentAt = 0;
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text) onSend(text);
      input.value = "";
      updateCounter();
      stopTyping();
    });

    // Enter sends; Shift+Enter adds a line; nothing is sent mid-IME input.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    input.addEventListener("input", () => {
      updateCounter();
      clearTimeout(idleTimer);
      if (!input.value.trim()) return stopTyping();
      if (Date.now() - typingSentAt > 2000) {
        onTyping(true);
        typingSentAt = Date.now();
      }
      idleTimer = setTimeout(stopTyping, 3000);
    });
  }

  #isAtBottom() {
    const scroller = this.#list.parentElement;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  }

  #scrollToBottom() {
    const scroller = this.#list.parentElement;
    scroller.scrollTop = scroller.scrollHeight;
    this.#jump.hidden = true;
  }
}
