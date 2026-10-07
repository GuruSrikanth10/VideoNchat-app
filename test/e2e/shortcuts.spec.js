const { test, expect, joinMeeting, nameField, openChat } = require("./support");

// Needs a microphone and camera, which WebKit doesn't fake.
test("Ctrl+D and Ctrl+E turn the mic and camera on and off", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const mic = alice.locator("#mic");
  const camera = alice.locator("#camera");
  await expect(mic).toHaveAttribute("aria-keyshortcuts", "Control+D");
  await expect(camera).toHaveAttribute("aria-keyshortcuts", "Control+E");

  await alice.keyboard.press("Control+d");
  await expect(mic).toHaveAccessibleName("Unmute");
  await expect(alice.locator("#announcer")).toHaveText("Microphone off");
  await alice.keyboard.press("Control+d");
  await expect(mic).toHaveAccessibleName("Mute");
  await expect(alice.locator("#announcer")).toHaveText("Microphone on");

  await alice.keyboard.press("Control+e");
  await expect(camera).toHaveAccessibleName("Start video");
  await expect(alice.locator("#announcer")).toHaveText("Camera off");
});

test("the mic shortcut works while typing a message, without typing", async ({
  openUser,
  room,
}) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  await openChat(alice);
  const input = alice.locator("#chat-input");
  await input.pressSequentially("hi");
  await alice.keyboard.press("Control+d");
  await expect(alice.locator("#mic")).toHaveAccessibleName("Unmute");
  await expect(input).toHaveValue("hi");
});

test("panel shortcuts open and close chat and people", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  await alice.locator("#controls").focus();
  await alice.keyboard.press("Control+Alt+p");
  await expect(alice.locator("#people")).toBeVisible();
  await alice.keyboard.press("Control+Alt+c");
  await expect(alice.locator("#chat")).toBeVisible();
  await expect(alice.locator("#people")).toBeHidden();
  await alice.keyboard.press("Control+Alt+c");
  await expect(alice.locator("#chat")).toBeHidden();
  // Focus was in the chat box, so it moves to the Chat button.
  await expect(alice.locator("#chat-toggle")).toBeFocused();
});

test("Ctrl+/ lists the shortcuts, also reachable from Settings @smoke", async ({
  openUser,
  room,
}) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const help = alice.getByRole("dialog", { name: "Keyboard shortcuts" });

  await alice.keyboard.press("Control+/");
  await expect(help).toBeVisible();
  await expect(help.locator(".shortcut").first()).toHaveText(
    /Turn your microphone on or off\s*Ctrl\s*D/,
  );
  await alice.keyboard.press("Escape");
  await expect(help).toBeHidden();

  await alice.getByRole("button", { name: "Settings" }).click();
  await alice.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(help).toBeVisible();
  await expect(alice.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

test("the mic and camera shortcuts work in the lobby too", async ({ openUser, room }) => {
  const alice = await openUser();
  await alice.goto(`/${room}`);
  await nameField(alice).fill("Alice");
  const mic = alice.locator("#lobby-mic");
  await expect(mic).toHaveAccessibleName("Turn off microphone");
  await alice.keyboard.press("Control+d");
  await expect(mic).toHaveAccessibleName("Turn on microphone");
  await expect(nameField(alice)).toHaveValue("Alice");

  await alice.getByRole("button", { name: "Join now" }).click();
  await expect(alice.locator("#mic")).toHaveAccessibleName("Unmute");
});
