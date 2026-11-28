// ── The execution gap: your run of a read vs the read's own reference run (borst 2026-11-26, the moat list) ──────────
// "Did I trade what the read traded?" A user who loads a registered read on paper (the Strategy Shelf, or the hidden
// LEVEL_RECLAIM / OI_DIV_4H links) runs the SAME rule as the read's reference run (its own paper wallet, else its keyless
// house run). This pairs the two runs trade by trade from the later of their two record starts:
//   - a pair = same coin, same side, opened within PAIR_WINDOW_MIN minutes of each other (both act on the same brain
//     signal; exec ticks each minute), nearest first, each trade used once;
//   - per pair: how much later you opened, your entry and exit vs the reference's in bps (+ = yours was worse), and
//     both R's side by side (never summed or averaged: paper R is the 30-trade judgment's job);
//   - missed = the reference took it and you didn't; extra = you took one the reference didn't;
//   - the config fields where yours differs from the read's own (a tweak changes what is traded, so it is named).
// Both runs are paper, filled at the mark: the gap here is timing, caps and being busy, never slippage. A live run's
// slippage is its own record (app/lib/slippage.mjs). Display only; nothing trades on it. Pure; tested.
// borst 2026-11-28 ("counts + pairs until 30"): numbers only, no comparative words. Each run as n of 30 (the judgment's
// count); medians only from GAP_MIN_MATCHED paired trades; no mean R or beat-random before a run's 30-trade verdict
// (that is the judgment's job). A user's run never moves a stage (NO_STAGE_LINE).

import { readPaperConfig } from "./housePaper.mjs";
import { tradeR } from "./paperRun.mjs";

export const PAIR_WINDOW_MIN = 10;
export const GAP_MIN_MATCHED = 5;
export const GAP_TARGET = 30;
export const NO_STAGE_LINE = "Your run never moves this read’s stage. Only the read’s own run is judged.";
export const GAP_SIGN_LINE = "+ bps = your fill paid more than the read’s own run. Lag = minutes after its entry.";
export const GAP_LINE_PAPER = "Both runs are paper, filled at the mark: this gap is timing, caps and being busy, not slippage.";

const ms = (v) => { const t = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
const coinOf = (sym) => String(sym || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const r1 = (x) => Math.round(x * 10) / 10;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Where a paper record starts: the later of its start and its last reset (as paperRun / parityWindowStart read it). */
export const recordStart = (state) => Math.max(ms(state?.started_at) ?? 0, ms(state?.paper_reset_at) ?? 0);

// Fields that change WHICH trades are taken (sizing fields only change dollars, not entries or R).
const ENTRY_FIELDS = ["signalMode", "read", "symbols", "maxTradesPerDay", "maxDailyLossUsdc", "exitContract", "maxHoldHours", "invertSignal",
  "respectRegime", "respectSmartMoney", "maxSignalAgeSec", "takeProfits", "trailingStopPct", "breakevenTriggerPct", "dcaEnabled", "volScaledStops", "mode"];
const SIZE_FIELDS = ["capitalPerTrade", "leverage", "riskPerTradeUsd"];
const canon = (v) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v ?? null);

/** Which fields of a user's config differ from the read's own paper config. */
export function configDiff(read, config) {
  let want;
  try { want = readPaperConfig(read); } catch { return { entries: [], sizing: [] }; }
  // LEVEL_RECLAIM / OI_DIV_4H are the same rules under their own mode names: compare the mode as the read.
  const mine = { ...config };
  if (mine.signalMode === "LEVEL_RECLAIM" || mine.signalMode === "OI_DIV_4H") { mine.signalMode = "REGISTERED_READ"; mine.read = read; }
  return {
    entries: ENTRY_FIELDS.filter((k) => canon(mine[k] ?? want[k]) !== canon(want[k]) && !(k === "takeProfits" && !(mine[k] || []).length && !(want[k] || []).length)),
    sizing: SIZE_FIELDS.filter((k) => mine[k] != null && canon(mine[k]) !== canon(want[k] ?? null)),
  };
}

/** Closed paper trades since the record start (paper_agg is the lifetime count; the 50-row window can't be). */
export function lifetimeCount(state) {
  const n = Number(state?.paper_agg?.trades);
  const since = recordStart(state);
  const rows = (Array.isArray(state?.paper_trades) ? state.paper_trades : []).filter((t) => t && ms(t.closed_at) != null && (ms(t.opened_at) ?? 0) >= since && t.reason !== "TP_PARTIAL").length;
  return Number.isFinite(n) && n >= rows ? n : rows;
}

const rowsOf = (state, from) => (Array.isArray(state?.paper_trades) ? state.paper_trades : [])
  .filter((t) => t && t.symbol && ms(t.opened_at) != null && ms(t.closed_at) != null && ms(t.opened_at) >= from && t.reason !== "TP_PARTIAL")
  .map((t) => ({ coin: coinOf(t.symbol), side: t.direction === "SHORT" ? "SHORT" : "LONG", openedMs: ms(t.opened_at), closedMs: ms(t.closed_at),
    entry: Number(t.entry_price) || null, exit: Number(t.exit_price) || null, reason: t.reason || null, r: tradeR(t).r }));
const openOf = (state, from) => {
  const p = state?.current_position;
  if (!p || !p.paper || !p.symbol || (ms(p.opened_at) ?? 0) < from) return null;
  return { coin: coinOf(p.symbol), side: p.direction === "SHORT" ? "SHORT" : "LONG", openedMs: ms(p.opened_at), entry: Number(p.entry_price) || null, open: true };
};

// + = yours was worse: a long pays more / sells for less, a short sells for less / buys back for more.
const gapBps = (mine, ref, side, leg) => {
  if (!(mine > 0) || !(ref > 0)) return null;
  const up = (mine / ref - 1) * 10_000;
  const buy = (side === "LONG") === (leg === "entry");
  return r1(buy ? up : -up);
};

/**
 * @param {{ read: string, config: object, state: object|null, refWallet: string, refState: object|null, now?: number }} o
 */
export function executionGap({ read, config, state, refWallet, refState, now = Date.now() }) {
  const base = { read, refWallet };
  if (!state || !refState) return { ...base, unread: true };
  const from = Math.max(recordStart(state), recordStart(refState));
  const diff = configDiff(read, config || {});
  const mine = rowsOf(state, from), ref = rowsOf(refState, from);
  const myOpen = openOf(state, from), refOpen = openOf(refState, from);
  if (myOpen) mine.push(myOpen);
  if (refOpen) ref.push(refOpen);

  // Nearest-first pairing within the window, each trade once.
  const cands = [];
  ref.forEach((a, i) => mine.forEach((b, j) => {
    const lag = (b.openedMs - a.openedMs) / 60000;
    if (a.coin === b.coin && a.side === b.side && Math.abs(lag) <= PAIR_WINDOW_MIN) cands.push({ i, j, lag });
  }));
  cands.sort((x, y) => Math.abs(x.lag) - Math.abs(y.lag) || x.i - y.i || x.j - y.j);
  const usedR = new Set(), usedM = new Set(), pairs = [];
  for (const c of cands) {
    if (usedR.has(c.i) || usedM.has(c.j)) continue;
    usedR.add(c.i); usedM.add(c.j);
    const a = ref[c.i], b = mine[c.j];
    pairs.push({
      coin: a.coin, side: a.side, refOpenedAt: new Date(a.openedMs).toISOString(), lagMin: r1(c.lag),
      entryBps: gapBps(b.entry, a.entry, a.side, "entry"),
      exitBps: a.open || b.open ? null : gapBps(b.exit, a.exit, a.side, "exit"),
      refR: a.open ? null : a.r ?? null, myR: b.open ? null : b.r ?? null,
      refExit: a.open ? "OPEN" : a.reason, myExit: b.open ? "OPEN" : b.reason,
    });
  }
  const at = (x) => ({ coin: x.coin, side: x.side, openedAt: new Date(x.openedMs).toISOString(), open: !!x.open });
  // A reference trade opened in the last PAIR_WINDOW_MIN minutes may still be matched next tick: not missed yet.
  const missed = ref.filter((_, i) => !usedR.has(i) && now - ref[i].openedMs > PAIR_WINDOW_MIN * 60000).map(at);
  const extra = mine.filter((_, j) => !usedM.has(j) && now - mine[j].openedMs > PAIR_WINDOW_MIN * 60000).map(at);
  pairs.sort((x, y) => Date.parse(y.refOpenedAt) - Date.parse(x.refOpenedAt));
  const entryGaps = pairs.map((p) => p.entryBps).filter((v) => v != null);
  const enough = pairs.length >= GAP_MIN_MATCHED;
  return {
    ...base, from: from ? new Date(from).toISOString() : null,
    refCount: ref.filter((_, i) => usedR.has(i) || now - ref[i].openedMs > PAIR_WINDOW_MIN * 60000).length,
    matched: pairs.length, missed, extra, pairs,
    // Medians only from GAP_MIN_MATCHED paired trades: fewer is an anecdote, not a number to read.
    medianEntryBps: enough && entryGaps.length ? r1(median(entryGaps)) : null,
    medianLagMin: enough ? r1(median(pairs.map((p) => p.lagMin))) : null,
    // Each run as n of 30 closed trades since its own record start (the 30-trade judgment's count).
    runs: { mine: { count: lifetimeCount(state), target: GAP_TARGET }, ref: { count: lifetimeCount(refState), target: GAP_TARGET } },
    configDiff: diff,
  };
}

const signed = (x, unit) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x)}${unit}`;

/** One line, numbers only: paired / missed / extra, then the medians once GAP_MIN_MATCHED trades are paired. */
export function gapLine(g) {
  if (!g) return null;
  if (g.unread) return "Your run or the read’s own run couldn’t be read right now.";
  if (!g.refCount && !g.extra.length) return "No trades on either run since both started. Pairing starts with the next one.";
  let s = `Paired ${g.matched} of the read’s own ${g.refCount} trade${g.refCount === 1 ? "" : "s"} · missed ${g.missed.length} · extra ${g.extra.length}.`;
  if (g.medianEntryBps != null && g.medianLagMin != null) s += ` Median entry gap ${signed(g.medianEntryBps, " bps")} · median lag ${signed(g.medianLagMin, " min")}.`;
  else if (g.matched) s += ` Medians from ${GAP_MIN_MATCHED} paired trades (${g.matched} so far).`;
  if (g.configDiff?.entries?.length) s += ` Your config differs in ${g.configDiff.entries.join(", ")}: that changes which trades are taken, so it is a different run.`;
  return s;
}

/** The runs as counts: "Your run 3 of 30 · its own run 6 of 30". */
export function runsLine(g) {
  if (!g || g.unread || !g.runs) return null;
  return `Your run ${g.runs.mine.count} of ${g.runs.mine.target} · its own run ${g.runs.ref.count} of ${g.runs.ref.target}`;
}
