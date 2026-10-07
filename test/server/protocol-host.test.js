const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, nextEvent, collect, uniqueRoom, joinRoom, ack } = require("./helpers");
const { RoomRegistry, TICKET_TTL_MS } = require("../../src/server/rooms");

let app;
before(async () => (app = await startTestServer({ RECONNECT_GRACE_SECONDS: "1" })));
after(() => app.close());

async function meeting(...names) {
  const room = uniqueRoom();
  const people = [];
  for (const name of names) {
    const socket = await app.client();
    const reply = await joinRoom(socket, room, name);
    people.push({ socket, id: reply.self.id, session: reply.self.session, reply });
  }
  return { room, people };
}

const knock = (socket, roomId, name) => ack(socket, "room:knock", { roomId, name });

test("the first person in is the host", async () => {
  const { people } = await meeting("Alice", "Bob");
  const [alice, bob] = people;
  assert.equal(alice.reply.self.host, true);
  assert.equal(bob.reply.self.host, false);
  assert.equal(bob.reply.participants[0].host, true);
});

test("when the host leaves, whoever has been there longest takes over", async () => {
  const { people } = await meeting("Alice", "Bob", "Carol");
  const [alice, bob, carol] = people;
  const promoted = nextEvent(carol.socket, "participant:updated");
  await ack(alice.socket, "room:leave");
  const [view] = await promoted;
  assert.equal(view.id, bob.id);
  assert.equal(view.host, true);
  // Bob can now use host controls.
  assert.deepEqual(await ack(bob.socket, "room:lock", { locked: true }), { ok: true });
});

test("only hosts can use host controls", async () => {
  const { people } = await meeting("Alice", "Bob");
  const [alice, bob] = people;
  for (const [event, payload] of [
    ["room:lock", { locked: true }],
    ["host:mute", { id: alice.id }],
    ["host:ask-unmute", { id: alice.id }],
    ["host:lower-hand", { id: alice.id }],
    ["host:remove", { id: alice.id }],
    ["knock:answer", { id: alice.id, admit: true }],
  ]) {
    assert.equal((await ack(bob.socket, event, payload)).error, "not-host", event);
  }
  const stranger = await app.client();
  assert.equal((await ack(stranger, "room:lock", { locked: true })).error, "not-joined");
});

test("host actions need someone else in the same room", async () => {
  const { people } = await meeting("Alice");
  const other = await meeting("Zed");
  const [alice] = people;
  assert.equal(
    (await ack(alice.socket, "host:mute", { id: alice.id })).error,
    "unknown-participant",
  );
  assert.equal(
    (await ack(alice.socket, "host:remove", { id: other.people[0].id })).error,
    "unknown-participant",
  );
  assert.equal((await ack(alice.socket, "host:mute", { id: "bad id!" })).error, "invalid-payload");
});

test("a locked room turns newcomers away, and everyone knows it's locked", async () => {
  const { room, people } = await meeting("Alice", "Bob");
  const [alice, bob] = people;
  const updated = nextEvent(bob.socket, "room:updated");
  await ack(alice.socket, "room:lock", { locked: true });
  assert.deepEqual(await updated, [{ locked: true }]);

  const carol = await app.client();
  assert.equal((await joinRoom(carol, room, "Carol")).error, "room-locked");
  const peek = await ack(carol, "room:peek", { roomId: room });
  assert.equal(peek.locked, true);
});

test("someone let in from a locked room gets in once with their ticket", async () => {
  const { room, people } = await meeting("Alice");
  const [alice] = people;
  await ack(alice.socket, "room:lock", { locked: true });

  const carol = await app.client();
  const request = nextEvent(alice.socket, "knock:request");
  const knocked = await knock(carol, room, "  Carol  ");
  assert.equal(knocked.ok, true);
  const [knockView] = await request;
  assert.deepEqual(knockView, { id: knocked.id, name: "Carol" });

  const answered = nextEvent(carol, "knock:answered");
  const resolved = nextEvent(alice.socket, "knock:resolved");
  assert.deepEqual(await ack(alice.socket, "knock:answer", { id: knocked.id, admit: true }), {
    ok: true,
  });
  const [{ admitted, ticket }] = await answered;
  assert.equal(admitted, true);
  assert.deepEqual(await resolved, [{ id: knocked.id, admitted: true }]);

  const reply = await ack(carol, "room:join", { roomId: room, name: "Carol", ticket });
  assert.equal(reply.ok, true);
  assert.equal(reply.locked, true);

  // The ticket was used up.
  const dave = await app.client();
  const again = await ack(dave, "room:join", { roomId: room, name: "Dave", ticket });
  assert.equal(again.error, "room-locked");
});

test("a host can turn someone away", async () => {
  const { room, people } = await meeting("Alice");
  await ack(people[0].socket, "room:lock", { locked: true });
  const carol = await app.client();
  const request = nextEvent(people[0].socket, "knock:request");
  await knock(carol, room, "Carol");
  const [{ id }] = await request;
  const answered = nextEvent(carol, "knock:answered");
  await ack(people[0].socket, "knock:answer", { id, admit: false });
  assert.deepEqual(await answered, [{ admitted: false, ticket: null }]);
  assert.equal(
    (await ack(people[0].socket, "knock:answer", { id, admit: true })).error,
    "unknown-knock",
  );
});

test("knocking is only for locked rooms, and is rate limited", async () => {
  const { room } = await meeting("Alice");
  const carol = await app.client();
  assert.equal((await knock(carol, room, "Carol")).error, "not-locked");
  assert.equal((await knock(carol, room, "  ")).error, "invalid-name");
  const replies = [];
  for (let i = 0; i < 2; i++) replies.push(await knock(carol, room, "Carol"));
  assert.equal(replies.at(-1).error, "rate-limited");
});

test("hosts are told when someone stops waiting", async () => {
  const { room, people } = await meeting("Alice");
  await ack(people[0].socket, "room:lock", { locked: true });
  const carol = await app.client();
  const knocked = await knock(carol, room, "Carol");
  const resolved = nextEvent(people[0].socket, "knock:resolved");
  carol.disconnect();
  assert.deepEqual(await resolved, [{ id: knocked.id, admitted: false }]);
});

test("unlocking lets in everyone who was waiting", async () => {
  const { room, people } = await meeting("Alice");
  await ack(people[0].socket, "room:lock", { locked: true });
  const carol = await app.client();
  await knock(carol, room, "Carol");
  const answered = nextEvent(carol, "knock:answered");
  await ack(people[0].socket, "room:lock", { locked: false });
  assert.deepEqual(await answered, [{ admitted: true, ticket: null }]);
  assert.equal((await joinRoom(carol, room, "Carol")).ok, true);
});

test("a host who reconnects still sees who is waiting, and gets back in", async () => {
  const { room, people } = await meeting("Alice", "Bob");
  const [alice] = people;
  await ack(alice.socket, "room:lock", { locked: true });
  const carol = await app.client();
  const knocked = await knock(carol, room, "Carol");

  alice.socket.io.engine.close();
  const aliceAgain = await app.client();
  const reply = await joinRoom(aliceAgain, room, "Alice", alice.session);
  assert.equal(reply.resumed, true, "resuming isn't stopped by the lock");
  assert.deepEqual(reply.knocks, [{ id: knocked.id, name: "Carol" }]);
});

test("a host can mute people, ask them to unmute, and lower their hand", async () => {
  const { people } = await meeting("Alice", "Bob", "Carol");
  const [alice, bob, carol] = people;

  const muted = nextEvent(bob.socket, "host:mute");
  await ack(alice.socket, "host:mute", { id: bob.id });
  assert.deepEqual(await muted, [{ by: "Alice" }]);

  const asked = nextEvent(bob.socket, "host:ask-unmute");
  await ack(alice.socket, "host:ask-unmute", { id: bob.id });
  assert.deepEqual(await asked, [{ by: "Alice" }]);

  await ack(bob.socket, "hand:set", { raised: true });
  const lowered = nextEvent(bob.socket, "participant:updated");
  const seen = nextEvent(carol.socket, "participant:updated");
  await ack(alice.socket, "host:lower-hand", { id: bob.id });
  assert.equal((await lowered)[0].hand, null, "Bob is told too");
  assert.equal((await seen)[0].hand, null);
});

test("a host can remove someone, who is then out of the room", async () => {
  const { people } = await meeting("Alice", "Bob", "Carol");
  const [alice, bob, carol] = people;
  const removed = nextEvent(bob.socket, "room:removed");
  const left = nextEvent(carol.socket, "participant:left");
  await ack(alice.socket, "host:remove", { id: bob.id });
  assert.deepEqual(await removed, [{ by: "Alice" }]);
  assert.deepEqual(await left, [{ id: bob.id }]);

  const chatter = collect(carol.socket, "chat:message", 300);
  assert.equal((await ack(bob.socket, "chat:send", { text: "still here?" })).error, "not-joined");
  assert.equal((await chatter).length, 0);
});

test("tickets expire if they aren't used", () => {
  const rooms = new RoomRegistry({ maxRoomSize: 6 });
  rooms.join("r", { name: "Alice", socketId: "a", now: 0 });
  rooms.get("r").locked = true;
  const { knock: k1 } = rooms.knock("r", { name: "Late", socketId: "l" });
  const { ticket: stale } = rooms.answerKnock("r", k1.id, true, 0);
  assert.equal(
    rooms.join("r", { name: "Late", socketId: "l", ticket: stale, now: TICKET_TTL_MS + 1 }).error,
    "room-locked",
  );

  const { knock: k2 } = rooms.knock("r", { name: "Prompt", socketId: "p" });
  const { ticket } = rooms.answerKnock("r", k2.id, true, 0);
  assert.ok(rooms.join("r", { name: "Prompt", socketId: "p", ticket, now: 1000 }).participant);
});
