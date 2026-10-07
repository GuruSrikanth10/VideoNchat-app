const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, nextEvent, collect, uniqueRoom, join } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

test("someone else's peer ID can't be claimed", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await join(alice, room, "peer-a", "Alice");
  await join(bob, room, "peer-b", "Bob");

  const events = collect(bob, "user-disconnected", 500);
  const impostor = await app.client();
  await join(impostor, room, "peer-a", "Not Alice"); // different secret
  impostor.disconnect();

  assert.equal((await events).length, 0, "nobody should be told Alice left");
});

test("a reconnecting tab can reclaim its own peer ID", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  const tabSecret = await join(alice, room, "peer-a", "Alice");
  await join(bob, room, "peer-b", "Bob");

  // Alice's connection is replaced by a new socket from the same tab.
  const left = nextEvent(bob, "user-disconnected");
  const back = nextEvent(bob, "user-connected");
  const staleDropped = nextEvent(alice, "disconnect");
  const aliceAgain = await app.client();
  await join(aliceAgain, room, "peer-a", "Alice", tabSecret);

  assert.deepEqual(await left, ["peer-a"]);
  assert.deepEqual(await back, ["peer-a", "Alice"]);
  await staleDropped; // the stale socket was dropped

  const received = nextEvent(bob, "createMessage");
  aliceAgain.emit("message", "I'm back");
  assert.deepEqual(await received, ["I'm back", "Alice", "peer-a"]);
});
