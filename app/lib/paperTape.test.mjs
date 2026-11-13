// Run: node --test app/lib/paperTape.test.mjs
// Paper fills checked against the public 1-minute tape (paperTape.mjs). Hand-built bars; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { judgeFill, judgeTrigger, exitLevel, legsOf, openLeg, walletLegs, tapeSummary, tapeLine, addSummaries, entryKey, exitKey, exitKeyOf, TAPE_TOL_BPS } from "./paperTape.mjs";

const M = 60;
const T = Date.UTC(2026, 10, 13, 12, 30);              // 12:30:00Z (ms)
const m = T / 1000;                                     // that minute's bar time (sec)
const bar = (t, h, l) => [t, (h + l) / 2, h, l, (h + l) / 2];

test("a fill inside its minute's traded range is ON_TAPE", () => {
  const g = judgeFill(100, T + 20_000, [bar(m - M, 99.6, 99.2), bar(m, 100.4, 99.8), bar(m + M, 101, 100.5)]);
  assert.deepEqual([g.verdict, g.bps, g.bar[0]], ["ON_TAPE", 0, m]);
});

test("the minute before counts: a price read at :59 can be stamped at :00", () => {
  const g = judgeFill(99.4, T + 1_000, [bar(m - M, 99.6, 99.2), bar(m, 100.4, 99.8)]);
  assert.deepEqual([g.verdict, g.bar[0]], ["ON_TAPE", m - M]);
});

test("the mark a hair past the trades is NEAR, with its distance; further out is OFF", () => {
  const bars = [bar(m, 100, 99)];
  const near = judgeFill(100.05, T, bars);              // 5 bps over the high
  assert.deepEqual([near.verdict, near.bps], ["NEAR", 5]);
  const edge = judgeFill(100 * (1 + TAPE_TOL_BPS / 10_000), T, bars);
  assert.equal(edge.verdict, "NEAR", "the tolerance is inclusive");
  const off = judgeFill(101, T, bars);                  // ~99 bps over
  assert.equal(off.verdict, "OFF");
  assert.ok(off.bps > 90 && off.bps < 100);
  assert.equal(judgeFill(98, T, bars).verdict, "OFF", "below the low too");
});

test("no bar in either minute = NO_TRADES, never a pass", () => {
  assert.deepEqual(judgeFill(100, T, [bar(m - 5 * M, 101, 99)]), { verdict: "NO_TRADES" });
  assert.deepEqual(judgeFill(100, T, []), { verdict: "NO_TRADES" });
});

const row = (over = {}) => ({ id: "paper_1", symbol: "PERP_ETH_USDC", direction: "LONG", entry_price: 100, exit_price: 103,
  opened_at: new Date(T).toISOString(), closed_at: new Date(T + 3_600_000).toISOString(), reason: "TP", ...over });

test("a closed row asks for its entry and its exit; a DCA average entry is labelled, not judged", () => {
  const legs = legsOf(row());
  assert.deepEqual(legs.map((l) => [l.key, l.kind, l.px]), [[entryKey("PERP_ETH_USDC", T), "entry", 100], [exitKey("paper_1"), "exit", 103]]);
  assert.equal(legsOf(row({ entry_avg: true }))[0].averaged, true);
  assert.deepEqual(legsOf({ symbol: "X" }), [], "nothing to check");
});

test("an open paper position's entry shares the key its closed rows will use; live positions are skipped", () => {
  const pos = { symbol: "PERP_ETH_USDC", paper: true, entry_price: 100, opened_at: T };
  assert.equal(openLeg(pos).key, legsOf(row())[0].key);
  assert.equal(openLeg({ ...pos, paper: false }), null);
  assert.equal(openLeg({ ...pos, dca: {}, base_entry_price: 98 }).px, 98, "a DCA position's first fill is its base entry");
});

test("a wallet's fills: one per key (TP slices share an entry), newest first", () => {
  const state = {
    current_position: { symbol: "PERP_SOL_USDC", paper: true, entry_price: 150, opened_at: T + 7_200_000 },
    paper_trades: [row({ id: "paper_3", reason: "TP" }), row({ id: "paper_2", reason: "TP_PARTIAL", exit_price: 102 })],
  };
  const legs = walletLegs(state);
  assert.equal(legs.length, 4, "SOL entry, one shared ETH entry, two exits");
  assert.equal(legs[0].symbol, "PERP_SOL_USDC");
  assert.ok(legs.every((l, i) => i === 0 || legs[i - 1].t >= l.t));
});

test("the summary counts every fill, unchecked ones as pending, and reads in plain words", () => {
  const legs = walletLegs({ paper_trades: [row({ id: "a" }), row({ id: "b", opened_at: new Date(T + 1).toISOString(), entry_avg: true })] });
  const checks = { [legs.find((l) => l.kind === "exit" && l.key === exitKey("a")).key]: { verdict: "ON_TAPE" },
    [entryKey("PERP_ETH_USDC", T)]: { verdict: "NEAR", bps: 4 } };
  const s = tapeSummary(legs, checks);
  assert.deepEqual([s.fills, s.judged, s.onTape, s.near, s.off, s.averaged, s.pending], [4, 2, 1, 1, 0, 1, 1]);
  assert.equal(tapeLine(s), "1 of 2 paper fills traded inside Orderly’s public 1-minute range · 1 within 0.1% · 0 off");
  assert.equal(tapeLine(tapeSummary([], {})), null, "nothing judged = no claim");
  assert.deepEqual(addSummaries(s, s).fills, 8);
  assert.equal(addSummaries(null, s), s);
});

test("a row without an id is still checked, keyed by its market and close time", () => {
  const legs = legsOf(row({ id: undefined }));
  assert.equal(legs.length, 2);
  assert.equal(legs[1].key, `x:PERP_ETH_USDC:${T + 3_600_000}`);
});

// ── trigger check: did the tape trade at the exit's level? ─────────────────────
test("a stop or target exit's level comes from its own row; other exits have none", () => {
  assert.deepEqual(exitLevel(row({ reason: "SL", sl_percent: 2 })), { side: "STOP", long: true, px: 98 });
  assert.deepEqual(exitLevel(row({ reason: "SL", sl_percent: 2, direction: "SHORT" })), { side: "STOP", long: false, px: 102 });
  assert.deepEqual(exitLevel(row({ reason: "TP", tp_percent: 3 })), { side: "TARGET", long: true, px: 103 });
  assert.equal(exitLevel(row({ reason: "TP" })), null, "no tp_percent on the row: not judged");
  assert.equal(exitLevel(row({ reason: "TRAIL", sl_percent: 2 })), null);
  assert.equal(exitLevel(row({ reason: "SL", sl_percent: 2, entry_avg: true })), null, "a DCA average has no single level");
  assert.ok(legsOf(row({ reason: "SL", sl_percent: 2 }))[1].level);
});

test("TRADED when a bar in the exit's span reached the level; MARK_ONLY with the gap when none did", () => {
  const stop = { side: "STOP", long: true, px: 98 };
  const span = [bar(m - 2 * M, 99, 98.5), bar(m - M, 98.6, 97.9), bar(m, 98.4, 98.1)];
  assert.deepEqual(judgeTrigger(stop, T, span), { verdict: "TRADED", level: 98 });
  const wick = [bar(m - 2 * M, 99, 98.5), bar(m - M, 98.6, 98.2), bar(m, 98.4, 98.1)];
  const g = judgeTrigger(stop, T, wick);
  assert.equal(g.verdict, "MARK_ONLY", "the mark crossed 98, the trades bottomed at 98.1");
  assert.equal(g.bps, 10.2);
  assert.equal(judgeTrigger(stop, T, [bar(m - 3 * M, 97, 96), bar(m + M, 97, 96)]).verdict, "NO_TRADES", "only bars inside the span count");
  // A short's stop is above; a long's target is above; a short's target is below.
  assert.equal(judgeTrigger({ side: "STOP", long: false, px: 102 }, T, [bar(m, 102, 101)]).verdict, "TRADED");
  assert.equal(judgeTrigger({ side: "TARGET", long: true, px: 103 }, T, [bar(m, 102.9, 101)]).verdict, "MARK_ONLY");
  assert.equal(judgeTrigger({ side: "TARGET", long: false, px: 97 }, T, [bar(m, 98, 96.9)]).verdict, "TRADED");
});

test("the summary counts checked triggers and the mark-only ones, and says so in its line", () => {
  const r = row({ id: "s", reason: "SL", sl_percent: 2 });
  const legs = legsOf(r);
  const checks = { [legs[0].key]: { verdict: "ON_TAPE" }, [exitKeyOf(r)]: { verdict: "ON_TAPE", trigger: { verdict: "MARK_ONLY" } } };
  const s = tapeSummary(legs, checks);
  assert.deepEqual([s.triggers, s.markOnly], [1, 1]);
  assert.match(tapeLine(s), /1 of 1 stop\/target exits fired on the mark with no trade at the level/);
  const ok = tapeSummary(legs, { ...checks, [exitKeyOf(r)]: { verdict: "ON_TAPE", trigger: { verdict: "TRADED" } } });
  assert.match(tapeLine(ok), /all 1 stop\/target exits traded at their level/);
});
