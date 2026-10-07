const {
  test,
  expect,
  joinMeeting,
  expectTiles,
  tile,
  sendChat,
  leaveMeeting,
  chatMessages,
  slowPermission,
  failingMedia,
  openPage,
} = require("./support");

test("two people see and hear each other", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");

  await expectTiles(alice, 2);
  await expectTiles(bob, 2);
  await expect(tile(bob, "Alice")).toBeVisible();
  await expect(tile(bob, "Bob (you)")).toBeVisible();
  const remoteHasAudio = await bob.evaluate(() =>
    [...document.querySelectorAll("#tiles .tile:not([data-self]) video")].some(
      (v) => !v.muted && v.srcObject.getAudioTracks().some((t) => t.readyState === "live"),
    ),
  );
  expect(remoteHasAudio).toBe(true);
  await expect(alice.locator("#participant-count")).toHaveText("2 in call");
  await expect(alice).toHaveTitle("(2) Meeting · VideoNChat");
  expect(alice.errors).toEqual([]);
  expect(bob.errors).toEqual([]);
});

test("three people form a full mesh", async ({ openUser, room }) => {
  const users = [await openUser(), await openUser(), await openUser()];
  for (const [i, page] of users.entries()) await joinMeeting(page, room, `User ${i + 1}`);
  for (const page of users) await expectTiles(page, 3);
});

test("a newcomer who is slow to allow the camera still connects", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const slow = await openUser({ initScript: slowPermission(4000) });
  await joinMeeting(slow, room, "Slowpoke");

  await expectTiles(alice, 2);
  await expectTiles(slow, 2);
});

test("turning the camera off shows your initials to everyone", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice Smith");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(bob, 2);

  await alice.getByRole("button", { name: "Stop video" }).click();
  await expect(tile(bob, "Alice Smith")).toHaveAttribute("data-video-off", "true");
  await expect(tile(bob, "Alice Smith").locator(".tile__initials")).toHaveText("AS");

  await alice.getByRole("button", { name: "Start video" }).click();
  await expect(tile(bob, "Alice Smith")).toHaveAttribute("data-video-off", "false");
  await expectTiles(bob, 2);
});

test("muting shows a muted icon to everyone", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");

  await alice.getByRole("button", { name: "Mute" }).click();
  await expect(alice.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect(tile(bob, "Alice")).toHaveAttribute("data-muted", "true");
  await alice.getByRole("button", { name: "Unmute" }).click();
  await expect(tile(bob, "Alice")).toHaveAttribute("data-muted", "false");
});

test("leaving removes the tile from every screen", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  const carol = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await joinMeeting(carol, room, "Carol");
  await expectTiles(carol, 3);

  await leaveMeeting(alice);
  await expect(alice.getByRole("heading", { name: "You left the meeting" })).toBeVisible();
  await expect(alice.getByRole("link", { name: "Rejoin" })).toHaveAttribute("href", `/${room}`);

  await expect(tile(bob, "Alice")).toHaveCount(0);
  await expect(tile(carol, "Alice")).toHaveCount(0);
  await expectTiles(bob, 2);
});

test("closing the tab counts as leaving straight away", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expect(tile(alice, "Bob")).toBeVisible();

  await bob.close({ runBeforeUnload: true });
  await expect(tile(alice, "Bob")).toHaveCount(0, { timeout: 5000 });
});

test("a network blip doesn't end the call or the chat", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(alice, 2);
  const bobId = await bob.evaluate(() => window.videonchat.self().id);

  await bob.evaluate(() => window.videonchat.socket.io.engine.close()); // drop the transport
  await expect(bob.locator("#banner")).toBeVisible();
  await expect(bob.locator("#banner")).toBeHidden();

  // Bob resumed as the same participant: nobody saw him leave.
  expect(await bob.evaluate(() => window.videonchat.self().id)).toBe(bobId);
  await expect(alice.locator(".toast")).not.toContainText(["Bob left"]);
  await expectTiles(alice, 2);
  await expectTiles(bob, 2);
  await sendChat(alice, "still there?");
  await expect(chatMessages(bob)).toHaveText(["still there?"]);
});

for (const errorName of ["NotAllowedError", "NotFoundError"]) {
  test(`without a usable camera (${errorName}) you can still watch`, async ({ openUser, room }) => {
    const alice = await openUser();
    await joinMeeting(alice, room, "Alice");
    const viewer = await openUser({ initScript: failingMedia(errorName) });
    await openPage(viewer, `/${room}`);
    await expect(viewer.locator("#media-status")).toContainText(
      "You can still join to see and hear everyone.",
    );
    await joinMeeting(viewer, room, "Viewer");
    await expectTiles(viewer, 1); // Alice's video
    await expect(tile(alice, "Viewer")).toBeVisible(); // everyone is visible
    await viewer.getByRole("button", { name: "Mute" }).click(); // must not throw
    await expect(viewer.locator(".toast")).toContainText("No microphone is available.");
    expect(viewer.errors).toEqual([]);
  });
}
