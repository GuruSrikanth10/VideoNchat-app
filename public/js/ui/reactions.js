// The React menu: raise or lower your hand, or send an emoji reaction.
import { strings } from "../strings.js";
import { Popover } from "./popover.js";

// The same list the server accepts.
export const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉"];

export class ReactionMenu {
  #popover;
  #hand;

  // onReact(emoji) sends a reaction; onHand() raises or lowers your hand.
  constructor({ menu, toggle, hand, buttons, onReact, onHand }) {
    this.#hand = hand;
    this.#popover = new Popover(menu, { side: "above" });
    this.#popover.addInvoker(toggle);

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
      this.#popover.close();
    });
  }

  // Shows whether your hand is up. (The label says what pressing does, like
  // the other controls, so there's no aria-pressed as well.)
  setHand(raised) {
    this.#hand.dataset.raised = String(raised);
    this.#hand.querySelector(".reactions__hand-label").textContent = raised
      ? strings.hands.lower
      : strings.hands.raise;
  }
}
