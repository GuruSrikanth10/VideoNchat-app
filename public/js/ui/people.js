// The People panel: everyone in the call and what they're sharing.
import { icon } from "./icons.js";

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

  constructor(list) {
    this.#list = list;
  }

  // people: [{ id, name, self?, audio, video, screen }]
  render(people) {
    const sorted = [...people].sort((a, b) =>
      a.self ? -1 : b.self ? 1 : collator.compare(a.name, b.name),
    );
    this.#list.replaceChildren(...sorted.map((person) => this.#row(person)));
  }

  #row({ id, name, self, audio, video, screen }) {
    const item = document.createElement("li");
    item.className = "person";
    item.dataset.id = id;

    const avatar = document.createElement("span");
    avatar.className = "person__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(name);

    const label = document.createElement("span");
    label.className = "person__name";
    label.textContent = self ? `${name} (you)` : name;

    const states = document.createElement("span");
    states.className = "person__states";
    const add = (iconName, text) => {
      const state = document.createElement("span");
      state.className = "person__state";
      const hidden = document.createElement("span");
      hidden.className = "visually-hidden";
      hidden.textContent = text;
      state.append(icon(iconName), hidden);
      states.append(state);
    };
    if (screen) add("monitor-up", "presenting");
    if (!video) add("video-off", "camera off");
    if (!audio) add("mic-off", "muted");

    item.append(avatar, label, states);
    return item;
  }
}
