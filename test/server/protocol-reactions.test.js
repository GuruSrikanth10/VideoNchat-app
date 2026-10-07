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
  return { room, alice, bob, aliceId: a.self.id, bobId: b.self.id };
}

test("raising a hand tells the others when it went up", async () => {
  const { alice, bob, aliceId } = await pair();
  const updated = nextEvent(bob, "participant:updated");
  const before = Date.now();
  const reply = await ack(alice, "hand:set", { raised: true });
  const [participant] = await updated;
  assert.equal(participant.id, aliceId);
  assert.equal(participant.hand, reply.hand);
  assert.ok(reply.hand >= before && reply.hand <= Date.now());

  const lowered = nextEvent(bob, "participant:updated");
  assert.deepEqual(await ack(alice, "hand:set", { raised: false }), { ok: true, hand: null });
  assert.equal((await lowered)[0].hand, null);
});

test("raising a hand twice keeps its place in the queue", async () => {
  const { alice } = await pair();
  const first = await ack(alice, "hand:set", { raised: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await ack(alice, "hand:set", { raised: true });
  assert.equal(second.hand, first.hand);
});

test("newcomers see who has a hand up", async () => {
  const { room, alice, aliceId } = await pair();
  const { hand } = await ack(alice, "hand:set", { raised: true });
  const carol = await app.client();
  const reply = await joinRoom(carol, room, "Carol");
  assert.equal(reply.participants.find((p) => p.id === aliceId).hand, hand);
});

test("reactions go to everyone else, stamped with the sender", async () => {
  const { alice, bob, aliceId } = await pair();
  const received = nextEvent(bob, "reaction");
  const echo = collect(alice, "reaction", 300);
  assert.deepEqual(await ack(alice, "reaction:send", { emoji: "🎉" }), { ok: true });
  assert.deepEqual(await received, [{ from: aliceId, emoji: "🎉" }]);
  assert.equal((await echo).length, 0, "the sender shows their own reaction");
});

test("only the listed reactions are relayed", async () => {
  const { alice, bob } = await pair();
  const relayed = collect(bob, "reaction", 300);
  for (const emoji of ["💩", "<b>hi</b>", "", 5, null]) {
    assert.equal((await ack(alice, "reaction:send", { emoji })).error, "invalid-payload");
  }
  assert.equal((await ack(alice, "hand:set", { raised: "yes" })).error, "invalid-payload");
  assert.equal((await relayed).length, 0);
});

test("reactions are rate limited", async () => {
  const { alice } = await pair();
  const replies = [];
  for (let i = 0; i < 12; i++) replies.push(await ack(alice, "reaction:send", { emoji: "👍" }));
  assert.equal(replies.at(-1).error, "rate-limited");
});

test("hands and reactions need you to be in a room", async () => {
  const stranger = await app.client();
  assert.equal((await ack(stranger, "hand:set", { raised: true })).error, "not-joined");
  assert.equal((await ack(stranger, "reaction:send", { emoji: "👍" })).error, "not-joined");
});

test("everyone is told who is recording, including late joiners and the lobby", async () => {
  const { room, alice, bob, aliceId } = await pair();
  const updated = nextEvent(bob, "participant:updated");
  assert.deepEqual(await ack(alice, "recording:set", { recording: true }), { ok: true });
  const [view] = await updated;
  assert.equal(view.id, aliceId);
  assert.equal(view.recording, true);

  const visitor = await app.client();
  assert.equal((await ack(visitor, "room:peek", { roomId: room })).recording, true);
  const carol = await app.client();
  const reply = await joinRoom(carol, room, "Carol");
  assert.equal(reply.participants.find((p) => p.id === aliceId).recording, true);

  const stopped = nextEvent(bob, "participant:updated");
  await ack(alice, "recording:set", { recording: false });
  assert.equal((await stopped)[0].recording, false);
  assert.equal((await ack(visitor, "room:peek", { roomId: room })).recording, false);
  assert.equal((await ack(alice, "recording:set", { recording: "yes" })).error, "invalid-payload");
});
