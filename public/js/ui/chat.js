// The chat panel: messages, the typing indicator and the composer.
// Remote text only ever goes into textContent.

const timeFormat = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

export class Chat {
  #list;
  #typing;
  #typers = new Map(); // participant ID -> { name, timer }
  #seen = new Set();
  #selfId = null;

  constructor({ list, typing, form, input, onSend, onTyping }) {
    this.#list = list;
    this.#typing = typing;
    this.#wireComposer({ form, input, onSend, onTyping });
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
    author.textContent = mine ? "You" : name;
    const time = document.createElement("time");
    time.className = "message__time";
    time.dateTime = new Date(ts).toISOString();
    time.textContent = timeFormat.format(ts);
    meta.append(author, time);

    const body = document.createElement("p");
    body.className = "message__text";
    body.textContent = text;

    item.append(meta, body);
    const atBottom = this.#isAtBottom();
    this.#list.append(item);
    if (atBottom || mine) this.#scrollToBottom();
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
    this.#typing.textContent =
      names.length === 0
        ? ""
        : names.length === 1
          ? `${names[0]} is typing…`
          : names.length === 2
            ? `${names[0]} and ${names[1]} are typing…`
            : "Several people are typing…";
  }

  #wireComposer({ form, input, onSend, onTyping }) {
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
  }
}
