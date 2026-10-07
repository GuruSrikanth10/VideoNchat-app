const { test, expect, joinMeeting, waitForPopups } = require("./support");

test("the page loads and asks for a name without errors @smoke", async ({ openUser, room }) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await expect(page.locator(".swal2-input")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("Escape doesn't close the name prompt and blank names are rejected @smoke", async ({
  openUser,
  room,
}) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await page.keyboard.press("Escape");
  await expect(page.locator(".swal2-input")).toBeVisible();

  await page.locator(".swal2-input").fill("   ");
  await page.locator(".swal2-confirm").click();
  await expect(page.locator(".swal2-validation-message")).toHaveText("Your name cannot be empty!");
});

test("your name is remembered for next time", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Remembered Ruth");
  await page.reload();
  await expect(page.locator(".swal2-input")).toHaveValue("Remembered Ruth");
});

test("leaving works and shows the goodbye page", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Leaver");
  await waitForPopups(page);
  await page.locator("#leave-meet").click();
  await page.locator(".swal2-confirm").click();
  await expect(page).toHaveURL(/\/leave$/);
  await expect(page.locator(".swal2-title")).toHaveText("Thank You, See you soon.");
  expect(page.errors).toEqual([]);
});

test("the ping badge shows a measured round trip", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Pinger");
  await expect(page.locator("#rtt-value")).toHaveText(/^\d+ ms$/);
});
