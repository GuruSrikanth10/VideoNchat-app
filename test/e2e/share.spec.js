const { test, expect, joinMeeting, waitForPopups, expectTiles } = require("./support");

// Headless Firefox and WebKit can't capture the screen.
test.skip(({ browserName }) => browserName !== "chromium", "needs getDisplayMedia");

// Width of the video each tile is currently receiving.
const remoteWidths = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#video-grid video")]
      .filter((v) => !v.muted)
      .map((v) => v.videoWidth),
  );

test("a shared screen reaches everyone, including late joiners", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(bob, 2);
  await waitForPopups(alice);

  const cameraWidth = (await remoteWidths(bob))[0];
  await alice.locator("#shareScreen").click();
  await expect(alice.locator("#shareScreen")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await remoteWidths(bob))[0]).not.toBe(cameraWidth);
  const screenWidth = (await remoteWidths(bob))[0];

  const dave = await openUser();
  await joinMeeting(dave, room, "Dave");
  await expectTiles(dave, 3);
  await expect.poll(() => remoteWidths(dave)).toContain(screenWidth);

  // A second click stops sharing instead of starting another capture.
  await waitForPopups(alice);
  await alice.locator("#shareScreen").click();
  await expect(alice.locator("#shareScreen")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await remoteWidths(bob))[0]).not.toBe(screenWidth);
  expect(alice.errors).toEqual([]);
});
