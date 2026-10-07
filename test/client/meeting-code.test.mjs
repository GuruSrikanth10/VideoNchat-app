import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeetingCode } from "../../public/js/lib/meeting-code.js";

const ORIGIN = "https://meet.example.com";

test("plain codes are accepted as they are", () => {
  assert.equal(parseMeetingCode("  team-standup ", ORIGIN), "team-standup");
  assert.equal(
    parseMeetingCode("3f2504e0-4f89-41d3-9a0c-0305e82c3301", ORIGIN),
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  );
});

test("links from this site give their code", () => {
  assert.equal(parseMeetingCode(`${ORIGIN}/team-standup`, ORIGIN), "team-standup");
  assert.equal(parseMeetingCode(`${ORIGIN}/team-standup/?x=1#y`, ORIGIN), "team-standup");
});

test("anything else is rejected", () => {
  for (const input of [
    "",
    "   ",
    "has spaces",
    "a/b",
    "https://evil.example/team",
    "x".repeat(65),
  ]) {
    assert.equal(parseMeetingCode(input, ORIGIN), null, input);
  }
});
