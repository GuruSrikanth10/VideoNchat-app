const { test, expect, joinMeeting, tile, openPeople, peopleRows } = require("./support");

async function twoPeople(openUser, room) {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expect(tile(bob, "Alice")).toBeVisible();
  return { alice, bob };
}

test("raising a hand shows everyone, in order, until it's lowered", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  await openPeople(bob);

  await alice.getByRole("button", { name: "React" }).click();
  await alice.getByRole("button", { name: "Raise hand" }).click();
  await expect(bob.locator("#toasts")).toContainText("Alice raised a hand");
  await expect(tile(bob, "Alice")).toHaveAttribute("data-hand", "true");
  // Raised hands go to the top of the list, ahead of you.
  await expect(peopleRows(bob).first()).toContainText("Alice");
  await expect(peopleRows(bob).first()).toContainText("hand raised");
  await expect(alice.locator("#hand-badge")).toBeVisible();
  await expect(alice.locator("#announcer")).toHaveText("Your hand is raised");

  // Ctrl+Alt+H lowers it again.
  await alice.keyboard.press("Control+Alt+h");
  await expect(tile(bob, "Alice")).toHaveAttribute("data-hand", "false");
  await expect(peopleRows(bob).first()).toContainText("Bob (you)");
  await expect(alice.locator("#hand-badge")).toBeHidden();
  await alice.getByRole("button", { name: "React" }).click();
  await expect(alice.getByRole("button", { name: "Raise hand" })).toBeVisible();
});

test("reactions float up on the sender's tile for everyone", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  await alice.getByRole("button", { name: "React" }).click();
  await alice.getByRole("button", { name: "Send celebration" }).click();

  await expect(tile(bob, "Alice").locator(".tile__reaction")).toHaveText("🎉");
  await expect(bob.locator("#announcer")).toHaveText("Alice reacted with celebration");
  await expect(tile(alice, "Alice (you)").locator(".tile__reaction")).toHaveText("🎉");
  // They're gone again after a few seconds.
  await expect(tile(bob, "Alice").locator(".tile__reaction")).toHaveCount(0, { timeout: 6000 });
});

test("the React menu works from the keyboard", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const react = alice.getByRole("button", { name: "React" });
  await react.focus();
  await alice.keyboard.press("Enter");
  await expect(react).toHaveAttribute("aria-expanded", "true");
  await expect(alice.getByRole("button", { name: "Raise hand" })).toBeFocused();
  await alice.keyboard.press("Tab");
  await expect(alice.getByRole("button", { name: "Send thumbs up" })).toBeFocused();
  await alice.keyboard.press("Escape");
  await expect(react).toHaveAttribute("aria-expanded", "false");
  await expect(alice.locator("#reactions")).toBeHidden();
});

test("on a phone, inviting moves into the People panel", async ({ openUser, room }) => {
  const phone = await openUser();
  await phone.setViewportSize({ width: 360, height: 740 });
  await joinMeeting(phone, room, "Phone");
  await expect(phone.locator("#invite")).toBeHidden();
  await phone.getByRole("button", { name: "People: Just you" }).click();
  await expect(phone.getByRole("button", { name: "Invite people" })).toBeVisible();
});
