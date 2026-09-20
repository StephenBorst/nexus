// Tests for the strategy backtest engine — the OI wire specifically.
// Orderly ships price OHLC + funding history but NO OI history, so CONFLUENCE / OI_ONLY
// are only backtestable off the brain's recorded oi:hist series. This proves that wire:
// the OI-change lookup is causal (no lookahead), and CONFLUENCE fires ONLY when recorded
// OI is present — with no OI it abstains rather than fabricating divergence. Same rigor
// the scoreboard (axisbt.test) holds its reads to.
// Run: node --test workers/nexus-lab-api/backtest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { makeOiChangeAt, oiSeriesInfo, runBacktest, robustnessVerdict, aggregate } from "./backtest.mjs";

const HR_MS = 3600 * 1000;
const DAY_MS = 86400 * 1000;
const BASE_MS = 1_700_000_000_000; // fixed epoch (ms) so tests are deterministic
const secAfter = (tMs) => Math.floor(tMs / 1000) + 1; // a tsSec strictly just after a row's ms stamp

// ── makeOiChangeAt — the NO-LOOKAHEAD fractional OI-change lookup ──────────────
test("makeOiChangeAt: fractional delta from the previous recorded sample", () => {
  const rows = [
    { t: BASE_MS, oi: 1000 },
    { t: BASE_MS + HR_MS, oi: 1020 },       // +2.0% vs prev
    { t: BASE_MS + 2 * HR_MS, oi: 990 },    // -2.94% vs prev
  ];
  const at = makeOiChangeAt(rows);
  assert.ok(Math.abs(at(secAfter(BASE_MS + HR_MS)) - 0.02) < 1e-9, "hour1 delta = +2%");
  assert.ok(Math.abs(at(secAfter(BASE_MS + 2 * HR_MS)) - ((990 - 1020) / 1020)) < 1e-9, "hour2 delta from 1020→990");
});

test("makeOiChangeAt: causal — never peeks at a future sample", () => {
  const rows = [
    { t: BASE_MS, oi: 1000 },
    { t: BASE_MS + HR_MS, oi: 1020 },
    { t: BASE_MS + 2 * HR_MS, oi: 500 }, // a big FUTURE move that must NOT leak backward
  ];
  const at = makeOiChangeAt(rows);
  // A cutoff between hour1 and hour2 sees only {h0,h1} → the +2% delta, not the -50% future.
  assert.ok(Math.abs(at(secAfter(BASE_MS + HR_MS)) - 0.02) < 1e-9);
});

test("makeOiChangeAt: null until two samples exist at/before t", () => {
  const rows = [{ t: BASE_MS, oi: 1000 }, { t: BASE_MS + HR_MS, oi: 1020 }];
  const at = makeOiChangeAt(rows);
  assert.equal(at(secAfter(BASE_MS)), null, "only one sample ≤ t → no delta");
  assert.equal(at(Math.floor(BASE_MS / 1000) - 10), null, "before any sample → null");
});

test("makeOiChangeAt: ignores non-positive / non-finite OI rows", () => {
  const rows = [
    { t: BASE_MS, oi: 1000 },
    { t: BASE_MS + HR_MS, oi: 0 },        // dropped
    { t: BASE_MS + 2 * HR_MS, oi: NaN },  // dropped
    { t: BASE_MS + 3 * HR_MS, oi: 1010 }, // pairs with the 1000 row → +1%
  ];
  const at = makeOiChangeAt(rows);
  assert.ok(Math.abs(at(secAfter(BASE_MS + 3 * HR_MS)) - 0.01) < 1e-9);
});

// ── oiSeriesInfo — the coverage summary the maturity gate reads ────────────────
test("oiSeriesInfo: samples + span in days, filtering bad OI", () => {
  const rows = [
    { t: BASE_MS, oi: 1000 },
    { t: BASE_MS + 15 * DAY_MS, oi: 1100 },
  ];
  assert.deepEqual(oiSeriesInfo(rows), { samples: 2, days: 15 });
  assert.deepEqual(oiSeriesInfo([{ t: BASE_MS, oi: 1000 }]), { samples: 1, days: 0 }, "<2 → days 0");
  assert.deepEqual(oiSeriesInfo([]), { samples: 0, days: 0 });
  const withJunk = [{ t: BASE_MS, oi: 0 }, { t: BASE_MS + DAY_MS, oi: 900 }, { t: BASE_MS + 2 * DAY_MS, oi: 910 }];
  assert.equal(oiSeriesInfo(withJunk).samples, 2, "oi<=0 row excluded from the count");
});

// ── runBacktest — the wire: CONFLUENCE is testable ONLY with recorded OI ───────
// Rising price + positive funding (crowd long) + FALLING OI ⇒ funding says SHORT and
// OI-divergence says SHORT ⇒ CONFLUENCE agrees. That confluence can only be evaluated
// when a recorded oiChange is fed in; with none, CONFLUENCE must abstain (0 trades) —
// the engine never fabricates divergence off missing data.
const risingCandles = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + i * 0.5; // steadily rising close
  return { t: Math.floor(BASE_MS / 1000) + i * 3600, o: c, h: c * 1.006, l: c * 0.999, c };
});
const CONFLUENCE_CFG = { signalMode: "CONFLUENCE", fundingThreshold: 0.01, oiChangeThreshold: 0, tpPercent: 1.5, slPercent: 0.75, maxHoldHours: 4, leverage: 5, capitalPerTrade: 50 };
const fundingShort = () => 0.0002; // ≥ 0.0001 (0.01%) ⇒ fundingSignal SHORT

test("runBacktest: CONFLUENCE fires WITH recorded OI (funding + OI both SHORT)", () => {
  const candles = risingCandles(48);
  const oiDown = makeOiChangeAt(candles.map((c, i) => ({ t: c.t * 1000, oi: 1000 - i }))); // OI declining each bar
  const res = runBacktest(candles, fundingShort, CONFLUENCE_CFG, null, oiDown);
  assert.ok(res.trades >= 1, "CONFLUENCE produces trades once real OI divergence is supplied");
  assert.ok(res._trades.every((t) => t.direction === "SHORT"), "every confluence entry is the SHORT fade");
});

test("runBacktest: CONFLUENCE is INERT without recorded OI (no fabricated divergence)", () => {
  const candles = risingCandles(48);
  const res = runBacktest(candles, fundingShort, CONFLUENCE_CFG, null, null); // oiChangeAt omitted
  assert.equal(res.trades, 0, "no OI history ⇒ OI rule can't agree ⇒ CONFLUENCE never fires");
});

test("runBacktest: FUNDING_ONLY still fires without OI (the wire is CONFLUENCE-specific)", () => {
  const candles = risingCandles(48);
  const res = runBacktest(candles, fundingShort, { ...CONFLUENCE_CFG, signalMode: "FUNDING_ONLY" }, null, null);
  assert.ok(res.trades >= 1, "funding-only needs no OI — proves the abstention above is OI-specific, not a break");
});

// ── robustnessVerdict — the cross-market × cross-time gate ─────────────────────
test("robustnessVerdict: ROBUST / FRAGILE / NOT_ROBUST thresholds", () => {
  assert.equal(robustnessVerdict(4, 6, 60), "ROBUST", "majority of markets + ≥55% folds");
  assert.equal(robustnessVerdict(3, 6, 55), "ROBUST", "exactly at the ceil(total/2)=3 + 55% boundary");
  assert.equal(robustnessVerdict(2, 6, 45), "FRAGILE", "≥2 markets + ≥45% folds, below robust");
  assert.equal(robustnessVerdict(1, 6, 90), "NOT_ROBUST", "one market can't be robust");
  assert.equal(robustnessVerdict(4, 6, 40), "NOT_ROBUST", "fold consistency too low");
});

// ── aggregate — fees are a real drag (results are honest by default) ───────────
test("aggregate: taker fees reduce net vs a zero-fee run", () => {
  const trades = [{ pnlPct: 1 }, { pnlPct: 1 }, { pnlPct: -0.5 }];
  const gross = aggregate(trades, { capitalPerTrade: 50, leverage: 5, feeBps: 0 });
  const net = aggregate(trades, { capitalPerTrade: 50, leverage: 5, feeBps: 3 });
  assert.ok(net.netUsd < gross.netUsd, "fees only ever cut into net");
  assert.equal(gross.trades, 3);
});
