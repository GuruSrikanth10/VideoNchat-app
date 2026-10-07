const { test, expect, joinMeeting, expectTiles, tile } = require("./support");

test("two people get side-by-side 16:9 tiles that fit the stage", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expectTiles(alice, 2);
  // With the chat panel closed the stage is wide, so side by side is best.
  if (await alice.locator("#chat").isVisible()) await alice.locator("#chat-close").click();
  await expect(alice.locator("#chat")).toBeHidden();

  const tileBoxes = () =>
    alice
      .locator("#tiles .tile")
      .evaluateAll((tiles) => tiles.map((t) => t.getBoundingClientRect().toJSON()));
  await expect
    .poll(async () => {
      const [a, b] = await tileBoxes();
      return Math.abs(a.top - b.top);
    })
    .toBeLessThan(2); // same row

  const boxes = await tileBoxes();
  const stage = await alice.locator(".stage").evaluate((s) => s.getBoundingClientRect().toJSON());
  expect(boxes[0].right <= boxes[1].left || boxes[1].right <= boxes[0].left).toBe(true);
  for (const box of boxes) {
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    expect(box.bottom).toBeLessThanOrEqual(stage.bottom + 1);
    expect(box.right).toBeLessThanOrEqual(stage.right + 1);
  }
});

test("pinning puts someone in the spotlight until unpinned", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await expect(tile(alice, "Bob")).toBeVisible();

  await alice.getByRole("button", { name: "Pin Bob" }).click();
  await expect(alice.locator("#tiles")).toHaveAttribute("data-layout", "focus");
  await expect(tile(alice, "Bob")).toHaveAttribute("data-main", "");
  const unpin = alice.getByRole("button", { name: "Unpin Bob" });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");

  await unpin.click();
  await expect(alice.locator("#tiles")).toHaveAttribute("data-layout", "grid");
});

test("someone who leaves while pinned is unpinned", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  await alice.getByRole("button", { name: "Pin Bob" }).click();
  await bob.close();
  await expect(tile(alice, "Bob")).toHaveCount(0);
  await expect(alice.locator("#tiles")).toHaveAttribute("data-layout", "grid");
});

test("tile buttons are reachable with the keyboard", async ({ openUser, room }) => {
  const alice = await openUser();
  const bob = await openUser();
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  const pin = alice.getByRole("button", { name: "Pin Bob" });
  await pin.focus();
  await expect(pin).toBeVisible();
  await alice.keyboard.press("Enter");
  await expect(tile(alice, "Bob")).toHaveAttribute("data-main", "");
});

test("the call fits a 360px-wide phone with everyone on screen", async ({ openUser, room }) => {
  const users = [];
  for (const name of ["Ann", "Ben", "Cat"]) {
    const page = await openUser();
    await joinMeeting(page, room, name);
    users.push(page);
  }
  const phone = await openUser();
  await phone.setViewportSize({ width: 360, height: 740 });
  await joinMeeting(phone, room, "Phone");
  await expectTiles(phone, 4);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const outside = await phone
    .locator("#tiles .tile, #controls button:visible")
    .evaluateAll(
      (els) => els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length,
    );
  expect(outside).toBe(0);
});
