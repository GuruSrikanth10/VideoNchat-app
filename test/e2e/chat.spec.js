const {
  test,
  expect,
  joinMeeting,
  waitForPopups,
  sendChat,
  chatMessages,
  chatAuthors,
} = require("./support");

async function twoPeople(openUser, room, names = ["Alice", "Bob"]) {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, names[0]);
  await joinMeeting(bob, room, names[1]);
  await waitForPopups(alice);
  await waitForPopups(bob);
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

test("your own messages are labelled me, even if someone shares your name", async ({
  openUser,
  room,
}) => {
  const { alice, bob } = await twoPeople(openUser, room, ["Sam", "Sam"]);
  await sendChat(alice, "from the first Sam");
  await expect(chatAuthors(alice)).toHaveText(["me"]);
  await expect(chatAuthors(bob)).toHaveText(["Sam"]);
});

test("whitespace-only messages are not sent", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  await sendChat(alice, "    ");
  await sendChat(alice, "real one");
  await expect(chatMessages(bob)).toHaveText(["real one"]);
});

test("the typing indicator follows what is in the box", async ({ openUser, room }) => {
  const { alice, bob } = await twoPeople(openUser, room);
  const feedback = alice.locator("#feedback");

  await bob.locator("#chat_message").pressSequentially("h");
  await expect(feedback).toHaveText("Bob is typing…");

  await bob.locator("#chat_message").press("Backspace");
  await expect(feedback).toHaveText("");

  await bob.locator("#chat_message").pressSequentially("hello");
  await expect(feedback).toHaveText("Bob is typing…");
  await bob.locator("#chat_message").press("Enter");
  await expect(feedback).toHaveText("");
  await expect(chatMessages(alice)).toHaveText(["hello"]);
});
