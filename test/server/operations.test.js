const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { io: connect } = require("socket.io-client");
const { startTestServer } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

test("/healthz reports status for uptime checks", async () => {
  await app.client();
  const res = await fetch(`${app.url}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.ok(body.connections >= 1);
  assert.equal(typeof body.uptimeSeconds, "number");
});

test("security headers are sent", async () => {
  const res = await fetch(`${app.url}/leave`);
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("permissions-policy"), /camera=\(self\)/);
  assert.match(res.headers.get("permissions-policy"), /display-capture=\(self\)/);
});

test("text assets are compressed and revalidated", async () => {
  const res = await fetch(`${app.url}/js/room.js`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.ok(res.headers.get("etag"));
});

test("unknown pages get a helpful 404 page", async () => {
  const res = await fetch(`${app.url}/no/such/page`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Page not found/);
});

test("SIGTERM warns clients, then exits cleanly", async () => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, ["app.js"], {
    cwd: path.join(__dirname, "../.."),
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "info", SHUTDOWN_GRACE_SECONDS: "1" },
  });
  await new Promise((resolve) => child.stdout.once("data", resolve)); // "listening"

  const socket = connect(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  await new Promise((resolve) => socket.once("connect", resolve));

  const warned = new Promise((resolve) => socket.once("server:restarting", resolve));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");

  assert.deepEqual(await warned, { inSeconds: 1 });
  assert.equal(await exited, 0);
  socket.disconnect();
});
