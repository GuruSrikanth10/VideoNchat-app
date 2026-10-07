const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { loadConfig } = require("../../src/server/config");
const { iceServersFor } = require("../../src/server/ice");
const { startTestServer, uniqueRoom, joinRoom, ack } = require("./helpers");

const TURN_ENV = {
  TURN_URLS: "turn:turn.example.com:3478,turns:turn.example.com:443",
  TURN_SECRET: "north-pole",
  TURN_TTL_SECONDS: "600",
};

test("without TURN settings only STUN servers are offered", () => {
  assert.deepEqual(iceServersFor(loadConfig({})), [{ urls: ["stun:stun.l.google.com:19302"] }]);
});

test("TURN credentials follow the TURN REST API scheme and expire", () => {
  const config = loadConfig(TURN_ENV);
  const now = Date.UTC(2026, 0, 1);
  const [, turn] = iceServersFor(config, { now, user: "abc" });
  const expiresAt = now / 1000 + 600;
  assert.equal(turn.username, `${expiresAt}:abc`);
  assert.equal(
    turn.credential,
    createHmac("sha1", "north-pole").update(`${expiresAt}:abc`).digest("base64"),
  );
  assert.deepEqual(turn.urls, ["turn:turn.example.com:3478", "turns:turn.example.com:443"]);
});

test("extra servers can be given as JSON", () => {
  const extra = [{ urls: "turns:relay.example.com:443", username: "u", credential: "c" }];
  const config = loadConfig({ STUN_URLS: "", ICE_SERVERS: JSON.stringify(extra) });
  assert.deepEqual(iceServersFor(config), extra);
  assert.throws(() => loadConfig({ ICE_SERVERS: "[{}]" }), /ICE_SERVERS/);
  assert.throws(() => loadConfig({ ICE_SERVERS: "not json" }), /ICE_SERVERS/);
});

let app;
before(async () => (app = await startTestServer(TURN_ENV)));
after(() => app.close());

test("only people in a room receive TURN credentials", async () => {
  const socket = await app.client();
  assert.equal((await ack(socket, "rtc:ice-servers")).error, "not-joined");

  const reply = await joinRoom(socket, uniqueRoom(), "Alice");
  const turn = reply.iceServers.find((s) => s.credential);
  assert.ok(turn.username.endsWith(`:${reply.self.id}`));

  const refreshed = await ack(socket, "rtc:ice-servers");
  assert.equal(refreshed.ok, true);
  assert.ok(refreshed.iceServers.some((s) => s.credential));
});
