// Smart Money's live feed rows (app/lib/smartFeed.mjs). Run: node --test app/lib/smartFeed.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feedRows, FEED_MIN_USD, FEED_FIRST, FEED_MAX } from "./smartFeed.mjs";

const ev = (szUsd, i = 0) => ({ addr: `0x${i}`, sym: "ETH", side: "LONG", type: "OPEN", szUsd, ts: 1000 - i });

test("dust is folded by default, counted, and back with one toggle", () => {
  const events = [ev(55_000, 1), ev(15, 2), ev(1_000, 3), ev(999.99, 4), ev(-12_000, 5)];
  const f = feedRows(events);
  assert.deepEqual(f.rows.map((e) => e.addr), ["0x1", "0x3", "0x5"]); // order kept; $1,000 exactly stays; a negative size is a size
  assert.equal(f.small, 2);
  const all = feedRows(events, { showSmall: true });
  assert.equal(all.rows.length, 5);
  assert.equal(all.small, 0);
  assert.equal(FEED_MIN_USD, 1000);
});

test("a missing or broken size counts as small, never a crash", () => {
  const f = feedRows([ev(undefined, 1), ev(NaN, 2), null, ev(5_000, 3)]);
  assert.deepEqual(f.rows.map((e) => e.addr), ["0x3"]);
  assert.equal(f.small, 2);
  assert.deepEqual(feedRows(null), { rows: [], small: 0, more: 0 });
});

test("first FEED_FIRST rows, 'show more' up to FEED_MAX", () => {
  const events = Array.from({ length: 40 }, (_, i) => ev(2_000, i));
  const f = feedRows(events);
  assert.equal(f.rows.length, FEED_FIRST);
  assert.equal(f.more, FEED_MAX - FEED_FIRST);
  const all = feedRows(events, { all: true });
  assert.equal(all.rows.length, FEED_MAX);
  assert.equal(all.more, 0);
});

test("the Smart Money tab renders the feed through feedRows", () => {
  const src = readFileSync(new URL("../pages/lab/SmartMoneyView.tsx", import.meta.url), "utf8");
  assert.match(src, /feedRows\(/);
  assert.doesNotMatch(src, /events\.slice\(0, feedAll/);
});
