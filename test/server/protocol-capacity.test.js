const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, uniqueRoom, joinRoom } = require("./helpers");

let app;
before(async () => (app = await startTestServer({ MAX_ROOM_SIZE: "2" })));
after(() => app.close());

test("rooms refuse people beyond MAX_ROOM_SIZE", async () => {
  const room = uniqueRoom();
  assert.equal((await joinRoom(await app.client(), room, "One")).ok, true);
  const second = await joinRoom(await app.client(), room, "Two");
  assert.equal(second.ok, true);
  assert.equal(second.maxRoomSize, 2);
  assert.deepEqual(await joinRoom(await app.client(), room, "Three"), {
    ok: false,
    error: "room-full",
  });
});

test("the lobby can see how many people are in a room without joining", async () => {
  const room = uniqueRoom();
  const lobby = await app.client();
  const peek = () => lobby.timeout(2000).emitWithAck("room:peek", { roomId: room });
  assert.deepEqual(await peek(), {
    ok: true,
    count: 0,
    full: false,
    locked: false,
    recording: false,
    maxRoomSize: 2,
  });
  await joinRoom(await app.client(), room, "One");
  await joinRoom(await app.client(), room, "Two");
  assert.deepEqual(await peek(), {
    ok: true,
    count: 2,
    full: true,
    locked: false,
    recording: false,
    maxRoomSize: 2,
  });
  const bad = await lobby.timeout(2000).emitWithAck("room:peek", { roomId: "../x" });
  assert.equal(bad.error, "invalid-room");
});
