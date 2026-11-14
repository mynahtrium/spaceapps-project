import test from "node:test";
import assert from "node:assert/strict";

import { clampMenuPosition, normalizeItems, wantsNativeMenu } from "../shared/context-menu.js";

test("normalizeItems drops hidden items and stray separators/headings", () => {
  const out = normalizeItems([
    { separator: true },
    { heading: "A" },
    { label: "one" },
    { label: "gone", hidden: true },
    { separator: true },
    { separator: true },
    { heading: "B" },
    { label: "two" },
    { separator: true },
    { heading: "EMPTY" },
  ]);
  assert.deepEqual(
    out.map((i) => i.label || i.heading || "|"),
    ["A", "one", "B", "two"]
  );
});

test("clampMenuPosition keeps the menu on screen", () => {
  assert.deepEqual(clampMenuPosition(10, 10, 200, 100, 800, 600), { left: 10, top: 10 });
  // Flips left near the right edge, slides up near the bottom.
  assert.deepEqual(clampMenuPosition(750, 580, 200, 100, 800, 600), { left: 550, top: 492 });
});

test("wantsNativeMenu keeps the browser menu for text fields, selections and Shift", () => {
  const fakeEl = (matches) => ({ closest: () => (matches ? {} : null) });
  assert.equal(wantsNativeMenu(fakeEl(true)), true);
  assert.equal(wantsNativeMenu(fakeEl(false)), false);
  assert.equal(wantsNativeMenu(fakeEl(false), { shiftKey: true }), true);
  assert.equal(wantsNativeMenu(fakeEl(false), { selectionText: "abc" }), true);
  assert.equal(wantsNativeMenu(null), false);
});
