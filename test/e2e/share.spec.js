const { test, expect, joinMeeting, expectTiles } = require("./support");

// Headless Firefox and WebKit can't capture the screen.
test.skip(({ browserName }) => browserName !== "chromium", "needs getDisplayMedia");

const screenTile = (page, label) => page.locator("#tiles .tile--screen").filter({ hasText: label });

const showsVideo = (locator) =>
  locator.evaluate((tile) => {
    const video = tile.querySelector("video");
    return video.videoWidth > 0 && video.srcObject.getVideoTracks()[0]?.readyState === "live";
  });

test("a shared screen reaches everyone, including late joiners", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(bob, 2);

  await alice.getByRole("button", { name: "Present" }).click();
  await expect(alice.getByRole("button", { name: "Stop presenting" })).toBeVisible();
  await expect(screenTile(alice, "Your screen")).toBeVisible();
  await expect.poll(() => showsVideo(screenTile(bob, "Alice's screen"))).toBe(true);
  // Alice's camera is still shown next to her screen.
  await expectTiles(bob, 2);

  const dave = await openUser();
  await joinMeeting(dave, room, "Dave");
  await expect.poll(() => showsVideo(screenTile(dave, "Alice's screen"))).toBe(true);

  await alice.getByRole("button", { name: "Stop presenting" }).click();
  await expect(screenTile(bob, "Alice's screen")).toHaveCount(0);
  await expect(screenTile(dave, "Alice's screen")).toHaveCount(0);
  expect(alice.errors).toEqual([]);
});
