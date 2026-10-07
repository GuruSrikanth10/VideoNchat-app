import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFileName, formatSize, MAX_FILE_SIZE } from "../../public/js/lib/file-share.js";

test("file names lose paths and control characters", () => {
  assert.equal(cleanFileName("report.pdf"), "report.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(cleanFileName("C:\\\\Users\\\\me\\\\notes.txt"), "C:_Users_me_notes.txt");
  assert.equal(cleanFileName("bad\u0000name\n.txt"), "bad_name_.txt");
  assert.equal(cleanFileName("   "), "file");
  assert.equal(cleanFileName(undefined), "file");
  assert.equal(cleanFileName(`${"a".repeat(300)}.txt`).length, 200);
  assert.ok(cleanFileName(`${"a".repeat(300)}.txt`).endsWith(".txt"), "keeps the extension");
});

test("sizes read naturally", () => {
  assert.equal(formatSize(820_000, "en"), "820 kB");
  assert.equal(formatSize(4_200_000, "en"), "4.2 MB");
  assert.equal(formatSize(12, "en"), "0.1 kB");
  assert.equal(formatSize(MAX_FILE_SIZE, "en"), "50 MB");
});
