// app/lib/watchlist.mjs. Run: node --test app/lib/watchlist.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseWatch, toggleWatch, markSeen, watchRow, WATCH_MAX } from "./watchlist.mjs";

const snap = (o = {}) => ({ stretched: false, fundAnnual: 9, smartSide: "NONE", smartL: 5, smartS: 6, fcId: "m1", fcYes: 40, fcQ: "Will ETH dip to $1,750?", ...o });

test("a stored list is cleaned: real tickers, unique, capped; junk reads as empty", () => {
  assert.deepEqual(parseWatch('{"coins":["eth","PERP_BTC_USDC","eth","../x"]}').coins, ["ETH", "BTC"]);
  assert.deepEqual(parseWatch("not json"), { coins: [], seen: {} });
  assert.deepEqual(parseWatch(null), { coins: [], seen: {} });
});

test("watch adds newest first, unwatch forgets the last look, the cap refuses an 11th", () => {
  let s = toggleWatch({ coins: [] }, "eth").state;
  s = toggleWatch(s, "BTC").state;
  assert.deepEqual(s.coins, ["BTC", "ETH"]);
  s = markSeen(s, "ETH", { price: 1800, snap: snap() }, 1);
  const off = toggleWatch(s, "ETH");
  assert.equal(off.on, false);
  assert.ok(!("ETH" in off.state.seen));
  const full = { coins: Array.from({ length: WATCH_MAX }, (_, i) => `C${i}`), seen: {} };
  assert.equal(toggleWatch(full, "ZZ").full, true);
});

test("first look: no changes, just watching from now", () => {
  const r = watchRow("ETH", { price: 1800, change24hPct: -6.2, snap: snap() }, undefined);
  assert.equal(r.first, true);
  assert.deepEqual(r.changes, []);
  assert.equal(r.sincePct, null);
});

test("since the last look: the price move and each change in plain words, the coin name dropped", () => {
  const seen = { snap: { ...snap(), fcBase: 40 }, price: 1800, at: 1000 };
  const r = watchRow("ETH", { price: 1854, change24hPct: 1, snap: snap({ stretched: true, fundAnnual: 21, smartSide: "SHORT", smartL: 2, smartS: 9, fcYes: 58 }) }, seen);
  assert.equal(Math.round(r.sincePct * 10) / 10, 3);
  assert.deepEqual(r.changes, [
    "funding stretched past its own range (longs pay 21.0%/yr). The fade is a mechanical rule, not graded.",
    "tracked traders now agree short (9 short · 2 long). Context, not a graded read.",
    "forecast up 18 pts to 58% YES. \"Will ETH dip to $1,750?\"",
  ]);
  for (const c of r.changes) assert.doesNotMatch(c, /edge|proven|buy now|sell now/i);
});

test("an unread board changes nothing; marking seen moves the baseline", () => {
  const seen = { snap: { ...snap(), fcBase: 40 }, price: 1800, at: 1000 };
  const unread = snap({ stretched: null, smartSide: null, fcId: null, fcYes: null });
  assert.deepEqual(watchRow("ETH", { price: 1800, snap: unread }, seen).changes, []);
  let s = { coins: ["ETH"], seen: { ETH: seen } };
  s = markSeen(s, "ETH", { price: 1854, snap: snap({ stretched: true }) }, 2000);
  assert.equal(s.seen.ETH.price, 1854);
  assert.equal(s.seen.ETH.at, 2000);
  assert.deepEqual(watchRow("ETH", { price: 1854, snap: snap({ stretched: true }) }, s.seen.ETH).changes, []);
  assert.equal(watchRow("ETH", null, s.seen.ETH).unread, true);
});
