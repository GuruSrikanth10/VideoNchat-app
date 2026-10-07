import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../../public/js/lib/duration.js";

test("short calls are counted in seconds", () => {
  assert.equal(formatDuration(0, "en"), "0 seconds");
  assert.equal(formatDuration(1, "en"), "1 second");
  assert.equal(formatDuration(59.4, "en"), "59 seconds");
});

test("longer calls in minutes, then hours and minutes", () => {
  assert.equal(formatDuration(60, "en"), "1 minute");
  assert.equal(formatDuration(12 * 60 + 30, "en"), "12 minutes");
  assert.equal(formatDuration(3600, "en"), "1 hour");
  assert.equal(formatDuration(3600 + 5 * 60, "en"), "1 hour, 5 minutes");
  assert.equal(formatDuration(2 * 3600 + 60, "en"), "2 hours, 1 minute");
});

test("other languages get their own wording", () => {
  assert.equal(formatDuration(120, "de"), "2 Minuten");
});

test("nonsense is never negative", () => {
  assert.equal(formatDuration(-5, "en"), "0 seconds");
});
