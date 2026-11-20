// ── The Signals bell: every row with its grade (v2, 2026-11-14, borst: "grade our in-house signals") ──────────
// The bell sits on top of every DEX page. v1 led with funding fades (the plain fade grades NOISE, worse than random
// entries), said "live · public · graded" over rules nothing grades, and told traders where the "lower-risk entry"
// was. v2 follows the house rules (CLAUDE.md, The Read / Briefing / FADE): inputs, never a tally or a crown; every
// row carries the grade of its exact rule, or its nearest graded relative named as such, or "not graded".
//
//   READ       a registered read with a paper wallet opened or closed a paper trade (its served stage, n of 30, and
//              its out-of-sample numbers from the scoreboard). The only rows whose rule IS graded. They lead.
//   FUNDING / FADE_ALIGN / DIVERGENCE   stretched funding (+ the graded callers' lean), labelled with the plain
//              funding fade's live grade (the nearest graded relative; this exact rule isn't graded).
//   MOMENTUM   the trend read (trend + rising OI): facts only, "Not graded".
//   TIER       a tracked wallet crossed a consistency tier: graded from that wallet's own record (X-Ray).
//
// Each row keeps a STABLE id so the bell badges only genuinely new rows. Pure + tested; the server composes it
// (lab-api routes-bell.mjs, GET /intel/bell) and the bell renders what it gets.
import { lensGradeLine } from "./fadeGrade.mjs";
import { PAPER_MIN_TRADES } from "./readPipeline.mjs";

const sideWord = (d) => (d === "LONG" ? "long" : "short");
const shortAddr = (w) => `${String(w).slice(0, 6)}…${String(w).slice(-4)}`;
// A momentum row needs rising OI (>= this %/hr) — new money, not a squeeze.
const MOMENTUM_OI_MIN = 1;
// Funding at/above this (per 8h) on the trend's side = the crowd already leans that way.
const CROWDED_FUNDING = 0.0004;
// A paper trade that closed within this window is still news.
export const READ_RECENT_MS = 24 * 3600 * 1000;

export const NOT_GRADED = "Not graded: no read on this rule is registered.";

const ago = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const fmt = (v) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));
const signedR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

/** The served stage line for a pipeline read: "Stage PAPER · 3 of 30 paper trades · out-of-sample 85 events, mean +0.31R, beats random 99%." */
export function readStageLine(read, run) {
  if (!read) return null;
  const n = read.numbers || {};
  const parts = [`Stage ${read.stage}`];
  if (run && Number.isFinite(run.count)) parts.push(`${run.count} of ${run.target ?? PAPER_MIN_TRADES} paper trades`);
  const oos = [];
  if (Number.isFinite(n.events)) oos.push(`${n.events} events`);
  if (Number.isFinite(n.meanR) && n.events > 0) oos.push(`mean ${signedR(n.meanR)}`);
  if (Number.isFinite(n.beatsRandomPct)) oos.push(`beats random ${Math.round(n.beatsRandomPct)}%`);
  const head = parts.join(" · ");
  return oos.length ? `${head} · out-of-sample ${oos.join(", ")}.` : `${head}.`;
}

/** Rows for registered reads whose paper wallet opened a trade, or closed one in the last day. */
export function readRows(scorecard, paperRuns, now = Date.now()) {
  const out = [];
  const reads = Array.isArray(scorecard?.pipeline?.reads) ? scorecard.pipeline.reads : [];
  for (const read of reads) {
    // A read failing the 100-event check (a label since 2026-11-20; RETIRED on older boards) makes no bell row or push.
    if (read.stage === "RETIRED" || (Array.isArray(read.failing) && read.failing.length)) continue;
    const run = paperRuns?.[read.axis];
    if (!run || run.ok === false) continue;
    const label = (scorecard.axes || []).find((a) => a && a.name === read.axis)?.label || read.axis;
    const graded = readStageLine(read, run);
    const o = run.open;
    if (o && o.coin && o.side) {
      const t = Date.parse(o.openedAt) || now;
      out.push({ id: `read-open-${read.axis}-${o.coin}-${o.side}-${t}`, kind: "READ", priority: 95, ts: t, tab: "intel", path: `/proof/paper/${read.axis}`,
        title: `${o.coin}: a registered read opened a paper ${sideWord(o.side)}`,
        detail: `${label}. Opened ${ago(now - t)} on its paper wallet; it closes on its own stop, target or clock.`, graded });
      continue;
    }
    const last = Array.isArray(run.trades) ? run.trades[run.trades.length - 1] : null;
    const tc = last ? Date.parse(last.closedAt) : NaN;
    if (last && Number.isFinite(tc) && now - tc <= READ_RECENT_MS) {
      const r = Number.isFinite(last.r) ? `, ${signedR(last.r)}` : "";
      out.push({ id: `read-close-${read.axis}-${last.n ?? tc}`, kind: "READ", priority: 80, ts: tc, tab: "intel", path: `/proof/paper/${read.axis}`,
        title: `${last.coin}: a registered read closed a paper ${sideWord(last.side)} (${String(last.outcome || last.reason || "").toLowerCase()}${r})`,
        detail: `${label}. Closed ${ago(now - tc)}; one trade of the run, judged at 30.`, graded });
    }
  }
  return out;
}

export function buildSignals({ signals, consensus, xrayEvents, scorecard, paperRuns, now = Date.now() } = {}) {
  const out = [];
  const fadeGraded = lensGradeLine("funding", scorecard) ?? "Not graded: this exact rule isn't graded; the fade's grade is unread right now.";

  // 0 — Registered reads that just acted on their paper wallets: the only rows whose rule is graded.
  out.push(...readRows(scorecard, paperRuns, now));

  // 1 — Stretched funding, with the graded callers' lean beside it. Inputs, never "they agree, so…".
  const funded = [...(signals || [])]
    .filter((s) => s && Math.abs(Number(s.funding_rate_8h)) >= 0.0004)
    .sort((a, b) => Math.abs(Number(b.funding_rate_8h)) - Math.abs(Number(a.funding_rate_8h)))
    .slice(0, 4);
  for (const s of funded) {
    const f = Number(s.funding_rate_8h);
    const fadeDir = f > 0 ? "SHORT" : "LONG";
    const crowdSide = f > 0 ? "LONG" : "SHORT";
    const lean = consensus?.[s.symbol] || null;
    const agree = !!(lean && lean.side === fadeDir);
    const fight = !!(lean && lean.side !== fadeDir && lean.side !== "SPLIT");
    const fundPct = (f * 100).toFixed(3);
    const who = `${sideWord(crowdSide)}s pay ${Math.abs(f * 100).toFixed(3)}%/8h`;
    if (agree) {
      out.push({ id: `fade-align-${s.symbol}-${fadeDir}`, kind: "FADE_ALIGN", priority: 46, ts: now, tab: "intel",
        title: `${s.symbol}: funding stretched, graded callers lean ${sideWord(lean.side)}`,
        detail: `${who[0].toUpperCase()}${who.slice(1)}. The callers' lean points the same way as the fade (${sideWord(fadeDir)}). Two inputs, not a verdict.`, graded: fadeGraded });
    } else if (fight) {
      out.push({ id: `fade-div-${s.symbol}`, kind: "DIVERGENCE", priority: 45, ts: now, tab: "smart",
        title: `${s.symbol}: funding and the graded callers point opposite ways`,
        detail: `${who[0].toUpperCase()}${who.slice(1)}, so the fade would be ${sideWord(fadeDir)}; the graded callers lean ${sideWord(lean.side)}.`, graded: fadeGraded });
    } else {
      out.push({ id: `fund-${s.symbol}-${fadeDir}`, kind: "FUNDING", priority: 40, ts: now, tab: "intel",
        title: `${s.symbol} funding stretched ${fundPct}%/8h`,
        detail: `${who[0].toUpperCase()}${who.slice(1)}: the crowd is heavily ${sideWord(crowdSide)}. The fade (${sideWord(fadeDir)}) is a mechanical rule.`, graded: fadeGraded });
    }
  }

  // 2 — Momentum: the strongest-trending core symbol with rising OI. Facts only; no read grades this rule.
  const trending = (signals || [])
    .filter((s) => s && (s.trend === "TREND_UP" || s.trend === "TREND_DOWN") && (Number(s.trend_oi_pct) || 0) >= MOMENTUM_OI_MIN)
    .sort((a, b) => Math.abs(Number(b.trend_move_pct) || 0) - Math.abs(Number(a.trend_move_pct) || 0));
  const mom = trending[0];
  if (mom) {
    const dir = mom.trend === "TREND_UP" ? "LONG" : "SHORT";
    const move = Number(mom.trend_move_pct) || 0;
    const oi = Number(mom.trend_oi_pct) || 0;
    const fund = Number(mom.funding_rate_8h) || 0;
    const crowded = (dir === "LONG" && fund >= CROWDED_FUNDING) || (dir === "SHORT" && fund <= -CROWDED_FUNDING);
    const fundNote = crowded ? ` Funding already leans ${sideWord(dir)} (${(fund * 100).toFixed(3)}%/8h).` : "";
    const ema8 = Number(mom.ema8_4h) || null;
    const mark = Number(mom.mark_price) || null;
    let levelNote = "";
    if (ema8 && mark) {
      const distPct = ((mark - ema8) / ema8) * 100;
      levelNote = Math.abs(distPct) < 0.05
        ? ` Price sits on its 4H EMA8 ($${fmt(ema8)}).`
        : ` Price is ${Math.abs(distPct).toFixed(1)}% ${distPct > 0 ? "above" : "below"} its 4H EMA8 ($${fmt(ema8)}).`;
    }
    out.push({ id: `mom-${mom.symbol}-${dir}`, kind: "MOMENTUM", priority: 50, ts: now, tab: "intel",
      title: `${mom.symbol} is trending ${dir === "LONG" ? "up" : "down"}, open interest rising`,
      detail: `${move >= 0 ? "+" : "−"}${Math.abs(move)}% over the trend window, open interest +${oi}%/hr.${levelNote}${fundNote}`, graded: NOT_GRADED });
  }

  // 3 — Tracked-wallet tier crossings (a watched wallet earned/lost a consistency tier).
  for (const e of (xrayEvents || []).slice(0, 6)) {
    if (!e || !e.wallet) continue;
    const up = e.kind === "TIER_UP";
    const day = Math.floor((Number(e.ts) || now) / 86400000); // stable per calendar day
    out.push({ id: `tier-${String(e.wallet).toLowerCase()}-${e.toTier || "none"}-${day}`, kind: "TIER", priority: up ? 55 : 42, ts: Number(e.ts) || now, tab: "smart",
      title: `${shortAddr(e.wallet)} ${up ? "earned" : "dropped to"} ${e.toTier || "no tier"}`,
      detail: up ? "A tracked wallet crossed into a higher consistency tier." : "A tracked wallet slipped below its tier.",
      graded: "Graded from that wallet's own record (X-Ray), not a market read." });
  }

  return out.sort((a, b) => b.priority - a.priority || b.ts - a.ts).slice(0, 8);
}

// How many of the current signals are NEW (id not in the seen set). Pure so the badge
// count is testable and identical to what the panel renders.
export function countUnseen(list, seen) {
  const s = seen instanceof Set ? seen : new Set(Object.keys(seen || {}));
  return (list || []).reduce((n, sig) => n + (sig && !s.has(sig.id) ? 1 : 0), 0);
}

