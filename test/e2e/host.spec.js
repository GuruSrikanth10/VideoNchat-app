const {
  test,
  expect,
  joinMeeting,
  nameField,
  tile,
  openPeople,
  leaveMeeting,
  openPage,
} = require("./support");

async function meeting(openUser, room, names) {
  const pages = [];
  for (const name of names) {
    const page = await openUser();
    await joinMeeting(page, room, name);
    pages.push(page);
  }
  return pages;
}

// Opens the host's menu for someone in the People panel.
async function personMenu(host, name) {
  await openPeople(host);
  await host.getByRole("button", { name: `Options for ${name}` }).click();
  return host.locator("#person-menu");
}

test("the first person in is the host, with the lock switch", async ({ openUser, room }) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  await openPeople(alice);
  await openPeople(bob);
  await expect(alice.getByRole("switch", { name: "Lock meeting" })).toBeVisible();
  await expect(bob.getByRole("switch", { name: "Lock meeting" })).toBeHidden();
  await expect(bob.locator("#people-list .person").filter({ hasText: "Alice" })).toContainText(
    "Host",
  );
  await expect(bob.getByRole("button", { name: "Options for Alice" })).toBeHidden();
});

test("a locked meeting lets people in only when the host admits them @smoke", async ({
  openUser,
  room,
}) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  await openPeople(alice);
  await alice.getByRole("switch", { name: "Lock meeting" }).check();
  await expect(bob.locator("#lock-state")).toBeVisible();
  await expect(bob.locator("#toasts")).toContainText("The meeting is locked");

  const carol = await openUser();
  await openPage(carol, `/${room}`);
  await nameField(carol).fill("Carol");
  await expect(carol.locator("#room-info")).toContainText("This meeting is locked");
  await carol.getByRole("button", { name: "Ask to join" }).click();
  await expect(carol.locator("#room-info")).toHaveText("Waiting for the host to let you in…");

  await expect(alice.getByText("Carol wants to join")).toBeVisible();
  await expect(bob.getByText("Carol wants to join")).toBeHidden(); // only hosts are asked
  await alice.getByRole("button", { name: "Admit Carol" }).click();
  await expect(carol.locator("body")).toHaveAttribute("data-state", "call");
  await expect(tile(alice, "Carol")).toBeVisible();
  await expect(alice.getByText("Carol wants to join")).toBeHidden();
});

test("a host can turn someone away", async ({ openUser, room }) => {
  const [alice] = await meeting(openUser, room, ["Alice"]);
  await openPeople(alice);
  await alice.getByRole("switch", { name: "Lock meeting" }).check();

  const carol = await openUser();
  await openPage(carol, `/${room}`);
  await nameField(carol).fill("Carol");
  await carol.getByRole("button", { name: "Ask to join" }).click();
  await alice.getByRole("button", { name: "Deny Carol" }).click();
  await expect(carol.locator("#room-info")).toHaveText("The host didn't let you in.");
  await expect(carol.getByRole("button", { name: "Ask to join" })).toBeEnabled();
  await expect(carol.locator("body")).toHaveAttribute("data-state", "lobby");
});

test("a host can mute someone and ask them to unmute", async ({ openUser, room }) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  const menu = await personMenu(alice, "Bob");
  await menu.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(bob.locator("#mic")).toHaveAccessibleName("Unmute");
  await expect(bob.locator("#toasts")).toContainText("Alice muted you");

  await alice.getByRole("button", { name: "Options for Bob" }).click();
  await expect(menu.getByRole("button", { name: "Mute", exact: true })).toBeHidden();
  await menu.getByRole("button", { name: "Ask to unmute" }).click();
  const dialog = bob.getByRole("dialog", { name: "Alice asks you to unmute" });
  await expect(dialog).toBeVisible();
  // Only Bob can turn his mic back on.
  await expect(bob.locator("#mic")).toHaveAccessibleName("Unmute");
  await dialog.getByRole("button", { name: "Unmute" }).click();
  await expect(bob.locator("#mic")).toHaveAccessibleName("Mute");
});

test("a host can lower someone's hand", async ({ openUser, room }) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  await bob.keyboard.press("Control+Alt+h");
  await expect(tile(alice, "Bob")).toHaveAttribute("data-hand", "true");
  const menu = await personMenu(alice, "Bob");
  await menu.getByRole("button", { name: "Lower hand" }).click();
  await expect(tile(alice, "Bob")).toHaveAttribute("data-hand", "false");
  await expect(bob.locator("#announcer")).toHaveText("The host lowered your hand");
  await expect(bob.locator("#hand-badge")).toBeHidden();
});

test("a host can remove someone from the meeting", async ({ openUser, room }) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  const menu = await personMenu(alice, "Bob");
  await menu.getByRole("button", { name: "Remove from meeting" }).click();
  await alice
    .getByRole("dialog", { name: "Remove Bob?" })
    .getByRole("button", { name: "Remove from meeting" })
    .click();
  await expect(bob).toHaveURL(/\/leave\?.*reason=removed/);
  await expect(
    bob.getByRole("heading", { name: "You were removed from the meeting" }),
  ).toBeVisible();
  await expect(bob.getByRole("link", { name: "Rejoin" })).toBeHidden();
  await expect(tile(alice, "Bob")).toHaveCount(0);
});

test("when the host leaves, the next person becomes host", async ({ openUser, room }) => {
  const [alice, bob] = await meeting(openUser, room, ["Alice", "Bob"]);
  await leaveMeeting(alice);
  await expect(bob.locator("#toasts")).toContainText("You're now the host");
  await openPeople(bob);
  await expect(bob.getByRole("switch", { name: "Lock meeting" })).toBeVisible();
});
