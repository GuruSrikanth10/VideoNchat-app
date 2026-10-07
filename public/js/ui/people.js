// The People panel: everyone in the call and what they're sharing. Hosts
// also get a menu for each person (mute, ask to unmute, lower hand,
// remove).
import { icon } from "./icons.js";
import { Popover } from "./popover.js";
import { strings } from "../strings.js";

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("") || "?";

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export class People {
  #list;
  #rows = new Map(); // id -> row elements, kept so an open menu survives updates
  #menu;
  #popover;
  #target = null; // whom the open menu is about

  // onAction(action, person) runs a host action from a person's menu.
  constructor({ list, menu, onAction }) {
    this.#list = list;
    this.#menu = menu;
    this.#popover = new Popover(menu, { side: "below" });
    for (const item of menu.querySelectorAll("[data-action]")) {
      item.addEventListener("click", () => {
        this.#popover.close();
        if (this.#target) onAction(item.dataset.action, this.#target);
      });
    }
  }

  // people: [{ id, name, self?, host, audio, video, screen, hand }]. Raised
  // hands come first, in the order they went up; then you; then everyone
  // else. canManage shows the host's menus.
  render(people, { canManage = false } = {}) {
    const rank = (person) => (person.hand ? 0 : person.self ? 1 : 2);
    const sorted = [...people].sort(
      (a, b) =>
        rank(a) - rank(b) || (a.hand ?? 0) - (b.hand ?? 0) || collator.compare(a.name, b.name),
    );
    const present = new Set(sorted.map((person) => person.id));
    for (const [id, row] of this.#rows) {
      if (!present.has(id)) {
        row.item.remove();
        this.#rows.delete(id);
      }
    }
    const items = sorted.map((person) => {
      let row = this.#rows.get(person.id);
      if (!row) {
        row = this.#createRow();
        this.#rows.set(person.id, row);
      }
      this.#updateRow(row, person, canManage);
      return row.item;
    });
    // Only move rows when the order changed, so focus isn't disturbed.
    const current = [...this.#list.children];
    if (items.some((item, index) => current[index] !== item)) this.#list.append(...items);
    if (this.#target && !present.has(this.#target.id)) this.#popover.close();
  }

  #createRow() {
    const item = document.createElement("li");
    item.className = "person";
    const avatar = document.createElement("span");
    avatar.className = "person__avatar";
    avatar.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "person__text";
    const name = document.createElement("span");
    name.className = "person__name";
    const role = document.createElement("span");
    role.className = "person__role";
    role.textContent = strings.host.label;
    text.append(name, role);
    const states = document.createElement("span");
    states.className = "person__states";
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "icon-btn person__menu";
    menuButton.setAttribute("aria-controls", this.#menu.id);
    menuButton.append(icon("ellipsis-vertical"));
    const row = { item, avatar, name, role, states, menuButton, person: null };
    this.#popover.addInvoker(menuButton, () => this.#prepareMenu(row.person));
    item.append(avatar, text, states, menuButton);
    return row;
  }

  #updateRow(row, person, canManage) {
    row.person = person;
    row.item.dataset.id = person.id;
    row.avatar.textContent = initials(person.name);
    row.name.textContent = person.self ? strings.tiles.you(person.name) : person.name;
    row.role.hidden = !person.host;
    const states = [];
    const add = (iconName, text) => {
      const state = document.createElement("span");
      state.className = "person__state";
      const hidden = document.createElement("span");
      hidden.className = "visually-hidden";
      hidden.textContent = text;
      state.append(icon(iconName), hidden);
      states.push(state);
    };
    if (person.hand) add("hand", strings.hands.state);
    if (person.screen) add("monitor-up", strings.people.presenting);
    if (!person.video) add("video-off", strings.people.cameraOff);
    if (!person.audio) add("mic-off", strings.people.muted);
    row.states.replaceChildren(...states);
    row.menuButton.hidden = !canManage || person.self;
    row.menuButton.setAttribute("aria-label", strings.host.actionsFor(person.name));
    if (this.#target?.id === person.id) this.#prepareMenu(person);
  }

  // Only the actions that make sense for this person right now.
  #prepareMenu(person) {
    this.#target = person;
    const show = {
      mute: person.audio,
      askUnmute: !person.audio,
      lowerHand: Boolean(person.hand),
      remove: true,
    };
    for (const item of this.#menu.querySelectorAll("[data-action]")) {
      item.hidden = !show[item.dataset.action];
    }
  }
}
