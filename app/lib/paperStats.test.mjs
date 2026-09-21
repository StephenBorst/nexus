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

test("paperBlotter: NO trades at current size ⇒ nulls, never a fabricated $0.00", () => {
  // The live case: every retained row is a ~$130k notional, current size is $250.
  const fat = Array.from({ length: 6 }, (_, i) => mk(i % 2 ? 900 : -700, { entry: 100, qty: 1300 }));
  const b = paperBlotter(fat, { currentNotional: 250 });
  assert.equal(b.atSize.n, 0);
  assert.equal(b.atSize.excluded, 6);
  assert.equal(b.atSize.avgWin, null, "mean([]) would be 0 and read as a real measurement");
  assert.equal(b.atSize.avgLoss, null);
  assert.equal(b.staleWindow, true, "the window describes a configuration that no longer exists");
  assert.ok(b.sizeDrift.ratio > 100);
});

test("paperBlotter: window is NOT flagged stale when sizes match current", () => {
  const b = paperBlotter([mk(5, { entry: 100, qty: 2.5 }), mk(-2, { entry: 100, qty: 2.5 })], { currentNotional: 250 });
  assert.equal(b.staleWindow, false);
  assert.equal(b.atSize.n, 2);
  assert.equal(b.atSize.avgWin, 5);
});

test("paperBlotter: flags profit-labelled exits that closed RED", () => {
  const b = paperBlotter([
    mk(-3, { reason: "TP" }),                          // TP full close, red
    mk(-1, { reason: "TP_PARTIAL", tp_level: 1 }),     // ladder slice, red
    mk(4, { reason: "TP" }),                           // healthy
    mk(-9, { reason: "SL" }),                          // a stop being red is normal
  ]);
  assert.equal(b.anomalies.n, 2, "only the profit-labelled reds count");
  assert.equal(Number(b.anomalies.worst.pnl), -3, "worst offender surfaced for inspection");
  const labels = b.anomalies.byExit.map((x) => x.label);
  assert.ok(labels.includes("take-profit"), "TP full-close bucket → fill diverged from the trigger price");
  assert.ok(labels.includes("TP1"), "TP1 bucket → ladder/remainder path");
});

test("paperBlotter: no anomalies when profit exits are green", () => {
  const b = paperBlotter([mk(4, { reason: "TP" }), mk(-9, { reason: "SL" }), mk(0, { reason: "BE" })]);
  assert.equal(b.anomalies.n, 0);
  assert.equal(b.anomalies.worst, null);
});

test("paperBlotter: over-hold separates a broken TIMEOUT from stale rows", () => {
  const b = paperBlotter([mk(1, { h: 12 }), mk(1, { h: 11 }), mk(1, { h: 2 })], { maxHoldHours: 4 });
  assert.equal(b.overHold.cap, 4);
  assert.equal(b.overHold.n, 2, "two rows outlived the current cap");
  assert.equal(b.overHold.maxH, 12);
  assert.equal(paperBlotter([mk(1, { h: 12 })]).overHold, null, "no cap supplied ⇒ no claim made");
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
  assert.equal(b.atSize.avgWin, null);
  assert.equal(paperBlotter(null).n, 0);
});

test("paperBlotter: hold time separates winners from losers", () => {
  const b = paperBlotter([mk(5, { h: 1 }), mk(-5, { h: 4 }), mk(-5, { h: 4 })]);
  assert.equal(b.avgHoldWinH, 1);
  assert.equal(b.avgHoldLossH, 4);
});

// ── FRESH WALLET — nothing saved anywhere ───────────────────────────────────
// Repro that motivated these: connect a brand-new address → Lab → Trading Agent.
// GET /agent/:addr returns {config:null, state:null, trades:[], pending:[]}, so every
// stat path sees undefined/empty. A single unguarded .length here takes down the whole
// Lab route (react-router errorElement), not just the card.
test("fresh wallet: no paper_agg ⇒ null summary, card falls back to the window", () => {
  assert.equal(paperSummary(undefined), null);
  assert.equal(paperSummary(null), null);
  assert.equal(paperSummary({}), null, "an empty agg is not a record");
});

test("fresh wallet: a PARTIAL paper_agg never yields NaN in a stat tile", () => {
  // e.g. written by an older exec build, or a half-written object.
  const s = paperSummary({ trades: 3 });
  assert.equal(s.trades, 3);
  assert.equal(s.winRate, 0);
  assert.equal(s.netPnl, 0);
  assert.equal(s.avgWin, 0);
  assert.equal(s.avgLoss, 0);
  assert.equal(s.firstTradeAt, undefined);
  for (const v of Object.values(s)) assert.ok(v === undefined || Number.isFinite(v), "no NaN reaches the UI");
});

test("fresh wallet: garbage field types are coerced, not propagated", () => {
  const s = paperSummary({ trades: 2, wins: "1", net: "abc", grossWin: null, losses: 1, grossLoss: undefined });
  assert.equal(s.winRate, 50, "numeric strings still count");
  assert.equal(s.netPnl, 0, "non-numeric net becomes 0, never NaN");
  assert.equal(s.avgWin, 0);
  assert.equal(s.avgLoss, 0);
});

test("fresh wallet: blotter over no trades at all", () => {
  for (const empty of [[], null, undefined]) {
    const b = paperBlotter(empty, { currentNotional: 250, maxHoldHours: 4 });
    assert.equal(b.n, 0);
    assert.equal(b.wins, 0);
    assert.equal(b.losses, 0);
    assert.deepEqual(b.lossByExit, []);
    assert.deepEqual(b.winByExit, []);
    assert.equal(b.anomalies.n, 0);
    assert.equal(b.staleWindow, false, "no rows ⇒ nothing to call stale");
    assert.equal(b.sizeDrift, null);
    assert.equal(b.overHold.n, 0);
    assert.ok(Number.isFinite(b.avgHoldWinH) && Number.isFinite(b.avgHoldLossH));
  }
});

test("fresh wallet: accrual starts clean from nothing", () => {
  const agg = accruePaperAgg(undefined, { pnl: 2, opened_at: iso(T0), closed_at: iso(T0 + 3600000) });
  assert.equal(agg.trades, 1);
  assert.equal(paperSummary(agg).trades, 1);
});
