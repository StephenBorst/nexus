// The Thesis Engine before a coin is picked, and the facts right before Post (borst 2026-11-21). Pure, tested
// (callStart.test.mjs).
//
// startingPoints: one-tap coins to start a call from. Three sources, each a FACT about the coin, never a side:
//   • your coins (the device watchlist, the drawer's ☆),
//   • markets past a stated funding line (the Intel tape's own lines, intelTape.mjs), ordered by how far past,
//   • coins other callers have an open call on right now (/calls/pulse, people and engines counted apart).
// A chip fills the symbol only. The side stays the trader's pick.
//
// prePostFacts: what the levels mean before the call is permanent. Stated lines, numbers, no advice:
//   • the stop against the coin's live H4 ATR (< 1× sits inside one ordinary 4h bar; > 4× is wide),
//   • whether the entry counts as filled at the post (within ENTRY_AT_MARK_PCT of the mark, the grader's rule) or
//     rests until price trades there,
//   • at a stated leverage, how much of the margin the stop costs,
//   • the trader's own graded record on this coin (from their own Lab record).

import { FUNDING_LONGS_PCT, FUNDING_SHORTS_PCT } from "./intelTape.mjs";
import { ENTRY_AT_MARK_PCT } from "./entryAtMark.mjs";

export const START_MAX = 6;
export const ATR_TIGHT = 1;   // stop under 1× the H4 ATR: inside one ordinary 4h bar
export const ATR_WIDE = 4;    // stop over 4× the H4 ATR: a wide stop for a 1.5R-style target
export const MARGIN_WATCH_PCT = 80; // a stop that costs ≥ 80% of the margin at the stated leverage

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null);
const up = (s) => String(s ?? "").trim().toUpperCase().replace(/^PERP_|_USDC$/g, "");
const pct = (v, d = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;

/** How far past its funding line a market sits (×), or null when inside both lines / unread. */
export function fundingPast(f8h) {
  const f = num(f8h);
  if (f == null) return null;
  if (f > FUNDING_LONGS_PCT) return { side: "longs", past: f / FUNDING_LONGS_PCT };
  if (f < FUNDING_SHORTS_PCT) return { side: "shorts", past: f / FUNDING_SHORTS_PCT };
  return null;
}

/**
 * @param {{ watch?: string[], markets?: Array<{coin?:string, symbol?:string, funding8hPct?:number}>, openCalls?: Array<{symbol?:string, engine?:boolean}>, listed?: Set<string> | string[] | null }} input
 * @returns {Array<{ key: string, title: string, note: string, chips: Array<{ coin: string, fact: string }> }>}
 */
export function startingPoints({ watch = [], markets = [], openCalls = [], listed = null } = {}) {
  const ok = listed ? new Set([...(listed)].map(up)) : null;
  const allowed = (c) => !!c && (!ok || ok.has(c));
  const groups = [];

  const yours = [...new Set((watch || []).map(up))].filter(allowed).slice(0, START_MAX);
  if (yours.length) groups.push({ key: "yours", title: "Your coins", note: "Your watchlist on this device.", chips: yours.map((coin) => ({ coin, fact: "watching" })) });

  const stretched = (markets || [])
    .map((m) => ({ coin: up(m.coin || m.symbol), f: num(m.funding8hPct) }))
    .map((m) => ({ ...m, p: fundingPast(m.f) }))
    .filter((m) => m.p && allowed(m.coin))
    .sort((a, b) => b.p.past - a.p.past);
  const seen = new Set();
  const sChips = [];
  for (const m of stretched) {
    if (seen.has(m.coin)) continue;
    seen.add(m.coin);
    sChips.push({ coin: m.coin, fact: `${m.p.side} pay ${pct(m.f)} / 8h` });
    if (sChips.length >= START_MAX) break;
  }
  if (sChips.length) groups.push({ key: "funding", title: "Past a funding line", note: `Funding above +${FUNDING_LONGS_PCT}% or below ${FUNDING_SHORTS_PCT}% per 8h. A fact, not a side.`, chips: sChips });

  const counts = new Map();
  for (const c of openCalls || []) {
    const coin = up(c?.symbol);
    if (!allowed(coin)) continue;
    const r = counts.get(coin) || { people: 0, engines: 0 };
    if (c.engine) r.engines++; else r.people++;
    counts.set(coin, r);
  }
  const cChips = [...counts.entries()]
    .sort((a, b) => (b[1].people + b[1].engines) - (a[1].people + a[1].engines) || a[0].localeCompare(b[0]))
    .slice(0, START_MAX)
    .map(([coin, r]) => ({ coin, fact: [r.people ? `${r.people} ${r.people === 1 ? "person" : "people"}` : null, r.engines ? `${r.engines} engine${r.engines === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") + " open" }));
  if (cChips.length) groups.push({ key: "callers", title: "Callers on it now", note: "Coins with an open public call. Who’s on it, not which way.", chips: cChips });

  return groups;
}

/**
 * @param {{ direction: "LONG"|"SHORT", entry: number, stop: number, atrPct?: number|null, mark?: number|null, leverage?: number|null, symbol?: string, myCalls?: Array<{symbol?:string, isPublic?:boolean, gradedOutcome?:string, gradedR?:number}> }} p
 * @returns {Array<{ key: string, text: string, watch: boolean }>}
 */
export function prePostFacts({ direction, entry, stop, atrPct = null, mark = null, leverage = null, symbol = "", myCalls = [] } = {}) {
  const out = [];
  const e = num(entry), s = num(stop);
  if (!(e > 0) || !(s > 0)) return out;
  const stopPct = Math.abs(e - s) / e * 100;

  const a = num(atrPct);
  if (a != null && a > 0) {
    const k = stopPct / a;
    const tail = k < ATR_TIGHT ? ": inside one ordinary 4h bar, so normal noise can reach it"
      : k > ATR_WIDE ? ": a wide stop, so each R is a big move" : "";
    out.push({ key: "atr", text: `Stop ${stopPct.toFixed(2)}% = ${k.toFixed(1)}× the H4 ATR (${a.toFixed(2)}%)${tail}.`, watch: k < ATR_TIGHT || k > ATR_WIDE });
  }

  const m = num(mark);
  if (m != null && m > 0) {
    const d = (e - m) / m * 100;
    if (Math.abs(d) <= ENTRY_AT_MARK_PCT) out.push({ key: "fill", text: `Entry is at the mark (${pct(d, 2)}): it counts as filled when you post.`, watch: false });
    else {
      const long = direction !== "SHORT";
      const kind = (long && d > 0) || (!long && d < 0) ? "a breakout entry" : "a resting limit";
      out.push({ key: "fill", text: `Entry is ${Math.abs(d).toFixed(2)}% ${d > 0 ? "above" : "below"} the mark, ${kind}: it counts only once price trades there.`, watch: false });
    }
  }

  const lev = num(leverage);
  if (lev != null && lev > 0) {
    const cost = stopPct * lev;
    out.push({ key: "margin", text: `At ${+lev.toFixed(1)}× the stop costs ${cost.toFixed(0)}% of the margin.`, watch: cost >= MARGIN_WATCH_PCT });
  }

  const sym = up(symbol);
  if (sym) {
    const mine = (myCalls || []).filter((t) => up(t?.symbol) === sym && (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS"));
    if (!mine.length) out.push({ key: "record", text: `No graded ${sym} calls of yours yet.`, watch: false });
    else {
      const wins = mine.filter((t) => t.gradedOutcome === "WIN").length;
      const rs = mine.map((t) => num(t.gradedR)).filter((r) => r != null);
      const net = rs.reduce((x, y) => x + y, 0);
      out.push({ key: "record", text: `Your graded ${sym} calls: ${mine.length} · ${wins} won${rs.length ? ` · ${net >= 0 ? "+" : "−"}${Math.abs(net).toFixed(2)}R net` : ""}.`, watch: false });
    }
  }
  return out;
}
