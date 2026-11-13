// Run: node --test app/lib/paperJudge.test.mjs
// The 30-trade paper judgment (paperJudge.mjs), locked by docs/research/paper-judgment-level-reclaim.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PAPER_JUDGMENTS, FINAL_VERDICTS, judgePaperRun, judgeWindow, judgedPrice, judgeTrade, judgmentLine, runRows } from "./paperJudge.mjs";
import { entryKey, exitKeyOf, TAPE_TOL_BPS } from "./paperTape.mjs";
import { PARITY_SETTLE_MS, PARITY_EARLY_MS } from "./paperParity.mjs";
import { PAPER_MIN_TRADES, registrationFor } from "./readPipeline.mjs";

const DOC = readFileSync(new URL("../../docs/research/paper-judgment-level-reclaim.md", import.meta.url), "utf8");
const RULE = PAPER_JUDGMENTS.level_reclaim;

// ── the page and the code say the same thing ─────────────────────────────────────────────────────
// The page as signed on 2026-11-13: everything above "## Results". A changed rule is a new dated page.
const SIGNED_PREFIX_SHA256 = "ef942d3e837e6f59a64351efa891cb23c285ec41cb5d629b37d4e2c7b259691e";
test("the rules above Results are exactly as signed", () => {
  const cut = DOC.indexOf("\n## Results");
  assert.ok(cut > 0, "the Results heading is missing");
  assert.equal(createHash("sha256").update(DOC.slice(0, cut)).digest("hex"), SIGNED_PREFIX_SHA256);
});

test("the page's numbers are the code's numbers", () => {
  assert.equal(RULE.doc, "docs/research/paper-judgment-level-reclaim.md");
  assert.equal(RULE.trades, PAPER_MIN_TRADES);
  assert.match(DOC, new RegExp(`The first ${RULE.trades} paper trades closed after the record start`));
  assert.match(DOC, new RegExp(`${RULE.feeBps} bps taker on the entry notional plus ${RULE.feeBps} bps on the exit notional`));
  assert.equal(RULE.tapeTolBps, TAPE_TOL_BPS);
  assert.match(DOC, new RegExp(`within ${RULE.tapeTolBps} bps of what traded`));
  assert.equal(RULE.paritySettleMs, PARITY_SETTLE_MS);
  assert.equal(RULE.paritySettleMs, 2 * 3600000);
  assert.match(DOC, /\(2 hours, parity's settle time\)/);
  assert.equal(RULE.parityEarlyMs, PARITY_EARLY_MS);
  assert.equal(RULE.parityEarlyMs, 10 * 60000);
  assert.match(DOC, /parity's\s+10-minute clock slack/);
  assert.equal(RULE.passAboveBps, 0);
  assert.match(DOC, /Mean net above 0 bps = PASS\. Mean net at or\s+below 0 = FAIL\./);
  assert.equal(RULE.signedAt, "2026-11-13T00:00:00Z");
  assert.match(DOC, /later than 2026-11-13T00:00:00Z/);
  assert.match(DOC, new RegExp(RULE.wallet));
  assert.equal(registrationFor("level_reclaim").paperWallet, RULE.wallet, "the read's registered paper wallet");
  assert.deepEqual([...FINAL_VERDICTS], ["PASS", "FAIL", "RESET"]);
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
const H = 3600000;
const T0 = Date.UTC(2026, 10, 5, 6);
const bar = (h, l) => [0, l, h, l, l];
function row(i, over = {}) {
  const opened = T0 + i * 10 * H, closed = opened + 5 * H;
  return { id: `paper_${i}`, symbol: i % 2 ? "PERP_ETH_USDC" : "PERP_BTC_USDC", direction: "LONG", entry_price: 100, exit_price: 101,
    sl_percent: 1, reason: "TP", opened_at: new Date(opened).toISOString(), closed_at: new Date(closed).toISOString(), ...over };
}
function run(n = 30, over = () => ({})) {
  const rows = Array.from({ length: n }, (_, i) => row(i, over(i)));
  return { started_at: T0 - H, paper_trades: rows.slice().reverse(), paper_agg: { trades: n } };
}
/** Every fill ON_TAPE, unless `pick` says otherwise. */
function tapeFor(state, pick = () => null) {
  const checks = {};
  for (const t of state.paper_trades) {
    checks[entryKey(t.symbol, Date.parse(t.opened_at))] = pick(t, "entry") || { verdict: "ON_TAPE" };
    checks[exitKeyOf(t)] = pick(t, "exit") || { verdict: "ON_TAPE" };
  }
  return { checks };
}
const after = (state) => judgeWindow("level_reclaim", state).readableAt + 1;
const CLEAN = { verdict: "CLEAN" };

// ── the run ──────────────────────────────────────────────────────────────────────────────────────
test("before 30 trades: a count and the rule, no net and no R", () => {
  const j = judgePaperRun("level_reclaim", { state: run(6) });
  assert.equal(j.verdict, "ACCRUING");
  assert.deepEqual([j.count, j.remaining, j.final], [6, 24, false]);
  assert.equal(j.meanNetBps, undefined);
  assert.equal(j.trades, undefined);
  assert.match(judgmentLine(j), /^Judged at 30 trades by rules locked 2026-11-13: after fees, parity clean/);
  assert.equal(judgmentLine(judgePaperRun("level_reclaim", { state: null })), null, "unread says nothing");
  assert.equal(judgePaperRun("not_a_read", { state: run(30) }), null);
});

test("30 trades at +100 bps, fees 2.5 a side, parity clean: PASS, judged on exactly the first 30", () => {
  const s = run(32);
  const j = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: CLEAN, nowMs: after(s) });
  assert.equal(j.verdict, "PASS");
  assert.equal(j.final, true);
  assert.equal(j.trades.length, 30, "trades 31 and 32 never count");
  assert.equal(j.trades[29].id, "paper_29");
  // +100 bps move; fees = 2.5 × (1 + 101/100) = 5.03 bps; funding unread (counted, left out)
  assert.equal(j.trades[0].netBps, 95);
  assert.equal(j.meanNetBps, 95);
  assert.equal(j.fundingMissing, 30);
  assert.equal(j.fills.onTape, 60);
  assert.equal(judgmentLine(j), "Passed at 30 trades: +95 bps a trade after fees and funding, parity clean.");
});

test("a run that only covers its fees fails: mean net at 0 or below is FAIL", () => {
  // exit 100.05: +5 bps move, fees 2.5 × (1 + 1.0005) = 5.00125 → net −0.00125 bps: shown as 0, judged FAIL
  const s = run(30, () => ({ exit_price: 100.05 }));
  const j = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: CLEAN, nowMs: after(s) });
  assert.equal(j.verdict, "FAIL");
  assert.equal(j.final, true);
  assert.ok(j.trades.every((t) => t.exactNetBps < 0 && t.netBps === 0), "rounds to 0, still below it");
  assert.match(judgmentLine(j), /^Failed at 30 trades: /);
});

test("funding paid while held is a cost; funding collected counts the other way", () => {
  const r = row(0);
  const h0 = Math.round(Date.parse(r.opened_at) / H);
  const fmap = new Map(Array.from({ length: 6 }, (_, k) => [h0 - 1 + k, 0.0008])); // +0.08% per 8h, paid by longs
  const long = judgeTrade(r, { checks: {}, fmap, feeBps: 2.5 });
  assert.equal(long.fundingBps, 5, "5h × 8 bps ÷ 8h");
  assert.equal(long.netBps, 90);
  const short = judgeTrade({ ...r, direction: "SHORT", exit_price: 99 }, { checks: {}, fmap, feeBps: 2.5 });
  assert.equal(short.moveBps, 100);
  assert.equal(short.fundingBps, -5, "a short collects it");
  assert.equal(short.netBps, 100, "100 − 4.975 + 5, shown to 0.1 bps");
  assert.ok(Math.abs(short.exactNetBps - 100.025) < 1e-9, "the verdict reads the unrounded net");
});

test("an OFF fill is judged at the worse of its price and the nearest traded edge: it can only hurt", () => {
  const off = (h, l) => ({ verdict: "OFF", bar: bar(h, l), bps: 50 });
  // A buy below everything that traded: judged at the low. Above everything: its own (worse) price stays.
  assert.equal(judgedPrice(99, off(100.5, 100), true), 100);
  assert.equal(judgedPrice(101, off(100.5, 100), true), 101);
  // A sell above everything that traded: judged at the high. Below: its own price.
  assert.equal(judgedPrice(102, off(101.5, 101), false), 101.5);
  assert.equal(judgedPrice(100, off(101.5, 101), false), 100);
  // ON_TAPE / NEAR / no bar: the paper price.
  assert.equal(judgedPrice(99, { verdict: "NEAR", bar: bar(100.5, 100) }, true), 99);
  assert.equal(judgedPrice(99, { verdict: "OFF" }, true), 99);
  assert.equal(judgedPrice(99, null, true), 99);

  // A run that passes on fantasy exits fails once they're re-priced to what traded.
  const s = run(30, () => ({ exit_price: 100.5 }));
  const fantasy = tapeFor(s, (t, kind) => (kind === "exit" ? off(100.04, 99.9) : null));
  const plain = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: CLEAN, nowMs: after(s) });
  const j = judgePaperRun("level_reclaim", { state: s, tape: fantasy, parity: CLEAN, nowMs: after(s) });
  assert.equal(plain.verdict, "PASS");
  assert.equal(j.verdict, "FAIL");
  assert.equal(j.repriced, 30);
  assert.deepEqual([j.trades[0].paper.exit, j.trades[0].judged.exit], [100.5, 100.04]);
  assert.equal(j.fills.off, 30);
});

test("NO_DATA and NO_TRADES fills are judged at the paper price and counted in the line", () => {
  const s = run(30);
  const tape = tapeFor(s, (t, kind) => (Number(t.id.split("_")[1]) < 4 && kind === "entry" ? { verdict: "NO_DATA" } : t.id === "paper_9" && kind === "exit" ? { verdict: "NO_TRADES" } : null));
  const j = judgePaperRun("level_reclaim", { state: s, tape, parity: CLEAN, nowMs: after(s) });
  assert.equal(j.verdict, "PASS");
  assert.equal(j.fills.unchecked, 5);
  assert.equal(j.meanNetBps, 95, "same prices as the checked run");
  assert.match(judgmentLine(j), /· 5 of 60 fills had no tape to check\.$/);
});

test("a fill not checked yet, or parity not read yet, keeps it PENDING", () => {
  const s = run(30);
  const tape = tapeFor(s);
  delete tape.checks[exitKeyOf(runRows(s)[29])];
  const a = judgePaperRun("level_reclaim", { state: s, tape, parity: CLEAN, nowMs: after(s) });
  assert.equal(a.verdict, "PENDING");
  assert.match(a.reason, /^1 of 60 fills not checked/);
  const w = judgeWindow("level_reclaim", s);
  const b = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: CLEAN, nowMs: w.readableAt - 1 });
  assert.equal(b.verdict, "PENDING", "too early to read parity");
  const c = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: null, nowMs: after(s) });
  assert.equal(c.verdict, "PENDING", "parity not read");
  assert.equal(c.final, false);
});

test("the parity window ends at the 30th entry + its clock slack, settled, and the 30th trade closed", () => {
  const s = run(31);
  const w = judgeWindow("level_reclaim", s);
  const r30 = runRows(s)[29];
  assert.equal(w.since, T0 - H);
  assert.equal(w.judgedTo, Date.parse(r30.opened_at) + 10 * 60000);
  assert.equal(w.parityUntil, w.judgedTo + 2 * H, "paperParity judges up to until − settle");
  assert.equal(w.readableAt, Math.max(w.parityUntil, Date.parse(r30.closed_at)));
  assert.equal(judgeWindow("level_reclaim", run(29)), null);
});

test("parity DRIFT or UNVERIFIABLE holds the verdict: not final, not a pass", () => {
  const s = run(30);
  for (const v of ["DRIFT", "UNVERIFIABLE"]) {
    const j = judgePaperRun("level_reclaim", { state: s, tape: tapeFor(s), parity: { verdict: v }, nowMs: after(s) });
    assert.deepEqual([j.verdict, j.final, j.parity], ["HELD", false, v]);
    assert.match(judgmentLine(j), /Held: Parity reads/);
  }
});

test("a reset after signing is RESET, final; one before signing just starts the run", () => {
  const late = { ...run(30), paper_reset_at: Date.parse(RULE.signedAt) + H };
  const j = judgePaperRun("level_reclaim", { state: late, tape: tapeFor(late), parity: CLEAN, nowMs: after(run(30)) });
  assert.deepEqual([j.verdict, j.final], ["RESET", true]);
  const early = { ...run(30), paper_reset_at: T0 - 2 * H };
  assert.equal(judgePaperRun("level_reclaim", { state: early, tape: tapeFor(early), parity: CLEAN, nowMs: after(early) }).verdict, "PASS");
});

test("trades from before the run started don't count; first trades lost from the window = LOST, not judged", () => {
  const s = run(30);
  s.paper_trades.push(row(-3, { id: "before", opened_at: new Date(T0 - 30 * H).toISOString(), closed_at: new Date(T0 - 25 * H).toISOString() }));
  assert.equal(runRows(s).length, 30);
  const lost = { ...run(30), paper_agg: { trades: 55 } };
  const j = judgePaperRun("level_reclaim", { state: lost, tape: tapeFor(lost), parity: CLEAN, nowMs: after(lost) });
  assert.deepEqual([j.verdict, j.final], ["LOST", false]);
});
