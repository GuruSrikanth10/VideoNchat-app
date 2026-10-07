// Shared helpers for the end-to-end tests. All knowledge of the page's
// markup lives here, so UI changes only need updating in one place.
const base = require("@playwright/test");

const { expect } = base;

let roomCounter = 0;

const test = base.test.extend({
  // Opens another participant: a separate browser context (own storage,
  // own devices). Page errors, console errors and CSP violations are
  // recorded in page.errors.
  openUser: async ({ browser, browserName }, use) => {
    const contexts = [];
    await use(async ({ initScript } = {}) => {
      const context = await browser.newContext(
        browserName === "chromium" ? { permissions: ["camera", "microphone"] } : {},
      );
      contexts.push(context);
      // Nothing may be loaded from other origins.
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      if (initScript) await context.addInitScript(initScript);
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      const page = await context.newPage();
      page.errors = [];
      page.on("pageerror", (err) => page.errors.push(err.message));
      page.on("console", (message) => {
        if (message.type() === "error") page.errors.push(message.text());
      });
      return page;
    });
    for (const context of contexts) await context.close();
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  room: async ({}, use, testInfo) => {
    await use(`e2e-${testInfo.workerIndex}-${Date.now()}-${++roomCounter}`);
  },
});

const nameField = (page) => page.getByRole("textbox", { name: "Your name" });

// Opens a page and waits for its HTML and styles, not its "load" event. The
// app never relies on "load", and under CI load Firefox has now and then
// never fired it, even for the static 404 page.
async function openPage(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  // Pages without scripts can get here before their CSS has arrived.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')].every((link) => link.sheet),
  );
  return response;
}

// Opens the meeting's lobby, optionally changes devices there, and joins.
async function joinMeeting(page, room, name, { beforeJoin } = {}) {
  await openPage(page, `/${room}`);
  await nameField(page).fill(name);
  if (beforeJoin) await beforeJoin(page);
  await page.getByRole("button", { name: "Join now" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-state", "call");
  await expect(page.locator("#participant-count")).not.toHaveText("Joining…");
}

// Tiles of people (not screens) that show live video with real frames.
function liveTiles(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll("#tiles .tile:not(.tile--screen)")].filter((tile) => {
        const video = tile.querySelector("video");
        const tracks = video.srcObject?.getVideoTracks() ?? [];
        return (
          video.videoWidth > 0 &&
          tracks.some((t) => t.readyState === "live") &&
          tile.dataset.videoOff !== "true"
        );
      }).length,
  );
}

async function expectTiles(page, count) {
  await expect.poll(() => liveTiles(page), { timeout: 20_000 }).toBe(count);
}

const tile = (page, name) => page.locator("#tiles .tile").filter({ hasText: name });

async function openChat(page) {
  if (!(await page.locator("#chat").isVisible())) await page.locator("#chat-toggle").click();
  await expect(page.locator("#chat-input")).toBeVisible();
}

async function openPeople(page) {
  if (!(await page.locator("#people").isVisible())) await page.locator("#people-toggle").click();
  await expect(page.locator("#people")).toBeVisible();
}

// One row per person in the People panel.
const peopleRows = (page) => page.locator("#people-list .person");

async function sendChat(page, text) {
  await openChat(page);
  await page.locator("#chat-input").fill(text);
  await page.locator("#chat-input").press("Enter");
}

async function leaveMeeting(page) {
  await page.getByRole("button", { name: "Leave", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/leave\?room=/);
}

const chatMessages = (page) => page.locator("#messages .message__text");
const chatAuthors = (page) => page.locator("#messages .message__author");

// Simulates a person who takes `ms` to answer the camera permission prompt.
const slowPermission = (ms) => `(() => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (constraints) =>
    new Promise((resolve, reject) => setTimeout(() => original(constraints).then(resolve, reject), ${ms}));
})()`;

// Simulates a browser where getUserMedia fails with the given error name.
const failingMedia = (name) =>
  `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("simulated", "${name}"));`;

module.exports = {
  test,
  expect,
  openPage,
  joinMeeting,
  nameField,
  expectTiles,
  tile,
  openChat,
  openPeople,
  peopleRows,
  sendChat,
  leaveMeeting,
  chatMessages,
  chatAuthors,
  slowPermission,
  failingMedia,
};
