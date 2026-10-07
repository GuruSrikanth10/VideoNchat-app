import { test } from "node:test";
import assert from "node:assert/strict";
import { linkify } from "../../public/js/ui/chat.js";

test("plain text has no links", () => {
  assert.deepEqual(linkify("hello there"), ["hello there"]);
  assert.deepEqual(linkify(""), []);
});

test("http and https URLs become links, and the text around them stays", () => {
  assert.deepEqual(linkify("see https://example.com/a?b=1 now"), [
    "see ",
    { href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" },
    " now",
  ]);
  assert.deepEqual(linkify("http://a.test"), [{ href: "http://a.test/", text: "http://a.test" }]);
});

test("trailing punctuation stays with the sentence", () => {
  assert.deepEqual(linkify("(go to https://example.com/x)."), [
    "(go to ",
    { href: "https://example.com/x", text: "https://example.com/x" },
    ").",
  ]);
});

test("other schemes are never linked", () => {
  assert.deepEqual(linkify("javascript:alert(1)"), ["javascript:alert(1)"]);
  assert.deepEqual(linkify("data:text/html,hi"), ["data:text/html,hi"]);
});

test("several links in one message", () => {
  const parts = linkify("https://a.test and https://b.test");
  assert.deepEqual(
    parts.map((part) => (typeof part === "string" ? part : part.href)),
    ["https://a.test/", " and ", "https://b.test/"],
  );
});
