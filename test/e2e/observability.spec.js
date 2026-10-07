const { test, expect, joinMeeting, expectTiles, openPage } = require("./support");

const metrics = async (request) => {
  const res = await request.get("/metrics", {
    headers: { Authorization: "Bearer e2e-metrics-token-for-tests" },
  });
  expect(res.status()).toBe(200);
  return res.text();
};
const value = (text, series) => {
  const line = text.split("\n").find((l) => l.startsWith(`${series} `));
  return line ? Number(line.split(" ").at(-1)) : 0;
};

test("calls report time to first video and how they connected", async ({
  openUser,
  room,
  request,
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit has no fake camera");
  const before = await metrics(request);
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(alice, 2);
  await expectTiles(bob, 2);

  const count = "videonchat_time_to_first_video_seconds_count";
  await expect
    .poll(async () => value(await metrics(request), count) - value(before, count))
    .toBeGreaterThanOrEqual(2);
  // Two browsers on one machine connect directly, without TURN.
  const direct = 'videonchat_peer_connections_total{relay="false"}';
  await expect
    .poll(async () => value(await metrics(request), direct) - value(before, direct))
    .toBeGreaterThanOrEqual(2);
});

test("uncaught errors in a page are reported to the server", async ({ openUser, request }) => {
  const page = await openUser();
  await openPage(page, "/");
  const before = value(await metrics(request), "videonchat_client_errors_total");
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error("simulated failure");
    }),
  );
  await expect
    .poll(async () => value(await metrics(request), "videonchat_client_errors_total"))
    .toBeGreaterThan(before); // other tests share the server, so not "exactly one"
});
