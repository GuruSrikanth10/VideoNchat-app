const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { startTestServer } = require("./helpers");

let app;
before(async () => (app = await startTestServer()));
after(() => app.close());

const get = (pathname) => fetch(app.url + pathname, { redirect: "manual" });

test("/ is the landing page and /new starts a meeting", async () => {
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Video meetings in your browser/);

  const res = await get("/new");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/[0-9a-f-]{36}$/);
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
  for (const pathname of ["/", "/some-room", "/leave", "/does/not/exist"]) {
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
    "/og.png",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
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

test("pages are only served at their routes, not as raw files", async () => {
  for (const pathname of ["/room.html", "/index.html", "/views/room.html"]) {
    assert.equal((await get(pathname)).status, 404, pathname);
  }
});

test("the web app manifest is served with its media type", async () => {
  const res = await get("/manifest.webmanifest");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/manifest\+json/);
  const manifest = await res.json();
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("meeting pages are kept out of search engines; the landing page isn't", async () => {
  const noindex = /<meta name="robots" content="noindex" \/>/;
  assert.doesNotMatch(await (await get("/")).text(), noindex);
  for (const pathname of ["/some-room", "/leave", "/does/not/exist"]) {
    assert.match(await (await get(pathname)).text(), noindex, pathname);
  }
});

test("link previews use PUBLIC_URL for absolute image URLs when it's set", async () => {
  const image = (html) => html.match(/<meta property="og:image" content="([^"]*)"/)[1];
  assert.equal(image(await (await get("/some-room")).text()), "/og.png");

  const hosted = await startTestServer({ PUBLIC_URL: "https://meet.example.com/ignored/path" });
  try {
    const html = await (await fetch(`${hosted.url}/some-room`)).text();
    assert.equal(image(html), "https://meet.example.com/og.png");
    assert.doesNotMatch(html, /\{\{origin\}\}/);
  } finally {
    await hosted.close();
  }
});

test("pages get ETags, so revalidating them is cheap", async () => {
  const first = await get("/");
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.equal(first.headers.get("cache-control"), "no-cache");
  // fetch() adds "Cache-Control: no-cache" to conditional requests unless
  // told otherwise, which would force a full response.
  const again = await fetch(`${app.url}/`, {
    headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" },
  });
  assert.equal(again.status, 304);
});

test("HTTPS is enforced only once PUBLIC_URL says the site is HTTPS-only", async () => {
  const headers = async (env) => {
    const server = await startTestServer(env);
    try {
      const res = await fetch(`${server.url}/`);
      return {
        hsts: res.headers.get("strict-transport-security"),
        csp: res.headers.get("content-security-policy"),
      };
    } finally {
      await server.close();
    }
  };
  const local = await headers({ NODE_ENV: "production", PUBLIC_URL: "http://localhost:3000" });
  assert.equal(local.hsts, null);
  assert.doesNotMatch(local.csp, /upgrade-insecure-requests/);

  const hosted = await headers({ NODE_ENV: "production", PUBLIC_URL: "https://meet.example.com" });
  assert.match(hosted.hsts, /max-age=\d+/);
  assert.match(hosted.csp, /upgrade-insecure-requests/);
});
