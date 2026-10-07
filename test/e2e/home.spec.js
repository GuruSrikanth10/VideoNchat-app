const { test, expect, openPage } = require("./support");
const AxeBuilder = require("@axe-core/playwright").default;

test("the landing page starts a new meeting @smoke", async ({ openUser }) => {
  const page = await openUser();
  await openPage(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Video meetings in your browser",
  );
  await page.getByRole("link", { name: "New meeting" }).click();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/);
  expect(page.errors).toEqual([]);
});

test("you can join with a code or a full link @smoke", async ({ openUser, baseURL }) => {
  const page = await openUser();
  const box = page.getByRole("textbox", { name: "Meeting link or code" });

  await openPage(page, "/");
  await box.fill("team-standup");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(/\/team-standup$/);

  await openPage(page, "/");
  await box.fill(`${baseURL}/design-review?ref=email`);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/design-review$/);
});

test("invalid codes are explained instead of followed @smoke", async ({ openUser }) => {
  const page = await openUser();
  await openPage(page, "/");
  const box = page.getByRole("textbox", { name: "Meeting link or code" });
  await box.fill("https://somewhere-else.example/room");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That doesn't look like a meeting link or code from this site.",
  );
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/$/);
});

test("the landing page has no axe-core violations", async ({ openUser }) => {
  const page = await openUser();
  await openPage(page, "/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("pages fit a 360px-wide phone without sideways scrolling @smoke", async ({
  openUser,
  room,
}) => {
  const page = await openUser();
  await page.setViewportSize({ width: 360, height: 740 });
  for (const url of ["/", `/${room}`, `/leave?room=${room}`, "/no/such/page"]) {
    await openPage(page, url);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, url).toBeLessThanOrEqual(360);
  }
});
