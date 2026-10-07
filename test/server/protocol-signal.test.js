const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { io: connect } = require("socket.io-client");
const { startTestServer, nextEvent, collect, uniqueRoom, joinRoom, ack } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

async function pair() {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  const a = await joinRoom(alice, room, "Alice");
  const b = await joinRoom(bob, room, "Bob");
  return { alice, bob, aliceId: a.self.id, bobId: b.self.id };
}

test("offers and answers are relayed to one participant, stamped with the sender", async () => {
  const { alice, bob, aliceId, bobId } = await pair();
  const offer = nextEvent(bob, "rtc:signal");
  const reply = await ack(alice, "rtc:signal", {
    to: bobId,
    description: { type: "offer", sdp: "v=0\r\n" },
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(await offer, [
    { from: aliceId, description: { type: "offer", sdp: "v=0\r\n" } },
  ]);
});

test("ICE candidates are relayed with only the expected fields", async () => {
  const { alice, bob, aliceId, bobId } = await pair();
  const relayed = nextEvent(bob, "rtc:signal");
  await ack(alice, "rtc:signal", {
    to: bobId,
    candidate: { candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0", extra: "x" },
  });
  assert.deepEqual(await relayed, [
    {
      from: aliceId,
      candidate: {
        candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host",
        sdpMid: "0",
        sdpMLineIndex: null,
        usernameFragment: null,
      },
    },
  ]);
});

test("signals can't reach people in other rooms or who don't exist", async () => {
  const { alice } = await pair();
  const other = await pair();
  const leaked = collect(other.bob, "rtc:signal");
  for (const to of [other.bobId, "no-such-person"]) {
    const reply = await ack(alice, "rtc:signal", { to, candidate: { candidate: "" } });
    assert.equal(reply.error, "unknown-peer");
  }
  assert.equal((await leaked).length, 0);
});

test("malformed signals are rejected", async () => {
  const { alice, bobId } = await pair();
  const bad = [
    { to: bobId },
    { to: bobId, description: { type: "offer", sdp: "v=0" }, candidate: { candidate: "" } },
    { to: bobId, description: { type: "pranswer", sdp: "v=0" } },
    { to: bobId, description: { type: "offer", sdp: "x".repeat(40 * 1024) } },
    { to: bobId, candidate: { candidate: 5 } },
    { to: bobId, candidate: { sdpMLineIndex: -1 } },
    { to: 42, candidate: {} },
  ];
  for (const payload of bad) {
    assert.equal((await ack(alice, "rtc:signal", payload)).error, "invalid-payload");
  }
});

test("connections from other websites are refused", async () => {
  const attempt = (origin) =>
    new Promise((resolve) => {
      const socket = connect(app.url, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        extraHeaders: { Origin: origin },
      });
      socket.once("connect", () => resolve("connected") || socket.disconnect());
      socket.once("connect_error", () => resolve("refused"));
    });
  assert.equal(await attempt("https://evil.example"), "refused");
  assert.equal(await attempt(app.url), "connected");
});
