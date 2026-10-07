const {
  test,
  expect,
  joinMeeting,
  openChat,
  sendChat,
  chatMessages,
  chatAuthors,
} = require("./support");

async function twoPeople(openUser, room, names = ["Alice", "Bob"]) {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, names[0]);
  await joinMeeting(bob, room, names[1]);
  await openChat(alice);
  await openChat(bob);
  return { alice, bob };
}

test("chat messages are shown as text, never run as HTML", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  const payload = `<img src=x onerror="window.__pwned = true">`;
  await sendChat(bob, payload);

  await expect(chatMessages(alice)).toHaveText([payload]);
  expect(await alice.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await bob.evaluate(() => window.__pwned)).toBeUndefined();
});

test("your own messages are labelled You, even if someone shares your name", async ({
  openUser,
  room,
}) => {
  const { alice, bob } = await twoPeople(openUser, room, ["Sam", "Sam"]);
  await sendChat(alice, "from the first Sam");
  await expect(chatAuthors(alice)).toHaveText(["You"]);
  await expect(chatAuthors(bob)).toHaveText(["Sam"]);
});

test("whitespace-only messages are not sent", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  await sendChat(alice, "    ");
  await sendChat(alice, "real one");
  await expect(chatMessages(bob)).toHaveText(["real one"]);
});

test("Shift+Enter starts a new line instead of sending", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  const input = alice.locator("#chat-input");
  await input.fill("line one");
  await input.press("Shift+Enter");
  await input.pressSequentially("line two");
  await input.press("Enter");
  await expect(chatMessages(bob)).toHaveText(["line one\nline two"]);
});

test("the typing indicator follows what is in the box", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  const typing = alice.locator("#typing");

  await bob.locator("#chat-input").pressSequentially("h");
  await expect(typing).toHaveText("Bob is typing…");

  await bob.locator("#chat-input").press("Backspace");
  await expect(typing).toHaveText("");

  await bob.locator("#chat-input").pressSequentially("hello");
  await expect(typing).toHaveText("Bob is typing…");
  await bob.locator("#chat-input").press("Enter");
  await expect(typing).toHaveText("");
  await expect(chatMessages(alice)).toHaveText(["hello"]);
});

test("late joiners see the recent chat history", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  await sendChat(alice, "before you came");
  const bob = await openUser();
  await joinMeeting(bob, room, "Bob");
  await openChat(bob);
  await expect(chatMessages(bob)).toHaveText(["before you came"]);
});

test("links in messages can be opened safely", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  await sendChat(bob, "notes at https://example.com/notes. and javascript:alert(1)");

  const link = alice.locator("#messages a");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText("https://example.com/notes");
  await expect(link).toHaveAttribute("href", "https://example.com/notes");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
});

test("reading older messages isn't interrupted by new ones", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  for (let i = 1; i <= 8; i++) {
    await sendChat(bob, `message ${i}\n${"padding\n".repeat(4)}`);
    await bob.waitForTimeout(150); // stay within the chat rate limit
  }
  await expect(chatMessages(alice)).toHaveCount(8);

  const scroller = alice.locator(".chat__scroller");
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await sendChat(bob, "something new");
  await expect(chatMessages(alice)).toHaveCount(9);
  const jump = alice.getByRole("button", { name: "New messages" });
  await expect(jump).toBeVisible();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);

  await jump.click();
  await expect(jump).toBeHidden();
  await expect(chatMessages(alice).last()).toBeInViewport();
});

test("a counter appears near the length limit", async ({ openUser, room }) => {
  const { alice } = await twoPeople(openUser, room);
  const counter = alice.locator("#chat-counter");
  await alice.locator("#chat-input").fill("short");
  await expect(counter).toBeHidden();
  await alice.locator("#chat-input").fill("x".repeat(950));
  await expect(counter).toHaveText("50 characters left");
});
