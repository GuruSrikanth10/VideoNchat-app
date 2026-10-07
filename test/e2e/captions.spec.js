const { test, expect, joinMeeting } = require("./support");

// A speech recognizer that "hears" whatever window.__say(text, final) says.
const fakeSpeech = `(() => {
  class FakeRecognition extends EventTarget {
    start() {
      if (this.running) throw new DOMException("already started", "InvalidStateError");
      this.running = true;
      window.__recognition = this;
    }
    abort() {
      this.running = false;
    }
    stop() {
      this.running = false;
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.__say = (text, final = true) => {
    const recognition = window.__recognition;
    if (!recognition?.running) return false;
    const result = [{ transcript: text }];
    result.isFinal = final;
    const event = new Event("result");
    event.resultIndex = 0;
    event.results = [result];
    recognition.dispatchEvent(event);
    return true;
  };
})()`;

async function openSettings(page) {
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test("captions of someone's speech show for people who turn captions on", async ({
  openUser,
  room,
}) => {
  const alice = await openUser({ initScript: fakeSpeech });
  const bob = await openUser({ initScript: fakeSpeech });
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");

  let settings = await openSettings(alice);
  await settings.getByRole("switch", { name: "Show captions" }).check();
  await settings.getByRole("button", { name: "Done" }).click();

  // Nothing is captioned until Bob chooses to caption his speech.
  expect(await bob.evaluate(() => window.__say("not shared"))).toBe(false);
  settings = await openSettings(bob);
  await settings.getByRole("switch", { name: "Caption my speech" }).check();
  await settings.getByRole("button", { name: "Done" }).click();

  await bob.evaluate(() => window.__say("hello every", false));
  await expect(alice.locator("#captions")).toHaveText("Bobhello every");
  await bob.evaluate(() => window.__say("hello everyone"));
  await bob.evaluate(() => window.__say("how are you", false));
  await expect(alice.locator(".caption__text")).toHaveText("hello everyone how are you");

  // Muting stops the listening.
  await bob.getByRole("button", { name: "Mute" }).click();
  expect(await bob.evaluate(() => window.__say("secret"))).toBe(false);
  await bob.getByRole("button", { name: "Unmute" }).click();
  expect(await bob.evaluate(() => window.__say("back again"))).toBe(true);
  await expect(alice.locator(".caption__text")).toContainText("back again");
});

test("captions stay hidden for people who haven't turned them on", async ({ openUser, room }) => {
  const alice = await openUser({ initScript: fakeSpeech });
  const bob = await openUser({ initScript: fakeSpeech });
  await joinMeeting(alice, room, "Alice");
  await joinMeeting(bob, room, "Bob");
  const settings = await openSettings(bob);
  await settings.getByRole("switch", { name: "Caption my speech" }).check();
  await settings.getByRole("button", { name: "Done" }).click();
  await bob.evaluate(() => window.__say("anyone there"));
  await alice.waitForTimeout(500);
  await expect(alice.locator("#captions")).toBeHidden();
});

test("where speech can't be recognised, captions can still be shown", async ({
  openUser,
  room,
}) => {
  const page = await openUser({
    initScript: "delete window.SpeechRecognition; delete window.webkitSpeechRecognition;",
  });
  await joinMeeting(page, room, "Ada");
  const settings = await openSettings(page);
  await expect(settings.getByRole("switch", { name: "Show captions" })).toBeVisible();
  await expect(settings.getByRole("switch", { name: "Caption my speech" })).toBeHidden();
  await expect(settings.locator("#caption-me-hint")).toContainText("can't turn your speech");
});
