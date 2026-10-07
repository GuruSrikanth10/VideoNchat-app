const { test, expect, joinMeeting, nameField } = require("./support");

// A phone: a coarse pointer, a front and a back camera. The fake camera
// has no facing mode, so requests for one are recorded and dropped.
const phoneWithTwoCameras = `(() => {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) =>
    query === "(pointer: coarse)"
      ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
      : matchMedia(query);
  const devices = navigator.mediaDevices;
  const enumerate = devices.enumerateDevices.bind(devices);
  devices.enumerateDevices = async () => {
    const list = await enumerate();
    const back = { kind: "videoinput", deviceId: "back", groupId: "back", label: "Back camera" };
    return list.some((d) => d.kind === "videoinput") ? [...list, back] : list;
  };
  const getUserMedia = devices.getUserMedia.bind(devices);
  window.__facing = [];
  devices.getUserMedia = (constraints) => {
    if (constraints.video?.facingMode) {
      window.__facing.push(constraints.video.facingMode);
      const { facingMode, ...video } = constraints.video;
      constraints = { ...constraints, video };
    }
    return getUserMedia(constraints);
  };
})()`;

test("phones can switch between the front and back cameras", async ({ openUser, room }) => {
  const phone = await openUser({ initScript: phoneWithTwoCameras });
  await phone.goto(`/${room}`);
  await nameField(phone).fill("Phone");
  const flip = phone.locator("#lobby-flip");
  await expect(flip).toBeVisible();
  const preview = phone.locator("#lobby-video");
  await expect(preview).toHaveClass(/tile__video--mirrored/);

  await flip.click();
  await expect
    .poll(() => phone.evaluate(() => window.__facing))
    .toEqual([{ exact: "environment" }]);
  await expect(preview).not.toHaveClass(/tile__video--mirrored/); // the back camera isn't mirrored
  await expect(phone.locator("#announcer")).toHaveText("Using the back camera");

  await phone.getByRole("button", { name: "Join now" }).click();
  const selfTile = phone.locator('#tiles .tile[data-id="self"]');
  await expect(selfTile.locator("video")).not.toHaveClass(/tile__video--mirrored/);
  await selfTile.getByRole("button", { name: "Switch camera" }).click();
  await expect.poll(() => phone.evaluate(() => window.__facing.at(-1))).toEqual({ exact: "user" });
  await expect(selfTile.locator("video")).toHaveClass(/tile__video--mirrored/);
  await expect(selfTile).toHaveAttribute("data-video-off", "false");
});

test("computers don't get a camera switch", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const flip = alice.locator('#tiles .tile[data-id="self"] [aria-label="Switch camera"]');
  await expect(flip).toHaveCount(1);
  await expect(flip).toBeHidden();
  await expect(alice.locator("#lobby-flip")).toBeHidden();
});
