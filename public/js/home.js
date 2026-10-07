// The landing page: start a meeting, or join one from a link or code.
import { hydrateIcons } from "./ui/icons.js";
import { parseMeetingCode } from "./lib/meeting-code.js";

hydrateIcons();

const form = document.getElementById("join-form");
const input = document.getElementById("join-code");
const error = document.getElementById("join-error");

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = parseMeetingCode(input.value, location.origin);
  if (!code) {
    error.textContent = input.value.trim()
      ? "That doesn't look like a meeting link or code from this site."
      : "Enter the meeting link or code you were sent.";
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  location.assign(`/${encodeURIComponent(code)}`);
});

input?.addEventListener("input", () => {
  error.textContent = "";
  input.removeAttribute("aria-invalid");
});
