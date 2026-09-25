import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeFills, fillKey, tapeStatus, HL_SERVED_MAX,
  syncTape, compactFill, expandFill, tapeNewest, TAPE_STORE_CAP,
} from "./hlTape.mjs";

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


const range = (from, n) => Array.from({ length: n }, (_, i) => f(from + i, 1000 + from + i));

test("compact/expand round-trips a fill", () => {
  const x = { tid: 7, time: 5, coin: "xyz:NVDA", px: "180", sz: "2", side: "B", dir: "Close Short", closedPnl: "3.1", fee: "0.02" };
  assert.deepEqual(expandFill(compactFill(x)), x);
  const noTid = { ...x }; delete noTid.tid;
  assert.deepEqual(expandFill(compactFill(noTid)), noTid);
});

test("seed: under HL's cap → complete from the first fill (completeFrom null)", () => {
  const { record, added, gap } = syncTape(null, [range(0, 50)], { now: 1 });
  assert.equal(record.fills.length, 50);
  assert.equal(record.completeFrom, null);
  assert.equal(added, 50);
  assert.equal(gap, false);
  assert.equal(record.seededAt, 1);
});

test("seed: at HL's cap → complete only from the oldest fill held", () => {
  const { record } = syncTape(null, [range(0, HL_SERVED_MAX)]);
  assert.equal(record.completeFrom, 1000);
});

test("incremental sync appends new fills; overlap proves continuity", () => {
  const seed = syncTape(null, [range(0, HL_SERVED_MAX)], { now: 1 }).record;
  // forward page from the newest stored fill (inclusive) + 30 new
  const page = range(HL_SERVED_MAX - 1, 31);
  const { record, added, gap } = syncTape(seed, [page], { now: 2 });
  assert.equal(added, 30);
  assert.equal(gap, false);
  assert.equal(record.completeFrom, 1000, "continuity kept — completeFrom unchanged");
  assert.equal(record.seededAt, 1);
  assert.equal(record.syncedAt, 2);
  assert.equal(tapeNewest(record), 1000 + HL_SERVED_MAX + 29);
});

test("the stored tape outgrows HL's 10k window — that's the point", () => {
  let rec = syncTape(null, [range(0, HL_SERVED_MAX)]).record;
  rec = syncTape(rec, [range(HL_SERVED_MAX - 1, 5001)]).record;
  assert.equal(rec.fills.length, HL_SERVED_MAX + 5000);
});

test("no overlap ⇒ gap: completeFrom moves to the oldest fresh fill", () => {
  const seed = syncTape(null, [range(0, 100)]).record;        // complete (null)
  const later = range(20_000, HL_SERVED_MAX);                   // HL moved past our newest
  const { record, gap } = syncTape(seed, [later]);
  assert.equal(gap, true);
  assert.equal(record.completeFrom, 1000 + 20_000);
  assert.equal(record.fills.length, 100 + HL_SERVED_MAX, "old fills kept, flagged partial");
});

test("an empty fresh read is not a gap and changes nothing", () => {
  const seed = syncTape(null, [range(0, 10)]).record;
  const { record, added, gap } = syncTape(seed, [[]]);
  assert.equal(gap, false);
  assert.equal(added, 0);
  assert.equal(record.completeFrom, null);
});

test("store cap keeps the newest and marks the tape partial from there", () => {
  const { record } = syncTape(null, [range(0, 120)], { cap: 100 });
  assert.equal(record.fills.length, 100);
  assert.equal(record.completeFrom, 1020);
  assert.ok(TAPE_STORE_CAP >= HL_SERVED_MAX * 5);
});
