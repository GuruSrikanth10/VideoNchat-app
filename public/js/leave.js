// Offers to rejoin the meeting you just left, and says how long it lasted.
import { isMeetingCode } from "./lib/meeting-code.js";
import { formatDuration } from "./lib/duration.js";
import { session } from "./lib/storage.js";

const LAST_CALL_KEY = "videonchat:last-call";

const room = new URLSearchParams(location.search).get("room");
if (room && isMeetingCode(room)) {
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
  duration.textContent = `You were in the meeting for ${formatDuration(lastCall.seconds)}.`;
  duration.hidden = false;
}
