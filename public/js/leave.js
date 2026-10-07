// Offers to rejoin the meeting you just left, and says how long it lasted.
import { isMeetingCode } from "./lib/meeting-code.js";
import { formatDuration } from "./lib/duration.js";
import { session } from "./lib/storage.js";
import { strings } from "./strings.js";

const LAST_CALL_KEY = "videonchat:last-call";

const params = new URLSearchParams(location.search);
const room = params.get("room");
const removed = params.get("reason") === "removed";

if (removed) {
  document.getElementById("leave-title").textContent = strings.leave.removedTitle;
  document.getElementById("leave-body").textContent = strings.leave.removedBody;
  document.title = `${strings.leave.removedTitle} · VideoNChat`;
} else if (room && isMeetingCode(room)) {
  const rejoin = document.getElementById("rejoin");
  rejoin.href = `/${encodeURIComponent(room)}`;
  rejoin.hidden = false;
}

let lastCall = null;
try {
  lastCall = JSON.parse(session.get(LAST_CALL_KEY) ?? "null");
} catch {
  // ignore anything unreadable
}
if (lastCall?.room === room && Number.isFinite(lastCall.seconds)) {
  const duration = document.getElementById("call-duration");
  // Worded in the page's language, to match the sentence around it.
  const words = formatDuration(lastCall.seconds, document.documentElement.lang || undefined);
  duration.textContent = strings.leave.duration(words);
  duration.hidden = false;
}
