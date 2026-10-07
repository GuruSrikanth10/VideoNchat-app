const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { startTestServer } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

const get = (pathname) => fetch(app.url + pathname, { redirect: "manual" });

test("/ and /new redirect to a new UUID room", async () => {
  for (const pathname of ["/", "/new"]) {
    const res = await get(pathname);
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location"), /^\/[0-9a-f-]{36}$/);
  }
});

test("valid room IDs get the meeting page, with or without a trailing slash", async () => {
  for (const pathname of ["/team-standup", "/team-standup/"]) {
    const res = await get(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(await res.text(), /<script type="module" src="\/js\/room\.js"><\/script>/);
  }
});

test("anything that isn't a room ID is a 404", async () => {
  for (const pathname of ["/favicon.ico", "/a%5C", "/a%0Ab", "/robots.txt", "/a/b"]) {
    const res = await get(pathname);
    assert.equal(res.status, 404, pathname);
    assert.match(await res.text(), /Page not found/);
  }
});

test("pages only reference same-origin resources and have no inline scripts", async () => {
  for (const pathname of ["/some-room", "/leave", "/does/not/exist"]) {
    const html = await (await get(pathname)).text();
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      urls.filter((u) => !u.startsWith("/") && !u.startsWith("#")),
      [],
      pathname,
    );
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `inline script in ${pathname}`);
    assert.doesNotMatch(html, /\sstyle="/, `inline style in ${pathname}`);
  }
});

test("the client's modules, styles and icons are served", async () => {
  for (const pathname of [
    "/leave",
    "/css/app.css",
    "/js/room.js",
    "/js/lib/rtc.js",
    "/icons.svg",
    "/favicon.svg",
    "/socket.io/socket.io.esm.min.js",
  ]) {
    assert.equal((await get(pathname)).status, 200, pathname);
  }
});

test("a strict Content-Security-Policy is sent", async () => {
  const csp = (await get("/some-room")).headers.get("content-security-policy");
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), `${directive} in ${csp}`);
  }
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src 'self' ws:\/\/127\.0\.0\.1:\d+/);
});

test("no wildcard CORS headers are sent", async () => {
  const res = await fetch(`${app.url}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("Socket.IO upgrades to WebSocket", async () => {
  const socket = await app.client();
  assert.equal(socket.io.engine.transport.name, "websocket");
});

test("start() listens on the PORT environment variable", async () => {
  // Find a free port, then ask the app to use it.
  const probe = require("node:net").createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, ["-e", "require('./app').start()"], {
    cwd: path.join(__dirname, "../.."),
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "info" },
  });
  try {
    const output = await new Promise((resolve, reject) => {
      child.stdout.once("data", (data) => resolve(String(data)));
      child.stderr.once("data", (data) => reject(new Error(String(data))));
      child.once("exit", (code) => reject(new Error(`exited with ${code}`)));
    });
    assert.equal(JSON.parse(output).port, port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/leave`)).status, 200);
  } finally {
    child.kill();
  }
});
