const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, nextEvent, collect, uniqueRoom, join } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

async function pair() {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  await join(alice, room, "peer-a", "Alice");
  await join(bob, room, "peer-b", "Bob");
  return { room, alice, bob };
}

test("messages reach everyone with the sender's name and peer ID", async () => {
  const { alice, bob } = await pair();
  const atBob = nextEvent(bob, "createMessage");
  const atAlice = nextEvent(alice, "createMessage");
  alice.emit("message", "  hello  ");
  assert.deepEqual(await atBob, ["hello", "Alice", "peer-a"]);
  assert.deepEqual(await atAlice, ["hello", "Alice", "peer-a"]);
});

test("messages are capped at 1000 characters", async () => {
  const { alice, bob } = await pair();
  const received = nextEvent(bob, "createMessage");
  alice.emit("message", "x".repeat(5000));
  assert.equal((await received)[0].length, 1000);
});

test("empty and non-string messages are dropped", async () => {
  const { alice, bob } = await pair();
  const received = collect(bob, "createMessage");
  alice.emit("message", "   ");
  alice.emit("message", { html: "<img src=x onerror=alert(1)>" });
  alice.emit("message", 42);
  assert.equal((await received).length, 0);
});

test("sockets that haven't joined a room can't send anything", async () => {
  const { bob } = await pair();
  const stranger = await app.client();
  const received = collect(bob, "createMessage");
  stranger.emit("message", "hi");
  stranger.emit("typing");
  assert.equal((await received).length, 0);
});

test("repeated join-room on one socket doesn't duplicate messages", async () => {
  const { room, alice, bob } = await pair();
  await join(alice, room, "peer-a", "Alice");
  await join(alice, room, "peer-a", "Alice");
  const received = collect(bob, "createMessage");
  alice.emit("message", "once");
  assert.equal((await received).length, 1);
});

test("typing notices carry the typer's name and skip the typer", async () => {
  const { alice, bob } = await pair();
  const ownEcho = collect(alice, "typing");
  const typing = nextEvent(bob, "typing");
  alice.emit("typing");
  assert.deepEqual(await typing, ["Alice"]);

  const stopped = nextEvent(bob, "stoppedTyping");
  alice.emit("stoppedTyping");
  assert.deepEqual(await stopped, ["Alice"]);
  assert.equal((await ownEcho).length, 0);
});

test("net:ping is acknowledged", async () => {
  const alice = await app.client();
  await alice.timeout(1000).emitWithAck("net:ping");
});

test("message contents and names are not logged", async (t) => {
  const { alice, bob } = await pair();
  const lines = [];
  for (const level of ["log", "info", "warn", "error"]) {
    t.mock.method(console, level, (...args) => lines.push(args.join(" ")));
  }
  const received = nextEvent(bob, "createMessage");
  alice.emit("message", "top secret plans");
  await received;
  lines.push(...app.logs);
  assert.ok(!lines.some((line) => /top secret|Alice/.test(line)), lines.join("\n"));
});
