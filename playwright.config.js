// End-to-end tests run real browsers against a local server with fake
// camera and microphone devices. E2E_BROWSERS picks the browsers
// (comma-separated); it defaults to chromium.
const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.E2E_PORT) || 3210;
const browsers = (process.env.E2E_BROWSERS || "chromium").split(",").map((b) => b.trim());

const projects = {
  chromium: {
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: {
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--disable-features=WebRtcHideLocalIpsWithMdns",
        ],
      },
    },
  },
  firefox: {
    name: "firefox",
    use: {
      ...devices["Desktop Firefox"],
      launchOptions: {
        firefoxUserPrefs: {
          "media.navigator.streams.fake": true,
          "media.navigator.permission.disabled": true,
          "media.peerconnection.ice.obfuscate_host_addresses": false,
        },
      },
    },
  },
  // WebKit has no fake media devices, so it only runs the @smoke tests.
  webkit: { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@smoke/ },
};

module.exports = defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node app.js",
    env: { PORT: String(PORT), METRICS_TOKEN: "e2e-metrics-token-for-tests" },
    url: `http://127.0.0.1:${PORT}/leave`,
    reuseExistingServer: !process.env.CI,
  },
  projects: browsers.map((name) => {
    if (!projects[name]) throw new Error(`Unknown browser in E2E_BROWSERS: ${name}`);
    return projects[name];
  }),
});
