import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFills, fillKey, tapeStatus, HL_SERVED_MAX } from "./hlTape.mjs";

const f = (tid, time, extra = {}) => ({ tid, time, coin: "BTC", px: "1", sz: "1", side: "B", dir: "Open Long", ...extra });

test("merge keeps every fill from every slice — never replaces one slice with another", () => {
  // The old bug: 10k paged fills were DISCARDED for the ~2k newest when fills arrived mid-read.
  const paged = Array.from({ length: 10 }, (_, i) => f(i, 1000 + i));
  const recent = [f(8, 1008), f(9, 1009), f(10, 1010), f(11, 1011)];
  const out = mergeFills(paged, recent);
  assert.equal(out.length, 12);
  assert.deepEqual(out.map((x) => x.tid), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("merge dedupes by tid and sorts oldest → newest", () => {
  const out = mergeFills([f(3, 30), f(1, 10)], [f(2, 20), f(1, 10)]);
  assert.deepEqual(out.map((x) => x.tid), [1, 2, 3]);
});

test("same-millisecond fills with different tids both survive (HFT page boundary)", () => {
  assert.equal(mergeFills([f(1, 5)], [f(2, 5)]).length, 2);
});

test("fills without a tid fall back to their own fields", () => {
  const a = { time: 5, coin: "ETH", px: "2", sz: "1", side: "A", dir: "Close Long" };
  assert.equal(mergeFills([a], [{ ...a }]).length, 1);
  assert.equal(mergeFills([a], [{ ...a, px: "3" }]).length, 2);
  assert.match(fillKey(a), /^f:/);
});

test("merge ignores junk rows and non-array inputs", () => {
  assert.deepEqual(mergeFills(null, undefined, [null, { tid: 1 }], [f(2, 2)]).map((x) => x.tid), [2]);
});

test("tapeStatus: partial exactly at HL's serving cap", () => {
  const under = Array.from({ length: 9_999 }, (_, i) => f(i, i + 1));
  assert.equal(tapeStatus(under).truncated, false);
  const at = Array.from({ length: HL_SERVED_MAX }, (_, i) => f(i, i + 1));
  const s = tapeStatus(at);
  assert.equal(s.truncated, true);
  assert.equal(s.fills, HL_SERVED_MAX);
  assert.equal(s.oldestTs, 1);
  assert.equal(s.newestTs, HL_SERVED_MAX);
  assert.deepEqual(tapeStatus([]), { fills: 0, truncated: false, oldestTs: null, newestTs: null });
});
