const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, uniqueRoom, joinRoom, ack } = require("./helpers");
const { loadConfig } = require("../../src/server/config");

const TOKEN = "t".repeat(32);
let app;
before(async () => (app = await startTestServer({ METRICS_TOKEN: TOKEN })));
after(() => app.close());

const scrape = async () => {
  const res = await fetch(`${app.url}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/plain/);
  return res.text();
};
const value = (text, series) => {
  const line = text.split("\n").find((l) => l.startsWith(`${series} `));
  return line ? Number(line.split(" ").at(-1)) : 0;
};
const post = (path, body, type = "application/json") =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: JSON.stringify(body),
  });

test("metrics need the token, and never exist without one", async () => {
  assert.equal((await fetch(`${app.url}/metrics`)).status, 401);
  const wrong = await fetch(`${app.url}/metrics`, { headers: { Authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);

  const open = await startTestServer();
  try {
    const res = await fetch(`${open.url}/metrics`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(await res.text(), /room\.js/, "and it isn't a meeting called metrics");
  } finally {
    await open.close();
  }
  assert.throws(() => loadConfig({ METRICS_TOKEN: "short" }), /METRICS_TOKEN/);
});

test("metrics count rooms, people and joins, without naming anyone", async () => {
  const before = await scrape();
  const room = uniqueRoom();
  const alice = await app.client();
  await joinRoom(alice, room, "Alice Secret");
  await ack(alice, "chat:send", { text: "hello" });

  const text = await scrape();
  assert.ok(value(text, "videonchat_rooms") >= 1);
  assert.ok(value(text, "videonchat_participants") >= 1);
  assert.equal(
    value(text, 'videonchat_joins_total{result="ok"}'),
    value(before, 'videonchat_joins_total{result="ok"}') + 1,
  );
  assert.ok(value(text, "videonchat_chat_messages_total") >= 1);
  assert.doesNotMatch(text, /Alice|hello/);
  assert.doesNotMatch(text, new RegExp(room));
});

test("clients report how their calls went", async () => {
  const alice = await app.client();
  await joinRoom(alice, uniqueRoom(), "Alice");
  const before = await scrape();
  assert.deepEqual(await ack(alice, "telemetry", { kind: "first-video", ms: 1200 }), { ok: true });
  await ack(alice, "telemetry", { kind: "connected", relay: true });
  await ack(alice, "telemetry", { kind: "ice-failed" });
  for (const bad of [{ kind: "first-video", ms: -1 }, { kind: "connected" }, { kind: "x" }, 5]) {
    assert.equal((await ack(alice, "telemetry", bad)).error, "invalid-payload");
  }
  const text = await scrape();
  const count = "videonchat_time_to_first_video_seconds_count";
  assert.equal(value(text, count), value(before, count) + 1);
  assert.ok(value(text, 'videonchat_time_to_first_video_seconds_bucket{le="2"}') >= 1);
  assert.ok(value(text, 'videonchat_peer_connections_total{relay="true"}') >= 1);
  assert.ok(value(text, "videonchat_ice_failures_total") >= 1);

  const stranger = await app.client();
  assert.equal((await ack(stranger, "telemetry", { kind: "ice-failed" })).error, "not-joined");
});

test("browsers can report errors, logged without the meeting's ID", async () => {
  const res = await post(
    "/api/client-errors",
    {
      message: "TypeError: x is undefined",
      source: `${app.url}/js/room.js`,
      line: 12,
      column: 4,
      page: `${app.url}/secret-meeting-id?x=1`,
    },
    "text/plain",
  );
  assert.equal(res.status, 204);
  const line = app.logs.findLast((l) => l.includes("client error"));
  const logged = JSON.parse(line);
  assert.equal(logged.clientError.message, "TypeError: x is undefined");
  assert.equal(logged.clientError.page, "room");
  assert.doesNotMatch(line, /secret-meeting-id/);
  assert.ok(value(await scrape(), "videonchat_client_errors_total") >= 1);
});

test("CSP violations are reported in either format", async () => {
  const csp = (await fetch(`${app.url}/`)).headers.get("content-security-policy");
  assert.match(csp, /report-uri \/api\/csp-report/);
  assert.match(csp, /report-to csp/);

  const legacy = await post(
    "/api/csp-report",
    {
      "csp-report": {
        "document-uri": `${app.url}/private-room`,
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?token=1",
      },
    },
    "application/csp-report",
  );
  assert.equal(legacy.status, 204);
  const modern = await post(
    "/api/csp-report",
    [
      {
        type: "csp-violation",
        body: { documentURL: `${app.url}/`, effectiveDirective: "img-src", blockedURL: "data" },
      },
    ],
    "application/reports+json",
  );
  assert.equal(modern.status, 204);

  const logged = app.logs.filter((l) => l.includes("csp violation")).map((l) => JSON.parse(l));
  assert.deepEqual(logged.at(-2).cspViolation, {
    directive: "script-src-elem",
    blocked: "https://evil.example",
    page: "room",
  });
  assert.equal(logged.at(-1).cspViolation.directive, "img-src");
  assert.doesNotMatch(JSON.stringify(logged), /private-room|token=1/);
  const text = await scrape();
  assert.ok(value(text, 'videonchat_csp_violations_total{directive="script-src-elem"}') >= 1);
});

test("reports are rate limited and size limited", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++)
    statuses.push((await post("/api/client-errors", { message: i })).status);
  assert.ok(statuses.includes(429), statuses.join(","));
  const huge = await post("/api/csp-report", { "csp-report": { x: "y".repeat(20_000) } });
  assert.equal(huge.status, 413);
  const broken = await fetch(`${app.url}/api/csp-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(broken.status, 400);
  assert.ok(!app.logs.some((l) => l.includes("request failed")), "not logged as a server error");
});
