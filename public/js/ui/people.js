// The People panel: everyone in the call and what they're sharing.
import { icon } from "./icons.js";
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

  constructor(list) {
    this.#list = list;
  }

  // people: [{ id, name, self?, audio, video, screen, hand }]. Raised hands
  // come first, in the order they went up; then you; then everyone else.
  render(people) {
    const rank = (person) => (person.hand ? 0 : person.self ? 1 : 2);
    const sorted = [...people].sort(
      (a, b) =>
        rank(a) - rank(b) || (a.hand ?? 0) - (b.hand ?? 0) || collator.compare(a.name, b.name),
    );
    this.#list.replaceChildren(...sorted.map((person) => this.#row(person)));
  }

  #row({ id, name, self, audio, video, screen, hand }) {
    const item = document.createElement("li");
    item.className = "person";
    item.dataset.id = id;

    const avatar = document.createElement("span");
    avatar.className = "person__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(name);

    const label = document.createElement("span");
    label.className = "person__name";
    label.textContent = self ? strings.tiles.you(name) : name;

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
    if (hand) add("hand", strings.hands.state);
    if (screen) add("monitor-up", strings.people.presenting);
    if (!video) add("video-off", strings.people.cameraOff);
    if (!audio) add("mic-off", strings.people.muted);

    item.append(avatar, label, states);
    return item;
  }
}
