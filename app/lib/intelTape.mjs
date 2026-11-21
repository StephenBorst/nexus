// The Intel page (/intel, and the Lab's Market Intel tab): what it shows, as facts (pure, tested).
//
// The page used to tally ungraded inputs into a verdict and dress up guesses as data:
//   - "THE MARKET READ": Fear & Greed, BTC dominance, market-cap change and top-10 funding
//     weighted into one score → BULLISH / BEARISH + "the wind is behind longs". A tally of
//     ungraded reads, which the house rules forbid.
//   - "CONF 72%" on every market: 72 + funding × 40, a number shaped like a probability
//     that nothing measured.
//   - "LIQUIDATIONS 24H": dollar amounts made up from OI × an invented "typical daily liq
//     rate", split 75/25 by a label. No liquidation was read.
//   - "LONG FLUSH" / "SHORT SQUEEZE" on an account ratio: events that hadn't happened.
//   - "NET POSITIONING 60% LONG … of OI": the share of MARKETS with positive funding.
//   - "Your position context": Orderly's unsettled_pnl shown as the position's P&L (it is
//     realised-but-unsettled, not unrealised), and "tighten stops" from the tallied score.
// Now: each input on its own with its source; markets flagged by a stated threshold and
// ordered by how far past it they are; positions with their computed unrealised P&L and the
// funding they pay or receive. No score, no confidence, no advice.

export const FUNDING_LONGS_PCT = 0.08;   // funding %/8h above which longs are "crowded"
export const FUNDING_SHORTS_PCT = -0.03; // below which shorts are
export const OI_CONC_X = 1.5;            // OI ÷ 24h volume above which positions are "concentrated"
export const OI_ELEV_X = 0.9;
export const MIN_SIGNAL_VOL = 100_000;   // a ratio on a dead market is noise
export const LS_HEAVY_LONG = 1.35;
export const LS_HEAVY_SHORT = 0.75;

/**
 * What stands out on one market, and by how much. a = { funding (%), oi (USD), volume (USD) }.
 * Returns { kind, past } where `past` = how far past its threshold (1 = at it), used only to
 * order the list. kind: CROWDED_LONGS | CROWDED_SHORTS | HIGH_CONCENTRATION | ELEVATED_OI | NONE.
 */
export function marketFlag(a) {
  const f = Number(a?.funding) || 0;
  const vol = Number(a?.volume) || 0;
  const ratio = vol > 0 ? (Number(a?.oi) || 0) / vol : 0;
  if (f > FUNDING_LONGS_PCT) return { kind: "CROWDED_LONGS", past: f / FUNDING_LONGS_PCT, ratio };
  if (f < FUNDING_SHORTS_PCT) return { kind: "CROWDED_SHORTS", past: f / FUNDING_SHORTS_PCT, ratio };
  if (vol > MIN_SIGNAL_VOL && ratio > OI_CONC_X) return { kind: "HIGH_CONCENTRATION", past: ratio / OI_CONC_X, ratio };
  if (vol > MIN_SIGNAL_VOL && ratio > OI_ELEV_X) return { kind: "ELEVATED_OI", past: ratio / OI_ELEV_X, ratio };
  return { kind: "NONE", past: 0, ratio };
}

export const FLAG_LABEL = {
  CROWDED_LONGS: "Funding stretched long",
  CROWDED_SHORTS: "Funding stretched short",
  HIGH_CONCENTRATION: "OI high vs volume",
  ELEVATED_OI: "OI building vs volume",
  NONE: "Nothing stretched",
};

/** @param {string} kind @returns {string} */
export function flagLabel(kind) {
  return FLAG_LABEL[kind] ?? FLAG_LABEL.NONE;
}

const pct4 = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(4)}%`;

/** One plain line of what the numbers say. Facts and the rule that flagged it; no advice. */
export function flagLine(name, a) {
  const { kind, ratio } = marketFlag(a);
  const r = `${ratio.toFixed(1)}×`;
  if (kind === "CROWDED_LONGS") return `Longs pay ${pct4(a.funding)} per 8h on ${name}, above the ${FUNDING_LONGS_PCT}% line.`;
  if (kind === "CROWDED_SHORTS") return `Shorts pay ${pct4(-a.funding)} per 8h on ${name}, past the ${FUNDING_SHORTS_PCT}% line.`;
  if (kind === "HIGH_CONCENTRATION") return `Open interest is ${r} the last 24h of volume on ${name}, above ${OI_CONC_X}×.`;
  if (kind === "ELEVATED_OI") return `Open interest is ${r} the last 24h of volume on ${name}, above ${OI_ELEV_X}×.`;
  return `Funding ${pct4(Number(a?.funding) || 0)}, open interest ${r} 24h volume.`;
}

/** The flagged markets, furthest past their line first. */
export function flaggedMarkets(assets, max = 8) {
  return (assets || [])
    .map((a) => ({ a, f: marketFlag(a) }))
    .filter((x) => x.f.kind !== "NONE")
    .sort((x, y) => y.f.past - x.f.past)
    .slice(0, max)
    .map((x) => x.a);
}

/** An account long/short ratio in words: what it is, not an event. */
export function lsWords(ls) {
  if (ls == null || !Number.isFinite(ls)) return "—";
  if (ls > LS_HEAVY_LONG) return "MORE ACCOUNTS LONG";
  if (ls < LS_HEAVY_SHORT) return "MORE ACCOUNTS SHORT";
  return "BALANCED";
}

/** How many of the listed markets have longs paying (funding > 0). */
export function fundingBreadth(assets) {
  const list = assets || [];
  return { positive: list.filter((a) => (Number(a?.funding) || 0) > 0).length, total: list.length };
}

/** Unrealised P&L of an Orderly position row: qty × (mark − average open). null when unknown. */
export function positionUpnl(p) {
  const q = Number(p?.position_qty), m = Number(p?.mark_price), o = Number(p?.average_open_price);
  if (!Number.isFinite(q) || !(m > 0) || !(o > 0)) return null;
  return q * (m - o);
}

/**
 * What funding does to a position: a long pays positive funding, a short receives it.
 * Returns "pays" | "receives" | null (no rate / flat).
 */
export function fundingSide(qty, fundingPct) {
  const q = Number(qty), f = Number(fundingPct);
  if (!q || !Number.isFinite(f) || f === 0) return null;
  return (q > 0) === (f > 0) ? "pays" : "receives";
}

// ── Visual-first pass (borst 2026-11-21, same rules as /proof): marks against stated lines ─────────────
// Display only. Every mark is a dot against a FIXED scale with the stated line as a tick: never a bar that
// fills toward a goal, never a sum of inputs. Colour = state only: past a line = SIGNAL.watch, else ink.

/** The majors' funding percentile vs their own recorded history: the page's stated lines. */
export const PCT_HIGH = 85;
export const PCT_LOW = 15;

/** "high" (≥ 85th), "low" (≤ 15th), "normal", or null when unread. */
export function percentileState(pct) {
  const p = Number(pct);
  if (pct == null || !Number.isFinite(p)) return null;
  return p >= PCT_HIGH ? "high" : p <= PCT_LOW ? "low" : "normal";
}

/** The source's own words for the extremes (alternative.me labels "Extreme Fear" / "Extreme Greed"). */
export function fearGreedMark(fg) {
  const v = Number(fg?.value);
  if (!fg || !Number.isFinite(v)) return null;
  return { pos: Math.max(0, Math.min(100, v)), value: v, label: String(fg.label || ""), extreme: /extreme/i.test(String(fg.label || "")) };
}

/** Every market past a line, counted (uncapped, unlike the card list), split funding vs OI. */
export function stretchedCount(assets) {
  let funding = 0, oi = 0;
  for (const a of assets || []) {
    const k = marketFlag(a).kind;
    if (k === "CROWDED_LONGS" || k === "CROWDED_SHORTS") funding++;
    else if (k !== "NONE") oi++;
  }
  return { funding, oi, total: funding + oi };
}

/** Funding breadth as one mark per market, in the list's own order (by OI): true = longs pay. */
export function breadthMarks(assets) {
  return (assets || []).map((a) => ({ name: a?.name ?? "", longsPay: (Number(a?.funding) || 0) > 0 }));
}

const LINE_SCALE = 3; // a line track runs from 0 to 3× the line; the line's tick sits at a third

/**
 * A flagged market against the line that flagged it: the number, the line, and where each sits on a 0 → 3×-line
 * track. `times` = how many lines past (the list's own order). null for a market past no line.
 */
export function lineTrack(a) {
  const f = marketFlag(a);
  if (f.kind === "NONE") return null;
  const funding = f.kind === "CROWDED_LONGS" || f.kind === "CROWDED_SHORTS";
  const line = f.kind === "CROWDED_LONGS" ? FUNDING_LONGS_PCT : f.kind === "CROWDED_SHORTS" ? Math.abs(FUNDING_SHORTS_PCT)
    : f.kind === "HIGH_CONCENTRATION" ? OI_CONC_X : OI_ELEV_X;
  const value = funding ? Math.abs(Number(a.funding) || 0) : f.ratio;
  const top = line * LINE_SCALE;
  return {
    kind: f.kind, funding, value, line, times: f.past,
    nowPos: Math.min(100, (value / top) * 100), linePos: 100 / LINE_SCALE, beyond: value > top,
    side: f.kind === "CROWDED_LONGS" ? "longs pay" : f.kind === "CROWDED_SHORTS" ? "shorts pay" : null,
  };
}

/** OI ÷ 24h volume on the table's fixed 0 → 3× scale, with the two stated lines as ticks. */
export function ratioMark(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0) return null;
  const pos = (x) => Math.min(100, (x / 3) * 100);
  return { pos: pos(r), beyond: r > 3, ticks: [pos(OI_ELEV_X), pos(OI_CONC_X)] };
}

/** Is this market's FUNDING past its line (the table colours the number only then)? */
export const fundingPast = (a) => { const k = marketFlag(a).kind; return k === "CROWDED_LONGS" || k === "CROWDED_SHORTS"; };
