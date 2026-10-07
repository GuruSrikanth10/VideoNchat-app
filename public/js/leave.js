// Offers to rejoin the meeting you just left.
const room = new URLSearchParams(location.search).get("room");
if (room && /^[\w-]{1,64}$/.test(room)) {
  const rejoin = document.getElementById("rejoin");
  rejoin.href = `/${encodeURIComponent(room)}`;
  rejoin.hidden = false;
}
