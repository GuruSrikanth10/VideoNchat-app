// Shared helpers for the end-to-end tests. All knowledge of the page's
// markup lives here, so UI changes only need updating in one place.
const base = require("@playwright/test");

const { expect } = base;

// Third-party hosts are blocked so the tests never depend on the network.
const THIRD_PARTY = /(kit\.fontawesome\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|giphy\.com)/;

let roomCounter = 0;

const test = base.test.extend({
  // Opens another participant: a separate browser context (own storage,
  // own devices) with third-party requests blocked and errors recorded.
  openUser: async ({ browser, browserName }, use) => {
    const contexts = [];
    await use(async ({ initScript } = {}) => {
      const context = await browser.newContext(
        browserName === "chromium" ? { permissions: ["camera", "microphone"] } : {},
      );
      contexts.push(context);
      await context.route(THIRD_PARTY, (route) => route.abort());
      if (initScript) await context.addInitScript(initScript);
      const page = await context.newPage();
      page.errors = [];
      page.on("pageerror", (err) => page.errors.push(err.message));
      return page;
    });
    for (const context of contexts) await context.close();
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  room: async ({}, use, testInfo) => {
    await use(`e2e-${testInfo.workerIndex}-${Date.now()}-${++roomCounter}`);
  },
});

async function joinMeeting(page, room, name) {
  await page.goto(`/${room}`);
  const input = page.locator(".swal2-input");
  await input.fill(name);
  await page.locator(".swal2-confirm").click();
  await expect(input).toBeHidden();
}

// Waits until all modal pop-ups (join notices etc.) have closed.
async function waitForPopups(page) {
  await expect(page.locator(".swal2-container")).toHaveCount(0);
}

// Video tiles that are showing a live stream with real frames.
function liveTiles(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll("#video-grid video")].filter(
        (v) =>
          v.srcObject &&
          v.videoWidth > 0 &&
          v.srcObject.getTracks().every((t) => t.readyState === "live"),
      ).length,
  );
}

async function expectTiles(page, count) {
  await expect.poll(() => liveTiles(page), { timeout: 20_000 }).toBe(count);
}

async function sendChat(page, text) {
  await page.locator("#chat_message").fill(text);
  await page.locator("#send").click();
}

const chatMessages = (page) => page.locator(".messages .message > span");
const chatAuthors = (page) => page.locator(".messages .profile span");

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
  joinMeeting,
  waitForPopups,
  expectTiles,
  sendChat,
  chatMessages,
  chatAuthors,
  slowPermission,
  failingMedia,
};
