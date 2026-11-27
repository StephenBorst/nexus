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

import { readPaperConfig } from "./housePaper.mjs";
import { tradeR } from "./paperRun.mjs";

export const PAIR_WINDOW_MIN = 10;
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
const worseBps = (mine, ref, side, leg) => {
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
      entryBps: worseBps(b.entry, a.entry, a.side, "entry"),
      exitBps: a.open || b.open ? null : worseBps(b.exit, a.exit, a.side, "exit"),
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
  return {
    ...base, from: from ? new Date(from).toISOString() : null,
    refCount: ref.filter((_, i) => usedR.has(i) || now - ref[i].openedMs > PAIR_WINDOW_MIN * 60000).length,
    matched: pairs.length, missed, extra, pairs,
    medianEntryBps: entryGaps.length ? r1(median(entryGaps)) : null,
    medianLagMin: pairs.length ? r1(median(pairs.map((p) => p.lagMin))) : null,
    configDiff: diff,
  };
}

/** One plain line. */
export function gapLine(g) {
  if (!g) return null;
  if (g.unread) return "Your run or the reference run couldn’t be read right now.";
  if (!g.refCount && !g.extra.length) return "No trades on either run since both started. The comparison starts with the next one.";
  const parts = [`You took ${g.matched} of the reference run’s ${g.refCount} trade${g.refCount === 1 ? "" : "s"}`];
  if (g.missed.length) parts.push(`missed ${g.missed.length}`);
  if (g.extra.length) parts.push(`took ${g.extra.length} it didn’t`);
  let s = parts.join(", ") + ".";
  if (g.matched) {
    const b = g.medianEntryBps ?? 0, lag = g.medianLagMin ?? 0;
    const price = b === 0 ? "Entries at the same price (median)" : `Entries a median ${Math.abs(b)} bps ${b > 0 ? "worse" : "better"}`;
    s += ` ${price}, ${lag === 0 ? "in the same minute" : `${Math.abs(lag)} min ${lag > 0 ? "later" : "earlier"}`}.`;
  }
  if (g.configDiff?.entries?.length) s += ` Your config differs in ${g.configDiff.entries.join(", ")}: that changes which trades are taken, so it is a different run.`;
  return s;
}
