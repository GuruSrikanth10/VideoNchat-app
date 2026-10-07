const { test, expect, joinMeeting, openPeople, peopleRows } = require("./support");

test("the People panel lists everyone and what they share", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await openPeople(alice);

  const rows = peopleRows(alice);
  await expect(rows).toHaveText([/Alice \(you\)/, /^B.*Bob/]);
  await expect(rows.nth(1)).not.toContainText("muted");

  // Bob mutes and stops his video; Alice's list follows.
  await bob.getByRole("button", { name: "Mute" }).click();
  await bob.getByRole("button", { name: "Stop video" }).click();
  await expect(rows.nth(1)).toContainText("muted");
  await expect(rows.nth(1)).toContainText("camera off");

  // Alice's own state is shown too.
  await alice.getByRole("button", { name: "Mute" }).click();
  await expect(rows.nth(0)).toContainText("muted");

  await bob.close();
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
});

test("only one side panel is open at a time, and Escape closes it", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  const chatToggle = alice.locator("#chat-toggle");
  const peopleToggle = alice.locator("#people-toggle");

  await peopleToggle.click();
  await expect(alice.locator("#people")).toBeVisible();
  await expect(alice.locator("#chat")).toBeHidden();
  await expect(peopleToggle).toHaveAttribute("aria-expanded", "true");
  await expect(chatToggle).toHaveAttribute("aria-expanded", "false");

  await chatToggle.click();
  await expect(alice.locator("#chat")).toBeVisible();
  await expect(alice.locator("#people")).toBeHidden();
  await expect(alice.locator("#chat-input")).toBeFocused();

  await alice.keyboard.press("Escape");
  await expect(alice.locator("#chat")).toBeHidden();
  await expect(chatToggle).toBeFocused();
  await expect(chatToggle).toHaveAttribute("aria-expanded", "false");
});

test("on a phone the participant count opens People", async ({ openUser, room }) => {
  const phone = await openUser();
  await phone.setViewportSize({ width: 360, height: 740 });
  await joinMeeting(phone, room, "Phone");
  await expect(phone.locator("#people-toggle")).toBeHidden();

  const count = phone.getByRole("button", { name: "People: Just you" });
  await count.click();
  await expect(phone.locator("#people")).toBeVisible();
  await expect(count).toHaveAttribute("aria-expanded", "true");
  await expect(phone.getByRole("heading", { name: "People (1)" })).toBeVisible();

  await phone.getByRole("button", { name: "Close people" }).click();
  await expect(phone.locator("#people")).toBeHidden();
  await expect(count).toBeFocused();
});
