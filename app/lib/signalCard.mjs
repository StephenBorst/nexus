// ── Scoreboard card: what each read is, and the one honest line about it ───────────────
// Display only. Every number comes from /intel/axis-backtest as served; nothing here grades.
// Pure + tested (signalCard.test.mjs), so the /proof card and anything else that shows a
// read's summary can't word the same evidence two ways.
import { beatsRandom } from "./badgeBar.mjs";

// What each read IS — a plain description of the rule, never how good it is (the grade says
// that, and the grade moves; a sentence praising a read would go stale the day it slips).
export const AXIS_BLURB = {
  basis_x_cvd: "Buys the widest perp discount only when aggressor flow agrees in the same hour.",
  basis_extreme: "Fades an extreme perp premium or discount to spot.",
  basis_dev: "Fades basis when it strays far from its own usual level, on either side.",
  basis_dev_x_cvd: "The two-sided basis read, taken only when aggressor flow agrees.",
  basis_x_smart: "Basis extreme, taken only when smart-money positioning agrees.",
  basis_x_liqflush: "Basis extreme, timed to a liquidation flush.",
  rsi_reset_deep: "Buys an RSI pullback under 45 while the broader trend stays up.",
  rsi_reset_trend: "An RSI reset that holds, taken only in an up-trend regime.",
  rsi_reset_held: "Buys an RSI reset that holds above 45 in an uptrend.",
  smart_follow: "Takes the side the most profitable accounts are positioned on.",
  smart_fade: "Funding fade, taken only when smart money agrees.",
  funding_fade: "Fades extreme funding. The old flagship, kept as the baseline.",
  cvd_divergence: "Price and aggressor flow disagree; takes the flow's side.",
  liq_flush: "Fades the move after a burst of liquidations.",
  rs_value_pullback: "Relative-strength leaders pulling back to value. Proxy inputs.",
  rs_value_pullback_rsi: "The value pullback, with RSI at 45 or higher. Proxy inputs.",
  rs_value_pullback_candle: "Relative-strength leaders pulling back to weekly VWAP. Real candles.",
  rs_value_pullback_candle_rsi: "The VWAP pullback, with RSI at 45 or higher. Real candles.",
  rs_value_pullback_rotation: "The VWAP pullback, vetoed unless volume rotates in.",
  level_reclaim: "Price sweeps the prior day's high or low, then closes back inside. Fades the sweep.",
  oi_div_reversal: "A big 24h move while open interest falls. Fades it.",
  oi_div_reversal_4h: "A big 4h move while open interest falls. Fades it.",
  oi_coil_break: "Open interest builds while price goes nowhere. Follows the break out of the range.",
  session_momentum: "A bigger-than-usual NY open move (13–15 UTC). Goes with it.",
  session_fade: "The same bigger-than-usual NY open move (13–15 UTC). Bets against it.",
  level_reclaim_tight: "The prior-day sweep and reclaim, taken only when the coin is calmer than usual.",
  spot_absorb: "Perps push price one way while spot trades the other and open interest is flat. Goes with spot.",
  confluence_follow: "Funding and OI agree on a fade. Goes the other way, with the crowd.",
};

// "RSI reset <45 (uptrend)" → { main: "RSI reset <45", aside: "(uptrend)" }. Only a trailing
// parenthetical is split off; a label with none (or with text after it) stays whole.
export function splitLabel(label) {
  const s = String(label || "");
  const m = s.match(/^(.*\S)\s+(\([^()]*\))$/);
  return m ? { main: m[1], aside: m[2] } : { main: s, aside: "" };
}

const TIER = { PREDICTIVE: 0, PROMISING: 1, NOISE: 2, INSUFFICIENT: 3 };
const BASE_RANK = { BEATS_RANDOM: 0, LEANS_ABOVE: 1, NOT_DISTINGUISHABLE: 2, TOO_FEW: 3, BELOW_RANDOM: 4 };

// Ranked by evidence: the board's verdict first, then how the read fares against random entries
// in its own window, then sample size. Stable for equal keys.
export function rankAxes(axes) {
  return (Array.isArray(axes) ? axes : [])
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const t = (TIER[x.a?.verdict] ?? 3) - (TIER[y.a?.verdict] ?? 3);
      if (t) return t;
      const b = (BASE_RANK[x.a?.random?.pooled?.verdict] ?? 3) - (BASE_RANK[y.a?.random?.pooled?.verdict] ?? 3);
      if (b) return b;
      const p = (y.a?.random?.pooled?.pctBeaten ?? -1) - (x.a?.random?.pooled?.pctBeaten ?? -1);
      if (p) return p;
      return x.i - y.i;
    })
    .map((x) => x.a);
}

// Compact cards: the board keeps every read visible, but a read with no edge doesn't get the
// same room as one that might have one.
export const isCompact = (a) => !a || a.verdict === "NOISE" || a.verdict === "INSUFFICIENT" || !a.best;

// The one honest line: what the evidence says today, in the order a reader needs it —
// which sides it trades, whether it clears the market's drift, and whether it beats random
// entries. Built only from served numbers; returns { text, tone } where tone is one of
// "pos" | "neg" | "neutral" (the card maps tone to a colour).
export function takeaway(a) {
  if (!a || !a.best || a.verdict === "INSUFFICIENT") return { text: "Accruing. Not enough history to rate yet.", tone: "neutral" };
  const parts = [];
  const L = a.sides?.LONG?.events ?? 0, S = a.sides?.SHORT?.events ?? 0;
  if (L + S > 0 && S === 0) parts.push("Long-only in practice");
  else if (L + S > 0 && L === 0) parts.push("Short-only in practice");
  const drift = a.best.drift;
  const clearsDrift = drift ? drift.excessBps > 0 : null;
  const rb = a.random?.pooled;
  let tone = "neutral";
  if (rb?.verdict === "BEATS_RANDOM") { parts.push(`beats random entries in its window (${rb.pctBeaten}%)`); tone = "pos"; }
  else if (rb?.verdict === "BELOW_RANDOM") { parts.push(`reliably worse than random entries (${rb.pctBeaten}%)`); tone = "neg"; }
  else if (rb?.verdict === "LEANS_ABOVE") {
    parts.push(`leans above random entries (${rb.pctBeaten}%), not yet separated` + (rb.moreTradesNeeded ? `, ~${rb.moreTradesNeeded} more events` : ""));
  } else if (rb?.verdict === "NOT_DISTINGUISHABLE") parts.push("can't yet be told apart from random entries");
  else if (rb?.verdict === "TOO_FEW") parts.push("too few events to test against random");
  if (clearsDrift === false) { parts.push("edge doesn’t clear the market’s drift"); if (tone === "neutral") tone = "neg"; }
  if (!parts.length) return { text: "Graded. No baseline yet.", tone };
  const text = parts.join(" · ");
  return { text: text[0].toUpperCase() + text.slice(1) + ".", tone };
}

// One side's bar: width = share of random replays the read beat (0–100), sign = its mean R.
// A side that never fired says so; a side too thin to test says that instead of a bar.
/** @returns {{ events: number, state: string, label?: string, meanR?: number | null, pct?: number, verdict?: string, randomR?: number }} */
export function sideBar(a, side) {
  const s = a?.sides?.[side];
  const rb = a?.random?.bySide?.[side];
  const events = s?.events ?? 0;
  if (!events) return { events: 0, state: "never", label: "never fires" };
  const meanR = s?.r?.samples ? s.r.meanR : null;
  if (!rb || rb.verdict === "TOO_FEW" || rb.pctBeaten == null) return { events, state: "thin", meanR, label: "too few to test" };
  const out = { events, state: "tested", meanR, pct: Math.max(0, Math.min(100, rb.pctBeaten)), verdict: rb.verdict };
  // What a random entry on the same side, coins and hours earned (median of the replays): the number this side has to
  // beat. Shown beside the read's own R so a side that rides the market reads as such (2026-11-16 engine review).
  if (Number.isFinite(rb.randomMedianR)) out.randomR = rb.randomMedianR;
  return out;
}

// The tide over the board (the scoreboard's `tide`): what a random long and a random short earned on the same R contract
// across every recorded market-hour. A plain fact above the list, so "its shorts made money" is read against the market.
// Null when unread: nothing is said rather than a guess.
export function tideLine(tide) {
  const L = tide?.LONG?.meanR, S = tide?.SHORT?.meanR;
  if (typeof L !== "number" || typeof S !== "number" || !Number.isFinite(L) || !Number.isFinite(S) || !tide?.from) return null;
  const from = new Date(tide.from);
  if (Number.isNaN(from.getTime())) return null;
  const since = from.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { since, long: L, short: S, rule: "Each side has to beat its own random entry, not zero." };
}

// ── The board in four groups, best first (borst, 2026-11-17; pipeline-if-then.md § "Board layout and the CLEARED badge") ──
// Top to bottom: CLEARED, Leads, Still testing, then the folded archive (old-data-only reads, reads worse than random),
// Archived last. Reads no longer retire (2026-11-20, pipeline-if-then.md "Reads no longer retire"): a read that fails the
// 100-event check stays in its stage's group with the label on its row, ordered last there, and keeps running. Was (2026-10-18): one "pipeline" list by stage. Two rules carry over: the top of the board is never the best
// IN-SAMPLE number, and every read stays visible.
//   cleared  a registered read that cleared the FULL ladder: served TRADEABLE or PAPER, no promotion lock, AND its
//            30-trade paper judgment recorded PASS (paperJudge.mjs). The only rows that may be promoted.
//   lead     registered reads served LEAD, EDGE, TRADEABLE or PAPER that haven't cleared.
//   testing  registered reads still REGISTERED (counting new events, short of the first bar, or failing).
//   history  every other read, graded on recorded history only (in-sample), by rankAxes.
//   below    unregistered reads that lose to random entries (pooled BELOW_RANDOM).
//   archived registered reads borst archived BY HAND (readPipeline ARCHIVED_READS; never automatic).
// Inside cleared / lead / testing: a read carrying the `failing` label last, then the furthest stage first, then the
// share of random entries the read beat on NEW data (the main card, `numbers.beatsRandomPct`; unread = last), then
// events. Never an in-sample number.
// Display only: stages, numbers and verdicts come from /intel/axis-backtest and /signals/paper-judge as served.
export const STAGE_LADDER = ["PAPER", "TRADEABLE", "EDGE", "LEAD", "REGISTERED"];
export const BOARD_GROUP_ORDER = Object.freeze(["cleared", "lead", "testing", "history", "below", "archived"]);
const CLEARABLE = new Set(["PAPER", "TRADEABLE"]);

/**
 * The CLEARED badge: the full ladder (borst, 2026-11-17). Served TRADEABLE or PAPER (each side beats random, the halves
 * agree, the holdout repeats, the graded exit nets above 0 after fees: readPipeline.mjs), no promotion lock (a read that
 * fell back hasn't re-qualified yet), and a RECORDED 30-trade paper PASS (after fees, parity clean, fills on the tape).
 * A paper PASS alone is never enough: a read with no edge clears "mean > 0 at 30 trades" about 4 times in 10.
 * Re-checked on every build: a read that falls back, locks, or carries the 100-event `failing` label loses the badge
 * (2026-11-20; a failing read can't be served above LEAD anyway, readPipeline.test.mjs pins that, so this is a backstop).
 */
export function isCleared(reg, judgment, locks = {}) {
  if (!reg || !CLEARABLE.has(reg.stage)) return false;
  if (Array.isArray(reg.failing) && reg.failing.length) return false;
  if (locks && Object.prototype.hasOwnProperty.call(locks, reg.axis)) return false;
  // badge bar v2 (docs/research/badge-bar-v2.md, signed 2026-11-20): the PASS's 30 trades must also beat ≥ 90% of 300
  // matched random entries (stored with the verdict, app/lib/badgeBar.mjs)
  return judgment?.recorded === true && judgment?.verdict === "PASS" && beatsRandom(judgment);
}

const newDataPct = (reg) => (Number.isFinite(reg?.numbers?.beatsRandomPct) ? reg.numbers.beatsRandomPct : -1);
const isFailing = (reg) => Array.isArray(reg?.failing) && reg.failing.length > 0;
const bestFirst = (x, y) => {
  const f = Number(isFailing(x.reg)) - Number(isFailing(y.reg));
  if (f) return f;
  const st = STAGE_LADDER.indexOf(x.reg.stage) - STAGE_LADDER.indexOf(y.reg.stage);
  if (st) return st;
  const p = newDataPct(y.reg) - newDataPct(x.reg);
  if (p) return p;
  const e = (Number(y.reg?.numbers?.events) || 0) - (Number(x.reg?.numbers?.events) || 0);
  if (e) return e;
  return String(x.a?.name).localeCompare(String(y.a?.name));
};

/**
 * @param {any[] | null | undefined} axes scoreboard axes
 * @param {any[] | null | undefined} reads scoreboard pipeline.reads
 * @param {string[]} archived reads archived by hand (readPipeline ARCHIVED_READS keys)
 * @param {{ judgments?: Record<string, {recorded?: boolean, verdict?: string}>, locks?: Record<string, object> }} opts
 * @returns {{ key: string, rows: { a: any, reg: any }[] }[]} non-empty groups in BOARD_GROUP_ORDER, plus
 *          "cleared" always (empty = "nothing has cleared yet", said out loud on the page)
 */
export function boardGroups(axes, reads, archived = [], { judgments = {}, locks = {} } = {}) {
  const regBy = new Map((Array.isArray(reads) ? reads : []).filter((r) => r && r.axis).map((r) => [r.axis, r]));
  const done = new Set(Array.isArray(archived) ? archived : []);
  const g = Object.fromEntries(BOARD_GROUP_ORDER.map((k) => [k, []]));
  for (const a of rankAxes(axes)) {
    const reg = regBy.get(a.name) || null;
    const step = reg ? STAGE_LADDER.indexOf(reg.stage) : -1;
    if (done.has(a.name)) g.archived.push({ a, reg });
    else if (step >= 0 && isCleared(reg, judgments?.[a.name], locks)) g.cleared.push({ a, reg });
    else if (step >= 0 && reg.stage !== "REGISTERED") g.lead.push({ a, reg });
    else if (step >= 0) g.testing.push({ a, reg });
    else if (a?.random?.pooled?.verdict === "BELOW_RANDOM") g.below.push({ a, reg: null });
    else g.history.push({ a, reg: null });
  }
  for (const k of ["cleared", "lead", "testing"]) g[k].sort(bestFirst);
  return BOARD_GROUP_ORDER.map((key) => ({ key, rows: g[key] })).filter((x) => x.key === "cleared" || x.rows.length);
}

// The vs-random bar on a board row: the pooled share of random replays the read beat.
export function randomBar(a) {
  const p = a?.random?.pooled;
  if (!p || p.verdict === "TOO_FEW" || p.pctBeaten == null) return { state: "thin", label: "too few to test" };
  return { state: "tested", pct: Math.max(0, Math.min(100, p.pctBeaten)), verdict: p.verdict };
}
