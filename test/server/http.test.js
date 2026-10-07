const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const WebSocket = require("ws");
const { startTestServer } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

const get = (pathname) => fetch(app.url + pathname, { redirect: "manual" });

test("/ redirects to a new UUID room", async () => {
  const res = await get("/");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/[0-9a-f-]{36}$/);
});

test("valid room IDs render the room page, with or without a trailing slash", async () => {
  for (const pathname of ["/team-standup", "/team-standup/"]) {
    const res = await get(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(await res.text(), /const ROOM_ID = "team-standup"/);
  }
});

test("anything that isn't a room ID is a 404", async () => {
  for (const pathname of ["/favicon.ico", "/a%5C", "/a%0Ab", "/robots.txt"]) {
    assert.equal((await get(pathname)).status, 404, pathname);
  }
});

test("pages only reference same-origin scripts and styles", async () => {
  const html = await (await get("/some-room")).text();
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const external = urls.filter((u) => !u.startsWith("/") && !u.includes("fontawesome"));
  assert.deepEqual(external, []);
});

test("the leave page, client libraries and assets are served", async () => {
  for (const pathname of [
    "/leave",
    "/style.css",
    "/client.js",
    "/socket.io/socket.io.min.js",
    "/vendor/peerjs/peerjs.min.js",
    "/vendor/sweetalert2/sweetalert2.all.min.js",
  ]) {
    assert.equal((await get(pathname)).status, 200, pathname);
  }
});

test("no wildcard CORS headers are sent", async () => {
  const res = await fetch(`${app.url}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("PeerJS signalling and Socket.IO's WebSocket share the server", async () => {
  // Socket.IO over WebSocket only: this failed while PeerJS answered every
  // upgrade with "400 Bad Request".
  const socket = await app.client();
  assert.equal(socket.io.engine.transport.name, "websocket");

  const ws = new WebSocket(
    `${app.url.replace("http", "ws")}/peerjs/peerjs?key=peerjs&id=p1&token=t`,
  );
  const [message] = await new Promise((resolve, reject) => {
    ws.once("message", (...args) => resolve(args));
    ws.once("error", reject);
  });
  assert.deepEqual(JSON.parse(message), { type: "OPEN" });
  ws.close();
});

test("start() listens on the PORT environment variable", async () => {
  // Find a free port, then ask the app to use it.
  const probe = require("node:net").createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, ["-e", "require('./app').start()"], {
    cwd: path.join(__dirname, "../.."),
    env: { ...process.env, PORT: String(port) },
  });
  try {
    const output = await new Promise((resolve, reject) => {
      child.stdout.once("data", (data) => resolve(String(data)));
      child.stderr.once("data", (data) => reject(new Error(String(data))));
      child.once("exit", (code) => reject(new Error(`exited with ${code}`)));
    });
    assert.match(output, new RegExp(`Listening on port ${port}`));
    assert.equal((await fetch(`http://127.0.0.1:${port}/leave`)).status, 200);
  } finally {
    child.kill();
  }
});
