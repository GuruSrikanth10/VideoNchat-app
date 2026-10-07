const { test, expect, joinMeeting, nameField, leaveMeeting } = require("./support");

test("the meeting page loads and asks for a name without errors @smoke", async ({
  openUser,
  room,
}) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await expect(nameField(page)).toBeVisible();
  await expect(nameField(page)).toBeFocused();
  expect(page.errors).toEqual([]);
});

test("Escape doesn't close the name prompt and blank names aren't accepted @smoke", async ({
  openUser,
  room,
}) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await page.keyboard.press("Escape");
  await expect(nameField(page)).toBeVisible();

  await nameField(page).fill("   ");
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(nameField(page)).toBeVisible();
});

test("your name is remembered for next time", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Remembered Ruth");
  await page.reload();
  await expect(nameField(page)).toHaveValue("Remembered Ruth");
});

test("leaving offers to rejoin or start a new meeting", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Leaver");
  await leaveMeeting(page);
  await expect(page.getByRole("link", { name: "Rejoin" })).toHaveAttribute("href", `/${room}`);
  await page.getByRole("link", { name: "Start a new meeting" }).click();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/);
  expect(page.errors).toEqual([]);
});

test("the connection badge shows a measured round trip", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Pinger");
  await expect(page.locator("#ping-value")).toHaveText(/^\d+ ms$/);
});

test("unknown pages explain themselves @smoke", async ({ openUser }) => {
  const page = await openUser();
  const response = await page.goto("/not/a/meeting");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
