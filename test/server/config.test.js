const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../../src/server/config");

test("defaults are safe for local development", () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.maxRoomSize, 6);
  assert.equal(config.isProduction, false);
  assert.equal(config.publicUrl, null);
  assert.deepEqual(config.ice.turnUrls, []);
  assert.ok(config.ice.stunUrls.length > 0);
});

test("values are read from the environment", () => {
  const config = loadConfig({
    PORT: "8080",
    NODE_ENV: "production",
    PUBLIC_URL: "https://meet.example.com/some/path",
    MAX_ROOM_SIZE: "4",
    TRUST_PROXY: "1",
    TURN_URLS: "turn:turn.example.com:3478, turns:turn.example.com:443",
    TURN_SECRET: "s3cret",
  });
  assert.equal(config.port, 8080);
  assert.equal(config.isProduction, true);
  assert.equal(config.publicUrl, "https://meet.example.com");
  assert.equal(config.maxRoomSize, 4);
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(config.ice.turnUrls, [
    "turn:turn.example.com:3478",
    "turns:turn.example.com:443",
  ]);
});

test("invalid values fail fast with every problem listed", () => {
  assert.throws(
    () => loadConfig({ PORT: "eighty", MAX_ROOM_SIZE: "1", PUBLIC_URL: "not a url" }),
    (err) =>
      /PORT must be an integer/.test(err.message) &&
      /MAX_ROOM_SIZE must be an integer/.test(err.message) &&
      /PUBLIC_URL must be an absolute URL/.test(err.message),
  );
});

test("TURN servers require a shared secret", () => {
  assert.throws(() => loadConfig({ TURN_URLS: "turn:turn.example.com" }), /TURN_SECRET/);
});

test("the config can't be changed at runtime", () => {
  const config = loadConfig({});
  assert.throws(() => {
    "use strict";
    config.port = 1;
  });
});
