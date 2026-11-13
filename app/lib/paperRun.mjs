// ── A cleared read's paper run, trade by trade, in R ──────────────────────────────────────────────
// borst, 2026-11-12: "no running dollar pnl. paper dollars without fees or funding look like cheap marketing
// flexes. show the trade count (n of 30), win/loss/be breakdown, and individual trade r. keep it purely about
// mathematical discipline and execution until the 30-trade sample is complete."
//
// Pure. Reads the paper wallet the read's registration names (readPipeline.mjs `paperWallet`) and its state
// as exec wrote it. Serves for GET /signals/paper-run/:axis, the /proof/paper/:axis page and its link card.
//
// What it never carries: a dollar figure (no pnl, no size, no qty, no leverage) and no sum or average of R.
// Paper has no fees and no funding, so totals would overstate; the 30-trade judgment is made after fees by
// the live plan, in its own PR.
//
// R per trade:
//   - "fill": the trade's own stop distance as exec used it (`sl_percent`, stamped on paper rows from
//     2026-11-12): R = the price move in the trade's direction ÷ that stop. Shows the execution as it was
//     (an exit past its level reads −1.04R, not −1R).
//   - "contract": an older row without `sl_percent`, read by its exit under the graded contract: TP = +1.5R,
//     SL = −1R. Labelled, never passed off as a fill.
//   - null: neither (e.g. a 168h time exit on a row without its stop). Shown as unread, never as 0.
// This contract has no breakeven stop: a trade that touches neither level closes at its 168h time stop.

import { registrationFor, PAPER_MIN_TRADES } from "./readPipeline.mjs";
import { R_CONTRACT } from "./rContract.mjs";
import { entryKey, exitKeyOf, walletLegs, tapeSummary, tapeLine } from "./paperTape.mjs";

const OUTCOME = Object.freeze({ TP: "WIN", SL: "LOSS", TIMEOUT: "TIME" });
const coinOf = (symbol) => String(symbol || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const r2 = (x) => Math.round(x * 100) / 100;
const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };

/** One closed paper row → its signed move %, its R and where the R comes from. */
export function tradeR(row) {
  const entry = Number(row?.entry_price), exit = Number(row?.exit_price);
  const sign = row?.direction === "SHORT" ? -1 : 1;
  const movePct = entry > 0 && exit > 0 ? (exit / entry - 1) * 100 * sign : null;
  const sl = Number(row?.sl_percent);
  if (movePct != null && sl > 0) return { movePct: r2(movePct), r: r2(movePct / sl), rBasis: "fill" };
  if (row?.reason === "TP") return { movePct: movePct == null ? null : r2(movePct), r: R_CONTRACT.rMultiple, rBasis: "contract" };
  if (row?.reason === "SL") return { movePct: movePct == null ? null : r2(movePct), r: -1, rBasis: "contract" };
  return { movePct: movePct == null ? null : r2(movePct), r: null, rBasis: null };
}

/**
 * @param {string} axis a registered read
 * @param {object|null} state the paper wallet's agent state (null = unread)
 * @param {object|null} [tape] the wallet's tape checks (lab-api paperTape.mjs `ptape:{wallet}`): each trade then
 *   carries `tape: { entry, exit }` verdicts and the run a `tape` summary + line (paperTape.mjs). Omitted = none.
 * @returns {null | object} null when the read has no paper wallet
 */
export function paperRun(axis, state, tape = null) {
  const reg = registrationFor(axis);
  const wallet = reg?.paperWallet || null;
  if (!wallet) return null;
  const base = { axis, wallet, target: PAPER_MIN_TRADES, registeredAt: reg.registeredAt || null, doc: reg.doc || null };
  if (!state || typeof state !== "object") return { ...base, unread: true };
  // The record starts where exec's state does (a paper reset restarts it).
  const since = Math.max(ms(state.started_at) ?? 0, ms(state.paper_reset_at) ?? 0);
  const rows = (Array.isArray(state.paper_trades) ? state.paper_trades : [])
    .filter((t) => t && ms(t.closed_at) != null && (ms(t.opened_at) ?? 0) >= since)
    .sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
  const lifetime = Number(state.paper_agg?.trades);
  const count = Number.isFinite(lifetime) && lifetime >= rows.length ? lifetime : rows.length;
  const offset = count - rows.length; // rows older than the 50-row window (numbered from where it starts)
  const tally = { win: 0, loss: 0, time: 0, other: 0 };
  const trades = rows.map((t, i) => {
    const outcome = OUTCOME[t.reason] || "OTHER";
    tally[outcome === "WIN" ? "win" : outcome === "LOSS" ? "loss" : outcome === "TIME" ? "time" : "other"]++;
    const opened = ms(t.opened_at), closed = ms(t.closed_at);
    return {
      n: offset + i + 1, coin: coinOf(t.symbol), side: t.direction === "SHORT" ? "SHORT" : "LONG",
      openedAt: opened != null ? new Date(opened).toISOString() : null, closedAt: new Date(closed).toISOString(),
      holdH: opened != null ? r2((closed - opened) / 3600000) : null,
      entry: Number(t.entry_price) || null, exit: Number(t.exit_price) || null,
      reason: t.reason || null, outcome, ...tradeR(t),
      ...(tape ? { tape: {
        entry: t.entry_avg ? "AVERAGED" : tape.checks?.[entryKey(t.symbol, opened)]?.verdict || "PENDING",
        exit: tape.checks?.[exitKeyOf(t)]?.verdict || "PENDING",
        // A stop/target exit: did the tape trade at its level (TRADED) or did it fire on the mark alone (MARK_ONLY)?
        ...(tape.checks?.[exitKeyOf(t)]?.trigger ? { trigger: tape.checks[exitKeyOf(t)].trigger.verdict } : {}),
      } } : {}),
    };
  });
  const p = state.current_position;
  const open = p && p.paper && p.symbol
    ? { coin: coinOf(p.symbol), side: p.direction === "SHORT" ? "SHORT" : "LONG", openedAt: ms(p.opened_at) != null ? new Date(ms(p.opened_at)).toISOString() : null }
    : null;
  return {
    ...base,
    startedAt: since > 0 ? new Date(since).toISOString() : null,
    count, remaining: Math.max(0, PAPER_MIN_TRADES - count), complete: count >= PAPER_MIN_TRADES,
    tally, open, windowed: offset > 0, trades,
    ...(tape ? (() => {
      // Over this run's fills only (from where the record starts), the open position's entry included.
      const summary = tapeSummary(walletLegs({ current_position: p, paper_trades: rows }), tape.checks);
      return { tape: { ...summary, line: tapeLine(summary) } };
    })() : {}),
  };
}

/** The one-line summary the page header, its link card and the sitemap use. */
export function paperRunLine(run) {
  if (!run) return null;
  if (run.unread) return `${run.axis} on paper: record unread right now.`;
  const t = run.tally;
  const parts = [`${t.win} TP`, `${t.loss} SL`, ...(t.time ? [`${t.time} at the time stop`] : []), ...(t.other ? [`${t.other} other`] : [])];
  return `${run.axis} on paper: ${run.count} of ${run.target} trades. ${parts.join(" · ")}.`;
}

/** Every read with a paper wallet (for the sitemap). */
export { REGISTERED_READS } from "./readPipeline.mjs";
