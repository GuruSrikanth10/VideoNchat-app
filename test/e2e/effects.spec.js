const { test, expect, joinMeeting } = require("./support");

async function openSettings(page) {
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test("noise suppression can be turned off, and stays off next time", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  const noise = () =>
    page.evaluate(() => window.videonchat.media.mic.getSettings().noiseSuppression);
  expect(await noise()).toBe(true);

  const settings = await openSettings(page);
  await settings.getByRole("switch", { name: "Noise suppression" }).uncheck();
  await expect.poll(noise).toBe(false);

  await page.reload();
  await joinMeeting(page, room, "Ada");
  await expect.poll(noise).toBe(false);
  await openSettings(page);
  await expect(page.getByRole("switch", { name: "Noise suppression" })).not.toBeChecked();
});

test("background blur is only offered where the camera can do it", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  await openSettings(page);
  await expect(page.locator("#blur-field")).toBeHidden();
});

// A camera that says it can blur, and records what it's asked to do.
const blurringCamera = `(() => {
  const capabilities = MediaStreamTrack.prototype.getCapabilities;
  MediaStreamTrack.prototype.getCapabilities = function () {
    const result = capabilities.call(this);
    return this.kind === "video" ? { ...result, backgroundBlur: [false, true] } : result;
  };
  const apply = MediaStreamTrack.prototype.applyConstraints;
  window.__blur = [];
  MediaStreamTrack.prototype.applyConstraints = function (constraints = {}) {
    const { backgroundBlur, ...rest } = constraints;
    if (backgroundBlur !== undefined) window.__blur.push(backgroundBlur);
    return apply.call(this, rest);
  };
})()`;

test("where the camera supports it, the background can be blurred", async ({ openUser, room }) => {
  const page = await openUser({ initScript: blurringCamera });
  await joinMeeting(page, room, "Ada");
  const settings = await openSettings(page);
  const blur = settings.getByRole("switch", { name: "Blur my background" });
  await expect(blur).toBeVisible();
  await blur.check();
  await expect.poll(() => page.evaluate(() => window.__blur)).toEqual([true]);
  await blur.uncheck();
  await expect.poll(() => page.evaluate(() => window.__blur)).toEqual([true, false]);
});
