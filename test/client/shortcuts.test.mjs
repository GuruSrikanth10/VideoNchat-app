import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matches,
  keysFor,
  describeKeys,
  ariaFor,
  shortcutFor,
  isApple,
} from "../../public/js/ui/shortcuts.js";

const press = (key, modifiers = {}, code = `Key${key.toUpperCase()}`) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  getModifierState: () => false,
  ...modifiers,
});

const mic = shortcutFor("mic");
const chat = shortcutFor("chat");
const help = shortcutFor("help");
const pc = { apple: false };
const mac = { apple: true };

test("Ctrl+D on Windows and Linux, ⌘D on Apple devices", () => {
  assert.equal(matches(press("d", { ctrlKey: true }), mic, pc), true);
  assert.equal(matches(press("d", { metaKey: true }), mic, mac), true);
  assert.equal(matches(press("d", { metaKey: true }), mic, pc), false);
  assert.equal(matches(press("d", { ctrlKey: true }), mic, mac), false);
});

test("extra modifiers or a different letter don't count", () => {
  assert.equal(matches(press("d"), mic, pc), false);
  assert.equal(matches(press("d", { ctrlKey: true, altKey: true }), mic, pc), false);
  assert.equal(matches(press("D", { ctrlKey: true, shiftKey: true }), mic, pc), false);
  assert.equal(matches(press("e", { ctrlKey: true }), mic, pc), false);
});

test("panel shortcuts are Ctrl+Alt, or Ctrl+⌘ on Apple devices", () => {
  assert.equal(matches(press("c", { ctrlKey: true, altKey: true }), chat, pc), true);
  assert.equal(matches(press("c", { ctrlKey: true, metaKey: true }), chat, mac), true);
  assert.equal(matches(press("c", { ctrlKey: true }), chat, pc), false);
});

test("AltGr, which types characters, is never a shortcut", () => {
  const altGr = press("ć", {
    ctrlKey: true,
    altKey: true,
    getModifierState: (key) => key === "AltGraph",
  });
  assert.equal(matches({ ...altGr, code: "KeyC" }, chat, pc), false);
});

test("non-Latin layouts use the physical key", () => {
  assert.equal(matches(press("в", { ctrlKey: true }, "KeyD"), mic, pc), true);
  // On Latin layouts the letter wins, wherever the key is (e.g. Dvorak).
  assert.equal(matches(press("e", { ctrlKey: true }, "KeyD"), mic, pc), false);
});

test("the help shortcut works whether or not / needs Shift", () => {
  assert.equal(matches(press("/", { ctrlKey: true }, "Slash"), help, pc), true);
  assert.equal(matches(press("/", { ctrlKey: true, shiftKey: true }, "Digit7"), help, pc), true);
  assert.equal(matches(press("?", { ctrlKey: true, shiftKey: true }, "Slash"), help, pc), true);
});

test("shortcuts are described in each platform's style", () => {
  assert.deepEqual(keysFor(mic, pc), ["Ctrl", "D"]);
  assert.deepEqual(keysFor(chat, mac), ["⌃", "⌘", "C"]);
  assert.equal(describeKeys(chat, pc), "Ctrl+Alt+C");
  assert.equal(describeKeys(mic, mac), "⌘D");
  assert.equal(ariaFor(mic, pc), "Control+D");
  assert.equal(ariaFor(chat, mac), "Control+Meta+C");
});

test("Apple devices are recognised", () => {
  assert.equal(isApple("MacIntel"), true);
  assert.equal(isApple("iPhone"), true);
  assert.equal(isApple("macOS"), true);
  assert.equal(isApple("Win32"), false);
  assert.equal(isApple("Linux x86_64"), false);
});
