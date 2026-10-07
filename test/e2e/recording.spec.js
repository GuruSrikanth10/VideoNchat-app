const fs = require("node:fs");
const { test, expect, joinMeeting, nameField, openPage } = require("./support");

test("recording tells everyone, and saves a video file when it stops", async ({
  openUser,
  room,
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit has no fake camera to record");
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");

  await bob.getByRole("button", { name: "Settings" }).click();
  await bob.getByRole("button", { name: "Start recording" }).click();
  await expect(bob.locator("#recording-text")).toHaveText("You're recording this meeting.");
  await expect(alice.locator("#recording-text")).toHaveText("Bob is recording this meeting.");
  await expect(alice.locator("#toasts")).toContainText("Bob started recording");
  await expect(alice.getByRole("button", { name: "Stop recording" })).toBeHidden();

  // Someone arriving is told before they join.
  const carol = await openUser();
  await openPage(carol, `/${room}`);
  await nameField(carol).fill("Carol");
  await expect(carol.locator("#room-info")).toContainText("This meeting is being recorded.");

  await bob.waitForTimeout(2000);
  const [download] = await Promise.all([
    bob.waitForEvent("download"),
    bob.getByRole("button", { name: "Stop recording" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^VideoNChat ${room} .+\\.(webm|mp4)$`));
  await expect(alice.locator("#recording-notice")).toBeHidden();
  await expect(alice.locator("#toasts")).toContainText("Bob stopped recording");

  // It's a real video of the call, at the recorder's size.
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(10_000);
  const width = await bob.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(new Blob([data], { type: "video/webm" }));
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });
    return video.videoWidth;
  }, bytes.toString("base64"));
  expect(width).toBe(1280);
});

test("leaving while recording saves the recording first", async ({
  openUser,
  room,
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit has no fake camera to record");
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  await alice.getByRole("button", { name: "Settings" }).click();
  await alice.getByRole("button", { name: "Start recording" }).click();
  await expect(alice.locator("#recording-notice")).toBeVisible();
  await alice.waitForTimeout(1000);
  const downloaded = alice.waitForEvent("download");
  await alice.getByRole("button", { name: "Leave", exact: true }).first().click();
  await alice.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^VideoNChat /);
  await expect(alice).toHaveURL(/\/leave\?room=/);
});
