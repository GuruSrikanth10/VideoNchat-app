const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLimiter } = require("../../src/server/rate-limit");
const { RoomRegistry, HISTORY_SIZE } = require("../../src/server/rooms");
const { isAllowedOrigin } = require("../../src/server/realtime");

test("token buckets allow a burst, then refill over time", () => {
  let time = 0;
  const limiter = createLimiter({ default: { capacity: 3, perSecond: 2 } }, () => time);
  assert.deepEqual(
    [1, 2, 3, 4].map(() => limiter.allow("x")),
    [true, true, true, false],
  );
  time += 500; // one token back
  assert.equal(limiter.allow("x"), true);
  assert.equal(limiter.allow("x"), false);
  assert.equal(limiter.allow("y"), true, "each event has its own bucket");
});

test("room history keeps only the most recent messages", () => {
  const rooms = new RoomRegistry({ maxRoomSize: 6 });
  rooms.join("r", { name: "A", socketId: "s" });
  for (let i = 0; i < HISTORY_SIZE + 10; i++) rooms.addMessage("r", { text: String(i) });
  const { history } = rooms.get("r");
  assert.equal(history.length, HISTORY_SIZE);
  assert.equal(history[0].text, "10");
});

test("origin checks follow PUBLIC_URL, or else the Host header", () => {
  const req = (origin, host = "meet.example.com") => ({ headers: { origin, host } });
  const open = { publicUrl: null };
  assert.equal(isAllowedOrigin(req(undefined), open), true);
  assert.equal(isAllowedOrigin(req("https://meet.example.com"), open), true);
  assert.equal(isAllowedOrigin(req("https://evil.example"), open), false);
  assert.equal(isAllowedOrigin(req("not a url"), open), false);

  const pinned = { publicUrl: "https://meet.example.com" };
  assert.equal(isAllowedOrigin(req("https://meet.example.com", "internal:3000"), pinned), true);
  assert.equal(isAllowedOrigin(req("http://meet.example.com"), pinned), false);
});
