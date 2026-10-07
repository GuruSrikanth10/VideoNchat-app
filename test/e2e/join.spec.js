const {
  test,
  expect,
  joinMeeting,
  nameField,
  leaveMeeting,
  tile,
  expectTiles,
} = require("./support");

test("the lobby shows a preview and asks for a name @smoke", async ({ openUser, room }) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await expect(page.getByRole("heading", { name: "Ready to join?" })).toBeVisible();
  await expect(nameField(page)).toBeFocused();
  await expect(page.locator("#room-info")).toHaveText("No one else is here yet.");
  expect(page.errors).toEqual([]);
});

test("blank names aren't accepted @smoke", async ({ openUser, room }) => {
  const page = await openUser();
  await page.goto(`/${room}`);
  await nameField(page).fill("   ");
  await page.getByRole("button", { name: "Join now" }).click();
  await expect(page.locator("#name-error")).toHaveText("Please enter your name.");
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("body")).toHaveAttribute("data-state", "lobby");
});

test("the lobby says how many people are already in the meeting", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const bob = await openUser();
  await bob.goto(`/${room}`);
  await expect(bob.locator("#room-info")).toHaveText("1 person is in this meeting.");
});

test("your name is remembered for next time", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Remembered Ruth");
  await page.reload();
  await expect(nameField(page)).toHaveValue("Remembered Ruth");
  await expect(page.getByRole("button", { name: "Join now" })).toBeFocused();
});

test("you can join with the microphone and camera already off", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const bob = await openUser();
  await joinMeeting(bob, room, "Bob", {
    beforeJoin: async (page) => {
      await page.getByRole("button", { name: "Turn off microphone" }).click();
      await page.getByRole("button", { name: "Turn off camera" }).click();
      await expect(page.getByRole("button", { name: "Turn on camera" })).toBeVisible();
    },
  });
  await expect(bob.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Start video" })).toBeVisible();
  await expect(tile(alice, "Bob")).toHaveAttribute("data-muted", "true");
  await expect(tile(alice, "Bob")).toHaveAttribute("data-video-off", "true");
  await expectTiles(alice, 1); // only her own video
});

test("the lobby lists cameras and microphones", async ({ openUser, room, browserName }) => {
  test.skip(browserName === "webkit", "no fake devices");
  const page = await openUser();
  await page.goto(`/${room}`);
  const lobby = page.locator("#lobby");
  await lobby.getByText("Camera, microphone and speaker").click();
  await expect(lobby.getByLabel("Camera", { exact: true }).locator("option")).not.toHaveCount(0);
  await expect(lobby.getByLabel("Microphone", { exact: true }).locator("option")).not.toHaveCount(
    0,
  );
  await expect(lobby.getByLabel("Camera", { exact: true })).toBeEnabled();
});

test("settings can be opened during the call", async ({ openUser, room }) => {
  const page = await openUser();
  await joinMeeting(page, room, "Settler");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByLabel("Camera", { exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
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
