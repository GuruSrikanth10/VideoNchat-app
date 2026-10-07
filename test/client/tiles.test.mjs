import { test } from "node:test";
import assert from "node:assert/strict";
import { bestGrid } from "../../public/js/ui/tiles.js";

const WIDE = 16 / 9;

test("one tile fills as much of the stage as its aspect ratio allows", () => {
  const { cols, rows, tileWidth } = bestGrid(1, 1600, 900, WIDE, 0);
  assert.deepEqual({ cols, rows, tileWidth }, { cols: 1, rows: 1, tileWidth: 1600 });
  assert.equal(bestGrid(1, 1600, 450, WIDE, 0).tileWidth, 800); // height-limited
});

test("two people sit side by side on a wide screen and stacked on a tall one", () => {
  assert.equal(bestGrid(2, 1600, 600, WIDE, 0).cols, 2);
  assert.equal(bestGrid(2, 400, 900, 3 / 4, 0).cols, 1);
});

test("larger rooms pick the column count with the biggest tiles", () => {
  assert.deepEqual(
    [3, 4, 5, 6].map((n) => bestGrid(n, 1600, 900, WIDE).cols),
    [2, 2, 3, 3],
  );
});

test("gaps are taken into account", () => {
  const { cols, tileWidth } = bestGrid(2, 1600, 600, WIDE, 20);
  assert.equal(cols, 2);
  assert.equal(tileWidth, 790); // (1600 - 20) / 2
});
