// Offers to rejoin the meeting you just left.
import { isMeetingCode } from "./lib/meeting-code.js";

const room = new URLSearchParams(location.search).get("room");
if (room && isMeetingCode(room)) {
  const rejoin = document.getElementById("rejoin");
  rejoin.href = `/${encodeURIComponent(room)}`;
  rejoin.hidden = false;
}
