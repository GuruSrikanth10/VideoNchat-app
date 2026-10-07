const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
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

test("chat messages carry a server ID, sender, name and timestamp", async () => {
  const { alice, bob, aliceId } = await pair();
  const received = nextEvent(bob, "chat:message");
  const before = Date.now();
  const reply = await ack(alice, "chat:send", { text: "  hello  " });
  const [message] = await received;
  assert.equal(reply.ok, true);
  assert.equal(message.id, reply.id);
  assert.equal(message.from, aliceId);
  assert.equal(message.name, "Alice");
  assert.equal(message.text, "hello");
  assert.ok(message.ts >= before && message.ts <= Date.now());
});

test("invalid chat messages are rejected", async () => {
  const { alice, bob } = await pair();
  const leaked = collect(bob, "chat:message");
  assert.equal((await ack(alice, "chat:send", { text: "   " })).error, "empty-message");
  assert.equal((await ack(alice, "chat:send", { text: 42 })).error, "invalid-payload");
  assert.equal((await ack(alice, "chat:send", "plain string")).error, "invalid-payload");
  assert.equal((await leaked).length, 0);

  const long = nextEvent(bob, "chat:message");
  await ack(alice, "chat:send", { text: "y".repeat(3000) });
  assert.equal((await long)[0].text.length, 1000);
});

test("you must join a room before doing anything", async () => {
  const stranger = await app.client();
  for (const [event, payload] of [
    ["chat:send", { text: "hi" }],
    ["chat:typing", { typing: true }],
    ["media:state", { audio: true }],
    ["rtc:signal", { to: "someone", candidate: {} }],
    ["room:leave", undefined],
  ]) {
    assert.equal((await ack(stranger, event, payload)).error, "not-joined", event);
  }
});

test("typing notices go to the others with the typer's name", async () => {
  const { alice, bob, aliceId } = await pair();
  const echo = collect(alice, "chat:typing");
  const typing = nextEvent(bob, "chat:typing");
  await ack(alice, "chat:typing", { typing: true });
  assert.deepEqual(await typing, [{ from: aliceId, name: "Alice", typing: true }]);
  assert.equal((await echo).length, 0);
  assert.equal((await ack(alice, "chat:typing", { typing: "yes" })).error, "invalid-payload");
});

test("media state is shared with others and with late joiners", async () => {
  const room = uniqueRoom();
  const alice = await app.client();
  const bob = await app.client();
  const { self } = await joinRoom(alice, room, "Alice");
  await joinRoom(bob, room, "Bob");

  const updated = nextEvent(bob, "participant:updated");
  assert.equal((await ack(alice, "media:state", { audio: true, video: false })).ok, true);
  assert.deepEqual(await updated, [
    { id: self.id, name: "Alice", audio: true, video: false, screen: false },
  ]);
  assert.equal((await ack(alice, "media:state", { video: "on" })).error, "invalid-payload");
  assert.equal((await ack(alice, "media:state", {})).error, "invalid-payload");

  const carol = await app.client();
  const { participants } = await joinRoom(carol, room, "Carol");
  assert.equal(participants.find((p) => p.id === self.id).audio, true);
});

test("each kind of message is rate limited", async () => {
  const { alice, bob } = await pair();
  const received = collect(bob, "chat:message", 500);
  const replies = await Promise.all(
    Array.from({ length: 15 }, (_, i) => ack(alice, "chat:send", { text: `spam ${i}` })),
  );
  const limited = replies.filter((r) => r.error === "rate-limited").length;
  assert.ok(limited >= 4, `expected some messages to be dropped, got ${limited}`);
  assert.equal((await received).length, 15 - limited);
});
