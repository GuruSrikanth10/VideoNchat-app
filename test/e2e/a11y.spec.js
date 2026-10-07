const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect, joinMeeting, waitForPopups } = require("./support");

test("the room page has no axe-core violations", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  await waitForPopups(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("every control can be reached with the keyboard", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Keyboard Kim");
  await waitForPopups(page);

  const reached = new Set();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement.id));
  }
  for (const id of ["leave-meet", "stopVideo", "muteButton", "shareScreen", "inviteButton"]) {
    expect(reached, id).toContain(id);
  }
  for (const id of ["chat_message", "send"]) expect(reached, id).toContain(id);
});

test("toggles expose their state to assistive technology", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  await waitForPopups(page);
  const mute = page.locator("#muteButton");
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
});
