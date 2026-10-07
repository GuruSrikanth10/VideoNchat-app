const fs = require("node:fs");
const { test, expect, joinMeeting, openChat, tile } = require("./support");

test("a file shared in chat reaches everyone, straight from the sender", async ({
  openUser,
  room,
}) => {
  const people = [];
  for (const name of ["Alice", "Bob", "Carol"]) {
    const page = await openUser();
    await joinMeeting(page, room, name);
    await openChat(page);
    people.push(page);
  }
  const [alice, bob, carol] = people;
  await expect(tile(alice, "Carol")).toBeVisible();
  // Wait until the data channels are open.
  await expect
    .poll(() =>
      alice.evaluate(() =>
        window.videonchat
          .mesh()
          .ids()
          .every((id) => window.videonchat.mesh().connection(id)?.connectionState === "connected"),
      ),
    )
    .toBe(true);

  const content = Buffer.from("x".repeat(100_000) + "\nthe end\n");
  await alice.locator("#chat-file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/html",
    buffer: content,
  });

  for (const page of [bob, carol]) {
    const file = page.locator(".message__file").filter({ hasText: "notes.txt" });
    await expect(file).toContainText("Received");
    await expect(page.locator("#messages .message__author").last()).toHaveText("Alice");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      file.getByRole("link", { name: "Download notes.txt" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("notes.txt");
    expect(fs.readFileSync(await download.path()).equals(content)).toBe(true);
    // Whatever the sender claims (here text/html), opening the link in a
    // tab downloads it: it never renders as a page of this site.
    const href = await file.getByRole("link").getAttribute("href");
    const tab = await page.context().newPage();
    const opened = tab.waitForEvent("download");
    await tab.goto(href).catch(() => {}); // "download is starting"
    expect((await opened).url()).toBe(href); // (Firefox gives it no name)
    await tab.close();
  }
  await expect(alice.locator(".message__file")).toContainText("Sent");
});

test("files over the limit, or with no one to send to, aren't sent", async ({ openUser, room }) => {
  const alice = await openUser();
  await joinMeeting(alice, room, "Alice");
  await openChat(alice);
  await alice.locator("#chat-file").setInputFiles({
    name: "alone.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hi"),
  });
  await expect(alice.locator("#toasts")).toContainText("no one connected");
  await expect(alice.locator(".message__file")).toHaveCount(0);
});
