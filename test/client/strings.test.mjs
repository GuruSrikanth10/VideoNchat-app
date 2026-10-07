import { test } from "node:test";
import assert from "node:assert/strict";
import { strings } from "../../public/js/strings.js";

test("counts use the right plural form", () => {
  assert.equal(strings.call.count(1), "Just you");
  assert.equal(strings.call.count(3), "3 in call");
  assert.equal(strings.lobby.peopleHere(1), "1 person is in this meeting.");
  assert.equal(strings.lobby.peopleHere(4), "4 people are in this meeting.");
  assert.equal(strings.chat.charactersLeft(1), "1 character left");
  assert.equal(strings.chat.charactersLeft(0), "0 characters left");
});

test("the tab title only shows a count when others are there", () => {
  assert.equal(strings.call.title(1), "Meeting · VideoNChat");
  assert.equal(strings.call.title(2), "(2) Meeting · VideoNChat");
});

test("typing notices name up to two people", () => {
  assert.equal(strings.chat.typing(["Ann"]), "Ann is typing…");
  assert.equal(strings.chat.typing(["Ann", "Ben"]), "Ann and Ben are typing…");
  assert.equal(strings.chat.typing(["Ann", "Ben", "Cat"]), "Several people are typing…");
});

test("every server error code has words", () => {
  for (const code of ["rate-limited", "not-joined", "timeout", "empty-message", "room-full"]) {
    assert.equal(typeof strings.errors[code], "string", code);
  }
});
