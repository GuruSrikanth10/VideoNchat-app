/* global socket -- the page's Socket.IO client, used inside page.evaluate() */
const {
  test,
  expect,
  joinMeeting,
  waitForPopups,
  expectTiles,
  sendChat,
  chatMessages,
  slowPermission,
  failingMedia,
} = require("./support");

test("two people see and hear each other", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");

  await expectTiles(alice, 2);
  await expectTiles(bob, 2);
  const remoteHasAudio = await bob.evaluate(() =>
    [...document.querySelectorAll("#video-grid video")].some(
      (v) => !v.muted && v.srcObject.getAudioTracks().length === 1,
    ),
  );
  expect(remoteHasAudio).toBe(true);
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

test("leaving removes the tile from every screen", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  const carol = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await joinMeeting(carol, room, "Carol");
  await expectTiles(carol, 3);

  // Alice joined first, so she placed the calls; the others answered them.
  await waitForPopups(alice);
  await alice.locator("#leave-meet").click();
  await alice.locator(".swal2-confirm").click();
  await expect(alice).toHaveURL(/\/leave$/);

  await expectTiles(bob, 2);
  await expectTiles(carol, 2);
});

test("a network blip doesn't end the call or the chat", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(alice, 2);

  await bob.evaluate(() => socket.io.engine.close()); // drop the transport
  await expect.poll(() => bob.evaluate(() => socket.connected)).toBe(true);

  await expectTiles(alice, 2);
  await expectTiles(bob, 2);
  await waitForPopups(alice);
  await sendChat(alice, "still there?");
  await expect(chatMessages(bob)).toHaveText(["still there?"]);
});

for (const errorName of ["NotAllowedError", "NotFoundError"]) {
  test(`without a usable camera (${errorName}) you can still watch`, async ({ openUser, room }) => {
    const alice = await openUser();
    await joinMeeting(alice, room, "Alice");
    const viewer = await openUser({ initScript: failingMedia(errorName) });
    await joinMeeting(viewer, room, "Viewer");

    await expect(viewer.locator(".swal2-title")).toHaveText(
      "You joined without camera or microphone",
    );
    await viewer.locator(".swal2-cancel").click();
    await expectTiles(viewer, 1); // Alice's video
    await viewer.locator("#muteButton").click(); // must not throw
    expect(viewer.errors).toEqual([]);
  });
}
