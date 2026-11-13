// ── A paper run's 30-trade judgment, locked before trade 30 ────────────────────────────────────────
// borst, 2026-11-13: "lock the pass/fail rules (after fees, parity clean, fills match public tape) with tests
// before trade 30." The rules are docs/research/paper-judgment-level-reclaim.md, signed that day; this module is
// the same rules in code, and paperJudge.test.mjs fails if the two disagree or the page's text above Results moves.
//
// Pure: no fetch, no KV. The caller hands it the wallet's state (exec's record), its tape checks (lab-api
// paperTape.mjs `ptape:{wallet}`), the recorded hourly funding per market, and a parity report computed over the
// window `judgeWindow` names. lab-api `paperJudge.mjs` does that hourly and records a FINAL verdict once.
//
// Verdicts:
//   UNREAD    no state to read
//   ACCRUING  fewer than 30 closed trades in the run (counts only: no net, no R, until 30)
//   PENDING   30 closed, but a fill's tape check or the parity read isn't in yet
//   HELD      parity DRIFT / UNVERIFIABLE: no verdict until it's explained (not final)
//   LOST      the first trades fell out of exec's 50-row window before a verdict was recorded (not final)
//   PASS      mean net after costs > 0 bps, parity CLEAN                         (final)
//   FAIL      mean net after costs ≤ 0 bps, parity CLEAN                         (final)
//   RESET     the record was reset after the rules were signed                   (final)

import { registrationFor, PAPER_MIN_TRADES } from "./readPipeline.mjs";
import { entryKey, exitKeyOf, TAPE_TOL_BPS } from "./paperTape.mjs";
import { fundingByHour, heldFundingBps } from "./funding.mjs";
import { PARITY_SETTLE_MS, PARITY_EARLY_MS } from "./paperParity.mjs";
import { tradeR } from "./paperRun.mjs";

/** Each judged run, as its page signed it. A new run = a new dated page and a new entry, never an edit. */
export const PAPER_JUDGMENTS = Object.freeze({
  level_reclaim: Object.freeze({
    doc: "docs/research/paper-judgment-level-reclaim.md",
    signedAt: "2026-11-13T00:00:00Z",
    wallet: "0x95e26E980e300C34360933b849457F42c6Bd7622",
    trades: PAPER_MIN_TRADES,      // 30
    feeBps: 2.5,                   // taker, each side; frozen at signing
    tapeTolBps: TAPE_TOL_BPS,      // 10: ON_TAPE / NEAR use the paper price
    parityEarlyMs: PARITY_EARLY_MS,   // 10 min: parity's clock slack past the 30th entry
    paritySettleMs: PARITY_SETTLE_MS, // 2h: parity's settle time
    passAboveBps: 0,               // mean net > 0 = PASS
    signature: "signed",           // borst, 2026-11-13 (the page's opening line)
  }),
  // A copy of level_reclaim's rules for the oi_div_reversal_4h paper wallet (drafted 2026-11-13 at 0 trades, signed by
  // borst the same day; the signature is recorded under the page's Results). A rule entry with signature "pending"
  // shows its numbers but records no PASS or FAIL; a reset still ends the run (rule 3) either way.
  oi_div_reversal_4h: Object.freeze({
    doc: "docs/research/paper-judgment-oi-div-reversal-4h.md",
    signedAt: "2026-11-13T00:00:00Z", // the reset cut-off (rule 3): any reset after this date = RESET
    wallet: "0xd446acE5934a0A337A9ee5F0D8ad37FdF8a1e2CD",
    trades: PAPER_MIN_TRADES,
    feeBps: 2.5,
    tapeTolBps: TAPE_TOL_BPS,
    parityEarlyMs: PARITY_EARLY_MS,
    paritySettleMs: PARITY_SETTLE_MS,
    passAboveBps: 0,
    signature: "signed",           // borst, 2026-11-13 ("signed"), recorded under the page's Results
  }),
});

export const FINAL_VERDICTS = Object.freeze(["PASS", "FAIL", "RESET"]);

const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

/** Where the run starts: the later of the wallet's start and its last paper reset (as paperRun counts it). */
export function runStart(state) {
  return Math.max(ms(state?.started_at) ?? 0, ms(state?.paper_reset_at) ?? 0);
}

/** The run's closed rows from its start, oldest close first (paperRun's numbering). */
export function runRows(state) {
  const since = runStart(state);
  return (Array.isArray(state?.paper_trades) ? state.paper_trades : [])
    .filter((t) => t && ms(t.closed_at) != null && (ms(t.opened_at) ?? 0) >= since)
    .sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
}

/**
 * The parity window (rule 6): the run's entries, from the record start to the 30th trade's entry + parity's clock
 * slack. `parityUntil` is what the caller passes paperParity as `until` (it judges up to until − settle, so the
 * window is settled by then). `readableAt` = the later of that and the 30th close. null until 30 trades closed.
 */
export function judgeWindow(axis, state) {
  const rule = PAPER_JUDGMENTS[axis];
  if (!rule || !state) return null;
  const rows = runRows(state);
  if (rows.length < rule.trades) return null;
  const last = rows[rule.trades - 1];
  const judgedTo = ms(last.opened_at) + rule.parityEarlyMs;
  const parityUntil = judgedTo + rule.paritySettleMs;
  return { since: runStart(state), judgedTo, parityUntil, lastClose: ms(last.closed_at), readableAt: Math.max(parityUntil, ms(last.closed_at)) };
}

/**
 * A fill's judged price (rule 5). `buy` = the fill bought (a long's entry, a short's exit).
 * OFF: the worse of the paper price and the nearest traded edge of the checked bar. Everything else: the paper price.
 */
export function judgedPrice(px, check, buy) {
  if (!check || check.verdict !== "OFF" || !Array.isArray(check.bar)) return px;
  const h = Number(check.bar[2]), l = Number(check.bar[3]);
  if (!(h > 0) || !(l > 0)) return px;
  return buy ? Math.max(px, l) : Math.min(px, h);
}

/**
 * One closed row, judged: prices, move, fees, funding and net, all in bps of the entry notional (shown rounded;
 * `exactNetBps` is the unrounded net the verdict is computed from, so rounding never decides a pass).
 */
export function judgeTrade(row, { checks = {}, fmap = null, feeBps }) {
  const long = row.direction !== "SHORT";
  const opened = ms(row.opened_at), closed = ms(row.closed_at);
  const paperEntry = Number(row.entry_price), paperExit = Number(row.exit_price);
  const entryCheck = checks[entryKey(row.symbol, opened)] || null;
  const exitCheck = checks[exitKeyOf(row)] || null;
  const entry = judgedPrice(paperEntry, entryCheck, long);
  const exit = judgedPrice(paperExit, exitCheck, !long);
  const moveBps = ((exit / entry - 1) * (long ? 1 : -1)) * 10_000;
  const feesBps = feeBps * (1 + exit / entry);
  const holdH = opened != null && closed != null ? Math.max(1, Math.round((closed - opened) / 3600000)) : null;
  const funding = holdH != null && opened != null
    ? heldFundingBps(fmap, Math.round(opened / 3600000), holdH, long ? "LONG" : "SHORT") : null;
  const netBps = moveBps - feesBps - (funding ?? 0);
  return {
    id: row.id ?? null, symbol: row.symbol, side: long ? "LONG" : "SHORT", reason: row.reason ?? null,
    openedAt: opened != null ? new Date(opened).toISOString() : null, closedAt: new Date(closed).toISOString(),
    paper: { entry: paperEntry, exit: paperExit },
    judged: { entry, exit },
    tape: { entry: entryCheck?.verdict || "PENDING", exit: exitCheck?.verdict || "PENDING" },
    repriced: entry !== paperEntry || exit !== paperExit,
    r: tradeR(row).r,
    moveBps: r1(moveBps), feesBps: r2(feesBps), fundingBps: funding == null ? null : r2(funding), netBps: r1(netBps),
    exactNetBps: netBps,
  };
}

const UNCHECKED = new Set(["NO_DATA", "NO_TRADES"]);

/**
 * @param {string} axis
 * @param {{ state: object|null, tape?: {checks?: object}|null, oiHistBySymbol?: Record<string, any[]>,
 *           parity?: {verdict:string}|null, nowMs?: number }} o
 *   parity = paperParity({ since, until: parityUntil }) from judgeWindow(axis, state); null = not read yet.
 */
export function judgePaperRun(axis, { state, tape = null, oiHistBySymbol = {}, parity = null, nowMs = Date.now() }) {
  const rule = PAPER_JUDGMENTS[axis];
  if (!rule) return null;
  const reg = registrationFor(axis);
  const base = { axis, wallet: rule.wallet, doc: rule.doc, signedAt: rule.signedAt, target: rule.trades,
    feeBps: rule.feeBps, final: false, paperWallet: reg?.paperWallet || null };
  if (!state || typeof state !== "object") return { ...base, verdict: "UNREAD" };

  const resetAt = ms(state.paper_reset_at);
  if (resetAt != null && resetAt > Date.parse(rule.signedAt)) {
    return { ...base, verdict: "RESET", final: true, resetAt: new Date(resetAt).toISOString(),
      reason: "The paper record was reset after its rules were signed: that run is not judged. A new run needs a new dated page." };
  }

  const rows = runRows(state);
  const lifetime = Number(state.paper_agg?.trades);
  const count = Number.isFinite(lifetime) && lifetime >= rows.length ? lifetime : rows.length;
  if (count < rule.trades) return { ...base, verdict: "ACCRUING", count, remaining: rule.trades - count };
  // The 30 must still be in the retained window (exec keeps 50 rows). The hourly job records a verdict long before.
  if (count > rows.length) {
    return { ...base, verdict: "LOST", count, reason: "The first trades fell out of the retained 50-row window before a verdict was recorded." };
  }

  const judged = rows.slice(0, rule.trades);
  const checks = tape?.checks || {};
  const fmaps = new Map();
  const fmapFor = (sym) => {
    if (!fmaps.has(sym)) fmaps.set(sym, Array.isArray(oiHistBySymbol[sym]) ? fundingByHour(oiHistBySymbol[sym]) : null);
    return fmaps.get(sym);
  };
  const trades = judged.map((t, i) => ({ n: i + 1, ...judgeTrade(t, { checks, fmap: fmapFor(String(t.symbol || "")), feeBps: rule.feeBps }) }));

  const fills = { total: trades.length * 2, onTape: 0, near: 0, off: 0, unchecked: 0, pending: 0 };
  for (const t of trades) for (const v of [t.tape.entry, t.tape.exit]) {
    if (v === "ON_TAPE") fills.onTape++;
    else if (v === "NEAR") fills.near++;
    else if (v === "OFF") fills.off++;
    else if (UNCHECKED.has(v)) fills.unchecked++;
    else fills.pending++;
  }
  const win = judgeWindow(axis, state);
  const exactMean = trades.reduce((a, t) => a + t.exactNetBps, 0) / trades.length;
  const meanNetBps = r1(exactMean);
  const numbers = {
    count, trades, fills, parityWindow: { since: new Date(win.since).toISOString(), until: new Date(win.judgedTo).toISOString() },
    meanNetBps,
    meanMoveBps: r1(trades.reduce((a, t) => a + t.moveBps, 0) / trades.length),
    repriced: trades.filter((t) => t.repriced).length,
    fundingMissing: trades.filter((t) => t.fundingBps == null).length,
  };

  if (fills.pending) return { ...base, verdict: "PENDING", ...numbers, reason: `${fills.pending} of ${fills.total} fills not checked against the tape yet.` };
  if (nowMs < win.readableAt || !parity || !parity.verdict) {
    return { ...base, verdict: "PENDING", ...numbers, parityReadableAt: new Date(win.readableAt).toISOString(), reason: "Parity is read once its window has settled and the 30th trade has closed." };
  }
  if (parity.verdict !== "CLEAN") {
    return { ...base, verdict: "HELD", ...numbers, parity: parity.verdict,
      reason: `Parity reads ${parity.verdict}: no verdict until it is explained (pipeline-if-then.md).` };
  }
  const pass = exactMean > rule.passAboveBps;
  // Rules not signed yet: the numbers show, nothing is final (nothing is recorded in pjudge:*).
  if (rule.signature !== "signed") {
    return { ...base, verdict: "PENDING", parity: "CLEAN", ...numbers, reason: "The judgment rules are drafted but not signed yet." };
  }
  return { ...base, verdict: pass ? "PASS" : "FAIL", final: true, parity: "CLEAN", ...numbers,
    line: judgmentLine({ verdict: pass ? "PASS" : "FAIL", meanNetBps, target: rule.trades, fills }) };
}

/** One plain line for a page, or null when there's nothing to say yet. Never a dollar figure. */
export function judgmentLine(j) {
  if (!j) return null;
  const sign = (x) => (x > 0 ? `+${x}` : `${x}`);
  if (j.verdict === "PASS" || j.verdict === "FAIL") {
    const unchecked = j.fills?.unchecked ? ` · ${j.fills.unchecked} of ${j.fills.total} fills had no tape to check` : "";
    return `${j.verdict === "PASS" ? "Passed" : "Failed"} at ${j.target} trades: ${sign(j.meanNetBps)} bps a trade after fees and funding, parity clean${unchecked}.`;
  }
  if (j.verdict === "ACCRUING") return `Judged at ${j.target} trades by rules locked ${String(j.signedAt).slice(0, 10)}: after fees, parity clean, fills checked against the public tape.`;
  if (j.verdict === "PENDING") return `${j.target} trades closed. Verdict pending: ${j.reason}`;
  if (j.verdict === "HELD") return `${j.target} trades closed. Held: ${j.reason}`;
  if (j.verdict === "RESET") return j.reason;
  if (j.verdict === "LOST") return j.reason;
  return null;
}
