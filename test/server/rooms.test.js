const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, nextEvent, collect, uniqueRoom, join, secret } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

test("joining announces the newcomer to the others, not to themselves", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await join(alice, room, "peer-alice", "Alice");

  const seenByBob = collect(bob, "user-connected");
  const announced = nextEvent(alice, "user-connected");
  await join(bob, room, "peer-bob", "Bob");

  assert.deepEqual(await announced, ["peer-bob", "Bob"]);
  assert.equal((await seenByBob).length, 0);
});

test("leaving announces the departure with the leaver's peer ID", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await join(alice, room, "peer-a", "Alice");
  await join(bob, room, "peer-b", "Bob");

  const gone = nextEvent(alice, "user-disconnected");
  bob.disconnect();
  assert.deepEqual(await gone, ["peer-b"]);
});

test("rooms are isolated from each other", async () => {
  const alice = await app.client();
  const eve = await app.client();
  await join(alice, uniqueRoom(), "peer-a", "Alice");
  await join(eve, uniqueRoom(), "peer-e", "Eve");

  const leaked = collect(eve, "createMessage");
  alice.emit("message", "private");
  assert.equal((await leaked).length, 0);
});

test("invalid join requests are ignored", async () => {
  const room = uniqueRoom();
  const watcher = await app.client();
  await join(watcher, room, "peer-w", "Watcher");
  const announced = collect(watcher, "user-connected", 400);

  const bad = await app.client();
  bad.emit("join-room", "bad room/../id", "peer-x", "X", secret()); // room ID format
  bad.emit("join-room", room, { not: "a string" }, "X", secret()); // peer ID type
  bad.emit("join-room", room, "peer-x", "X"); // missing secret
  bad.emit("join-room", room, "p".repeat(65), "X", secret()); // too long

  assert.equal((await announced).length, 0);
});

test("names are trimmed, capped at 40 characters and default to Guest", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  await join(alice, room, "peer-a", "Alice");

  const long = await app.client();
  const first = nextEvent(alice, "user-connected");
  await join(long, room, "peer-long", `  ${"n".repeat(60)}  `);
  assert.equal((await first)[1], "n".repeat(40));

  const blank = await app.client();
  const second = nextEvent(alice, "user-connected");
  await join(blank, room, "peer-blank", "   ");
  assert.equal((await second)[1], "Guest");
});
