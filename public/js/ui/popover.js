// Menus that pop up next to the button that opened them. Built on the
// Popover API (light dismiss, Escape, top layer), with a plain show/hide
// fallback for browsers without it. Several buttons can open one menu.
const EDGE = 8; // px kept clear of the window's edges
const supported = typeof HTMLElement.prototype.showPopover === "function";

export class Popover {
  #element;
  #side;
  #anchor = null;

  // side: "above" or "below" the button, flipped if there's no room.
  constructor(element, { side = "above" } = {}) {
    this.#element = element;
    this.#side = side;
    if (supported) {
      element.addEventListener("toggle", (event) => {
        if (event.newState === "open") this.#place();
        else delete element.dataset.placed;
        this.#anchor?.setAttribute("aria-expanded", String(event.newState === "open"));
      });
    } else {
      element.removeAttribute("popover");
      element.hidden = true;
      element.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.close();
      });
      document.addEventListener("pointerdown", (event) => {
        if (this.isOpen && !element.contains(event.target) && event.target !== this.#anchor) {
          this.close();
        }
      });
    }
  }

  get isOpen() {
    return supported ? this.#element.matches(":popover-open") : !this.#element.hidden;
  }

  // A button that opens (or closes) the menu. beforeOpen() runs first.
  addInvoker(button, beforeOpen = () => {}) {
    button.setAttribute("aria-expanded", "false");
    if (supported) {
      button.setAttribute("popovertarget", this.#element.id);
      // Runs before the browser toggles the popover.
      button.addEventListener("click", () => {
        if (this.#anchor && this.#anchor !== button) {
          this.#anchor.setAttribute("aria-expanded", "false");
        }
        this.#anchor = button;
        if (!this.isOpen) beforeOpen();
      });
    } else {
      button.addEventListener("click", () => {
        const wasOpenHere = this.isOpen && this.#anchor === button;
        this.close();
        if (wasOpenHere) return;
        this.#anchor = button;
        beforeOpen();
        this.#element.hidden = false;
        button.setAttribute("aria-expanded", "true");
        this.#place();
      });
    }
  }

  close() {
    if (!this.isOpen) return;
    if (supported) {
      this.#element.hidePopover();
    } else {
      this.#element.hidden = true;
      this.#anchor?.setAttribute("aria-expanded", "false");
    }
  }

  // Next to the button, inside the window; then focus moves in.
  #place() {
    const element = this.#element;
    const anchor = this.#anchor?.getBoundingClientRect();
    if (!anchor) return;
    const { offsetWidth: width, offsetHeight: height } = element;
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2 - width / 2, EDGE),
      innerWidth - width - EDGE,
    );
    const above = anchor.top - height - EDGE;
    const below = anchor.bottom + EDGE;
    // The preferred side, unless only the other one has room.
    let top = this.#side === "above" ? above : below;
    if (top === above && above < EDGE && below + height <= innerHeight - EDGE) top = below;
    if (top === below && below + height > innerHeight - EDGE && above >= EDGE) top = above;
    element.style.setProperty("--menu-left", `${Math.round(Math.max(left, EDGE))}px`);
    element.style.setProperty("--menu-top", `${Math.round(Math.max(top, EDGE))}px`);
    element.dataset.placed = "true";
    element.querySelector("button:not([hidden])")?.focus();
  }
}
