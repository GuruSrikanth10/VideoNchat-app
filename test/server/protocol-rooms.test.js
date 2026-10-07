const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, nextEvent, collect, uniqueRoom, joinRoom, ack } = require("./helpers");

let app;
before(async () => (app = await startTestServer({ RECONNECT_GRACE_SECONDS: "1" })));
after(() => app.close());

test("the first person joins an empty room and gets an ID and session", async () => {
  const alice = await app.client();
  const reply = await joinRoom(alice, uniqueRoom(), "  Alice  ");
  assert.equal(reply.ok, true);
  assert.equal(reply.resumed, false);
  assert.match(reply.self.id, /^[0-9a-f-]{36}$/);
  assert.equal(reply.self.name, "Alice");
  assert.ok(reply.self.session.length >= 32);
  assert.deepEqual(reply.participants, []);
  assert.deepEqual(reply.history, []);
});

test("newcomers learn who is there, and everyone learns about the newcomer", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const first = await joinRoom(alice, room, "Alice");

  const bob = await app.client();
  const announced = nextEvent(alice, "participant:joined");
  const reply = await joinRoom(bob, room, "Bob");

  assert.deepEqual(reply.participants, [
    {
      id: first.self.id,
      name: "Alice",
      audio: false,
      video: false,
      screen: false,
      hand: null,
      host: true,
      recording: false,
    },
  ]);
  const [joined] = await announced;
  assert.equal(joined.id, reply.self.id);
  assert.equal(joined.name, "Bob");
  assert.equal(joined.session, undefined, "sessions are never shared");
});

test("join requests are validated", async () => {
  const socket = await app.client();
  assert.equal((await joinRoom(socket, "bad/room", "X")).error, "invalid-room");
  assert.equal((await joinRoom(socket, uniqueRoom(), "   ")).error, "invalid-name");
  assert.equal(
    (await joinRoom(socket, uniqueRoom(), "X", "bad session!")).error,
    "invalid-session",
  );
  assert.equal((await ack(socket, "room:join", "nope")).error, "invalid-payload");
});

test("a socket can only be in one room", async () => {
  const socket = await app.client();
  assert.equal((await joinRoom(socket, uniqueRoom(), "X")).ok, true);
  assert.equal((await joinRoom(socket, uniqueRoom(), "X")).error, "already-joined");
});

test("repeated join attempts are rate limited", async () => {
  const socket = await app.client();
  const replies = [];
  for (let i = 0; i < 7; i++) replies.push(await joinRoom(socket, "bad/room", "X"));
  assert.equal(replies.at(-1).error, "rate-limited");
});

test("names are capped at 40 characters", async () => {
  const socket = await app.client();
  const reply = await joinRoom(socket, uniqueRoom(), "n".repeat(100));
  assert.equal(reply.self.name.length, 40);
});

test("leaving tells everyone immediately and empty rooms disappear", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await joinRoom(alice, room, "Alice");
  const { self } = await joinRoom(bob, room, "Bob");

  const left = nextEvent(alice, "participant:left");
  assert.equal((await ack(bob, "room:leave")).ok, true);
  assert.deepEqual(await left, [{ id: self.id }]);

  const rooms = async () => (await (await fetch(`${app.url}/healthz`)).json()).rooms;
  const before = await rooms();
  await ack(alice, "room:leave");
  assert.equal(await rooms(), before - 1);
});

test("a dropped connection only counts as leaving after the grace period", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await joinRoom(alice, room, "Alice");
  const { self } = await joinRoom(bob, room, "Bob");

  const early = collect(alice, "participant:left", 500);
  bob.io.engine.close(); // like a network drop: no explicit disconnect
  assert.equal((await early).length, 0);
  assert.deepEqual(await nextEvent(alice, "participant:left", 2000), [{ id: self.id }]);
});

test("a reconnecting tab resumes its place silently with its session", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  const aliceJoin = await joinRoom(alice, room, "Alice");
  const { self } = await joinRoom(bob, room, "Bob");

  const noise = collect(alice, "participant:left", 1500);
  const noJoin = collect(alice, "participant:joined", 1500);
  bob.io.engine.close();
  const bobAgain = await app.client();
  const reply = await joinRoom(bobAgain, room, "Bob", self.session);

  assert.equal(reply.ok, true);
  assert.equal(reply.resumed, true);
  assert.equal(reply.self.id, self.id);
  assert.deepEqual(
    reply.participants.map((p) => p.id),
    [aliceJoin.self.id],
  );
  assert.equal((await noise).length, 0);
  assert.equal((await noJoin).length, 0);

  // Signals for Bob now reach the new socket.
  const signal = nextEvent(bobAgain, "rtc:signal");
  await ack(alice, "rtc:signal", { to: self.id, description: { type: "offer", sdp: "v=0" } });
  assert.equal((await signal)[0].from, aliceJoin.self.id);
});

test("signals sent while someone reconnects are delivered when they're back", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  const a = await joinRoom(alice, room, "Alice");
  const { self } = await joinRoom(bob, room, "Bob");

  bob.io.engine.close();
  await new Promise((resolve) => setTimeout(resolve, 100)); // server notices the drop
  const sent = await ack(alice, "rtc:signal", { to: self.id, candidate: { candidate: "c1" } });
  assert.deepEqual(sent, { ok: true, queued: true });

  const bobAgain = await app.client();
  const delivered = nextEvent(bobAgain, "rtc:signal");
  await joinRoom(bobAgain, room, "Bob", self.session);
  const [signal] = await delivered;
  assert.equal(signal.from, a.self.id);
  assert.equal(signal.candidate.candidate, "c1");
});

test("a wrong session just joins as someone new", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const { self } = await joinRoom(alice, room, "Alice");
  const intruder = await app.client();
  const reply = await joinRoom(intruder, room, "Alice", "x".repeat(32));
  assert.equal(reply.resumed, false);
  assert.notEqual(reply.self.id, self.id);
});

test("late joiners get the recent chat history, up to 50 messages", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  await joinRoom(alice, room, "Alice");
  // Spread out to stay within the chat rate limit.
  for (let i = 1; i <= 3; i++) await ack(alice, "chat:send", { text: `message ${i}` });

  const bob = await app.client();
  const { history } = await joinRoom(bob, room, "Bob");
  assert.deepEqual(
    history.map((m) => m.text),
    ["message 1", "message 2", "message 3"],
  );
});
