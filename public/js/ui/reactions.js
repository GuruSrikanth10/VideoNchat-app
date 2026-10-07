// The React menu: raise or lower your hand, or send an emoji reaction.
// Built on the Popover API (light dismiss, Escape, top layer), with a
// plain show/hide fallback for browsers without it.
import { strings } from "../strings.js";

// The same list the server accepts.
export const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

const EDGE = 8; // px kept clear of the window's edges

export class ReactionMenu {
  #menu;
  #toggle;
  #hand;
  #popover = typeof HTMLElement.prototype.showPopover === "function";

  // onReact(emoji) sends a reaction; onHand() raises or lowers your hand.
  constructor({ menu, toggle, hand, buttons, onReact, onHand }) {
    this.#menu = menu;
    this.#toggle = toggle;
    this.#hand = hand;

    buttons.replaceChildren(
      ...REACTIONS.map((emoji) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "reactions__button";
        button.textContent = emoji;
        const label = strings.reactions.send(strings.reactions.labels[emoji]);
        button.setAttribute("aria-label", label);
        button.title = label;
        button.addEventListener("click", () => onReact(emoji));
        return button;
      }),
    );
    hand.addEventListener("click", () => {
      onHand();
      this.close();
    });

    if (this.#popover) {
      menu.addEventListener("toggle", (event) => {
        const open = event.newState === "open";
        toggle.setAttribute("aria-expanded", String(open));
        if (open) this.#place();
      });
    } else {
      // No Popover API: show and hide it by hand.
      menu.removeAttribute("popover");
      menu.hidden = true;
      toggle.removeAttribute("popovertarget");
      toggle.addEventListener("click", () => (menu.hidden ? this.#openFallback() : this.close()));
      menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.close();
      });
    }
    toggle.setAttribute("aria-expanded", "false");
  }

  get open() {
    return this.#popover ? this.#menu.matches(":popover-open") : !this.#menu.hidden;
  }

  toggle() {
    if (this.open) this.close();
    else if (this.#popover) this.#menu.showPopover();
    else this.#openFallback();
  }

  close() {
    if (!this.open) return;
    if (this.#popover) {
      this.#menu.hidePopover();
    } else {
      this.#menu.hidden = true;
      this.#toggle.setAttribute("aria-expanded", "false");
    }
  }

  // Shows whether your hand is up. (The label says what pressing does, like
  // the other controls, so there's no aria-pressed as well.)
  setHand(raised) {
    this.#hand.dataset.raised = String(raised);
    this.#hand.querySelector(".reactions__hand-label").textContent = raised
      ? strings.hands.lower
      : strings.hands.raise;
  }

  #openFallback() {
    this.#menu.hidden = false;
    this.#toggle.setAttribute("aria-expanded", "true");
    this.#place();
  }

  // Above the React button, kept inside the window.
  #place() {
    const anchor = this.#toggle.getBoundingClientRect();
    const menu = this.#menu;
    menu.style.setProperty("--menu-bottom", `${Math.round(innerHeight - anchor.top + EDGE)}px`);
    const width = menu.offsetWidth;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(centre - width / 2, EDGE), innerWidth - width - EDGE);
    menu.style.setProperty("--menu-left", `${Math.round(Math.max(left, EDGE))}px`);
    this.#hand.focus();
  }
}
