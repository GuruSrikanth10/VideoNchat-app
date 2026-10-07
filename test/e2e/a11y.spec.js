const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect, joinMeeting, openChat } = require("./support");

test("the meeting page has no axe-core violations", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  await openChat(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("the lobby and leave page have no axe-core violations", async ({ openUser, room }) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(`/leave?room=${room}`);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("every control can be reached with the keyboard", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Keyboard Kim");
  await openChat(page);

  // Start from the top of the page: Firefox doesn't wrap around at the end,
  // and blurring keeps its starting point wherever focus was.
  await page.locator(".skip-link").focus();
  const reached = new Set();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement.id));
  }
  for (const id of ["mic", "camera", "chat-toggle", "invite", "leave", "chat-input"]) {
    expect(reached, id).toContain(id);
  }
});

test("control labels say what pressing them will do", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Ada");
  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
  await page.getByRole("button", { name: "Stop video" }).click();
  await expect(page.getByRole("button", { name: "Start video" })).toBeVisible();
});
