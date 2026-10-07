// Keyboard shortcuts, as in Google Meet. Every one of them needs Ctrl or
// ⌘, so they never get in the way of typing or of a screen reader's
// single-key navigation (WCAG 2.1.4).
//
// "mod" is Ctrl (⌘ on Apple devices). "panel" is Ctrl+Alt (Ctrl+⌘ on
// Apple devices, where ⌘+Option combinations open the developer tools).
import { strings } from "../strings.js";

export const SHORTCUTS = [
  { action: "mic", key: "d", combo: "mod", description: strings.shortcuts.mic },
  { action: "camera", key: "e", combo: "mod", description: strings.shortcuts.camera },
  { action: "chat", key: "c", combo: "panel", description: strings.shortcuts.chat },
  { action: "people", key: "p", combo: "panel", description: strings.shortcuts.people },
  { action: "hand", key: "h", combo: "panel", description: strings.shortcuts.hand },
  { action: "help", key: "/", combo: "mod", description: strings.shortcuts.help },
];

// Each combo's modifier keys, by their KeyboardEvent names.
const MODIFIERS = {
  mod: { apple: ["Meta"], other: ["Control"] },
  panel: { apple: ["Control", "Meta"], other: ["Control", "Alt"] },
};
const LABELS = {
  apple: { Control: "⌃", Meta: "⌘" },
  other: { Control: "Ctrl", Alt: "Alt" },
};

export const isApple = (platform = navigator.userAgentData?.platform ?? navigator.platform ?? "") =>
  /mac|iphone|ipad|ipod/i.test(platform);

// The letter a key press means, on any keyboard layout: the typed letter
// on Latin layouts, or else the physical key (e.g. "в" on a Russian
// layout is the D key).
function letterOf(event) {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (event.code?.startsWith("Key")) return event.code.slice(3).toLowerCase();
  return event.key;
}

// Whether a keydown event is the given shortcut. Exported for tests.
export function matches(event, { key, combo }, { apple = isApple() } = {}) {
  // AltGr reports as Ctrl+Alt on Windows but types characters (é, ł, @…).
  if (event.getModifierState?.("AltGraph")) return false;
  const wanted = MODIFIERS[combo][apple ? "apple" : "other"];
  const held = { Control: event.ctrlKey, Meta: event.metaKey, Alt: event.altKey };
  if (Object.entries(held).some(([name, down]) => down !== wanted.includes(name))) return false;
  // "/" needs Shift on some layouts (and gives "?" on others).
  if (key === "/") return event.key === "/" || event.key === "?";
  return !event.shiftKey && letterOf(event) === key;
}

// The keys to show for a shortcut, e.g. ["Ctrl", "D"] or ["⌘", "D"].
export function keysFor({ key, combo }, { apple = isApple() } = {}) {
  const platform = apple ? "apple" : "other";
  return [...MODIFIERS[combo][platform].map((m) => LABELS[platform][m]), key.toUpperCase()];
}

// The same as one string: "Ctrl+D", or "⌘D" in Apple style.
export const describeKeys = (shortcut, { apple = isApple() } = {}) =>
  keysFor(shortcut, { apple }).join(apple ? "" : "+");

// The value for aria-keyshortcuts, e.g. "Control+D".
export const ariaFor = ({ key, combo }, { apple = isApple() } = {}) =>
  [...MODIFIERS[combo][apple ? "apple" : "other"], key.toUpperCase()].join("+");

export const shortcutFor = (action) => SHORTCUTS.find((s) => s.action === action);

// Calls handlers[action](event) for each shortcut pressed.
export function bindShortcuts(target, handlers) {
  target.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const shortcut = SHORTCUTS.find((s) => handlers[s.action] && matches(event, s));
    if (!shortcut) return;
    event.preventDefault(); // e.g. Ctrl+D would bookmark the page
    // Holding the keys down toggles once, not on every repeat.
    if (!event.repeat) handlers[shortcut.action](event);
  });
}
