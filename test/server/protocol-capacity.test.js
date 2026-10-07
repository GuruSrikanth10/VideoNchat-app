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
