// Run: node --test app/lib/paperStats.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { accruePaperAgg, paperSummary, paperBlotter, tradeNotional, holdHours, EMPTY_PAPER_AGG } from "./paperStats.mjs";

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse("2026-08-27T00:00:00Z");
const mk = (pnl, { reason = "SL", h = 2, at = T0, entry = 100, qty = 0.5, tp_level } = {}) => ({
  symbol: "PERP_BTC_USDC", direction: "SHORT", entry_price: entry, qty, pnl,
  reason, ...(tp_level != null ? { tp_level } : {}),
  opened_at: iso(at), closed_at: iso(at + h * 3600000),
});

test("accruePaperAgg: folds one trade, immutably", () => {
  const a = accruePaperAgg(null, mk(5));
  assert.equal(a.trades, 1); assert.equal(a.wins, 1); assert.equal(a.losses, 0);
  assert.equal(a.grossWin, 5); assert.equal(a.net, 5);
  assert.equal(a.firstTradeAt, T0);
  const before = { ...a };
  accruePaperAgg(a, mk(-2));
  assert.deepEqual(a, before, "input aggregate is never mutated");
});

test("accruePaperAgg: survives the rolling window — lifetime keeps counting past 50", () => {
  let agg = EMPTY_PAPER_AGG;
  for (let i = 0; i < 120; i++) agg = accruePaperAgg(agg, mk(i % 3 === 0 ? 4 : -1, { at: T0 + i * 3600000 }));
  assert.equal(agg.trades, 120, "not capped at the 50-row window");
  assert.equal(agg.firstTradeAt, T0, "lifetime start never slides forward");
  assert.equal(agg.wins + agg.losses, 120);
});

test("accruePaperAgg: zero P&L counts as a loss; malformed rows are ignored", () => {
  assert.equal(accruePaperAgg(null, mk(0)).losses, 1);
  const good = accruePaperAgg(null, mk(3));
  assert.deepEqual(accruePaperAgg(good, { pnl: "abc" }), good, "garbage cannot corrupt an unrebuildable record");
  assert.deepEqual(accruePaperAgg(good, {}), good);
});

test("accruePaperAgg: out-of-order rows keep the EARLIEST start", () => {
  let agg = accruePaperAgg(null, mk(1, { at: T0 + 5 * 86400000 }));
  agg = accruePaperAgg(agg, mk(1, { at: T0 }));
  assert.equal(agg.firstTradeAt, T0);
});

test("paperSummary: shapes the card's summary prop, null when empty", () => {
  assert.equal(paperSummary(null), null);
  assert.equal(paperSummary(EMPTY_PAPER_AGG), null, "no trades ⇒ card falls back to the window");
  let agg = EMPTY_PAPER_AGG;
  agg = accruePaperAgg(agg, mk(10));
  agg = accruePaperAgg(agg, mk(-4));
  agg = accruePaperAgg(agg, mk(-2));
  const s = paperSummary(agg);
  assert.equal(s.trades, 3);
  assert.ok(Math.abs(s.winRate - 33.333) < 0.01);
  assert.equal(s.netPnl, 4);
  assert.equal(s.avgWin, 10);
  assert.equal(s.avgLoss, 3, "avg of |−4| and |−2|");
  assert.equal(s.firstTradeAt, T0);
});

test("tradeNotional / holdHours derive from existing fields (works on OLD rows)", () => {
  assert.equal(tradeNotional(mk(1, { entry: 100, qty: 0.5 })), 50);
  assert.equal(tradeNotional({ entry_price: 0, qty: 1 }), null);
  assert.equal(holdHours(mk(1, { h: 3 })), 3);
  assert.equal(holdHours({}), null);
});

test("paperBlotter: splits how losses vs wins actually END", () => {
  const b = paperBlotter([
    mk(-1, { reason: "SL" }), mk(-1, { reason: "SL" }), mk(-1, { reason: "TIMEOUT" }),
    mk(-1, { reason: "WEBHOOK_CLOSE" }),
    mk(3, { reason: "TP" }), mk(1, { reason: "TP_PARTIAL", tp_level: 1 }), mk(2, { reason: "TP_PARTIAL", tp_level: 2 }),
  ]);
  assert.equal(b.n, 7); assert.equal(b.wins, 3); assert.equal(b.losses, 4);
  const stop = b.lossByExit.find((x) => x.label === "stop");
  assert.equal(stop.n, 2); assert.equal(stop.pct, 50, "half the losses are full stops");
  assert.ok(b.lossByExit.some((x) => x.label === "time"));
  assert.ok(b.lossByExit.some((x) => x.label === "external / flip"), "no invented 'flip' bucket — this is WEBHOOK_CLOSE");
  assert.ok(b.winByExit.some((x) => x.label === "TP1"));
  assert.ok(b.winByExit.some((x) => x.label === "TP2"));
});

test("paperBlotter: avg win/loss scoped to the CURRENT size only", () => {
  const b = paperBlotter([
    mk(5, { entry: 100, qty: 0.5 }),    // $50 notional — in scope
    mk(-2, { entry: 100, qty: 0.5 }),   // $50 — in scope
    mk(400, { entry: 100, qty: 40 }),   // $4000 — an old fat notional, must NOT skew avg$
  ], { currentNotional: 50 });
  assert.equal(b.atSize.n, 2);
  assert.equal(b.atSize.excluded, 1);
  assert.equal(b.atSize.avgWin, 5, "the $4000 winner is excluded");
  assert.equal(b.atSize.avgLoss, 2);
});

test("paperBlotter: empty/garbage in, honest zeros out", () => {
  const b = paperBlotter([], { currentNotional: 50 });
  assert.equal(b.n, 0); assert.equal(b.winRate, 0);
  assert.deepEqual(b.lossByExit, []);
  assert.equal(b.atSize.n, 0);
  assert.equal(paperBlotter(null).n, 0);
});

test("paperBlotter: hold time separates winners from losers", () => {
  const b = paperBlotter([mk(5, { h: 1 }), mk(-5, { h: 4 }), mk(-5, { h: 4 })]);
  assert.equal(b.avgHoldWinH, 1);
  assert.equal(b.avgHoldLossH, 4);
});
