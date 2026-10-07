// Short, non-blocking notifications, announced politely to screen readers.
import { icon } from "./icons.js";

const ICONS = {
  info: "info",
  success: "check",
  warning: "triangle-alert",
  error: "triangle-alert",
};

export function toast(message, { tone = "info", duration = 4000 } = {}) {
  const region = document.getElementById("toasts");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  const text = document.createElement("span");
  text.textContent = message;
  item.append(icon(ICONS[tone] ?? "info"), text);
  region.append(item);
  setTimeout(() => {
    item.classList.add("toast--leaving");
    setTimeout(() => item.remove(), 300);
  }, duration);
}

// Tells screen reader users about a change they didn't move focus to,
// such as the mic turning off from a keyboard shortcut.
export function announce(message) {
  const region = document.getElementById("announcer");
  if (!region) return;
  // Clear first so the same message twice in a row is still read out.
  region.textContent = "";
  setTimeout(() => (region.textContent = message), 50);
}
