// Smart Money, visual-first (borst 2026-11-21, same rules as /proof and /intel). Pure; display only.
//
// What the "Consistency Score" is (lab-api logic.mjs `xrayTrack`): daily snapshots of a wallet's REALIZED P&L, graded
// window by window; score = 0.5 × green-day share + 0.3 × retention + 0.2 × drawdown control, shrunk toward 0 while the
// record is short; tiers at 40 (POSITIVE, 7+ graded days) and 65 (CONSISTENT, 14+), only when net-positive. A
// hand-weighted description of a wallet's realized days: nothing has graded it against what copying those wallets earns.
// So here it is never shown alone: the facts it's made of sit beside it, the score is a dot on its rail with the two
// stated bars as ticks, and it's labelled for what it is. Wallets sort by tier, then by how long they've been watched,
// never by the blended number alone. No new score. One source for the strip: the board's own wallets + their records.

export const SCORE_MIN_WINDOWS = 4; // xrayTrack: `scored` from 4 graded daily windows
export const TIER_BARS = Object.freeze({ POSITIVE: Object.freeze({ score: 40, windows: 7 }), CONSISTENT: Object.freeze({ score: 65, windows: 14 }) });
export const SCORE_LINE = "A description of realized P&L days, not a graded edge.";
export const STRIP_LINE = "Realized P&L on Orderly and Hyperliquid, watched daily. Not graded against copying.";

/** The stages a wallet can sit at, best first. Colour follows the stage only. */
export const STAGES = Object.freeze(["CONSISTENT", "POSITIVE", "TRACKED", "UNTIERED", "BUILDING"]);
export const STAGE_WORD = Object.freeze({
  CONSISTENT: "Consistent", POSITIVE: "Positive", TRACKED: "Tracked", UNTIERED: "Net negative, no tier", BUILDING: "Building a record",
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A wallet's stage from its tracked record (null / unscored = still building). */
export function walletStage(tk) {
  if (!tk || !tk.scored) return "BUILDING";
  const t = tk.tier?.tier;
  if (t === "CONSISTENT" || t === "POSITIVE" || t === "TRACKED") return t;
  return "UNTIERED"; // scored but net ≤ 0: xrayTrack gives no tier
}

/** The score as a dot on 0–100 with the two stated bars as ticks. null while unscored. */
export function scoreMark(tk) {
  const s = num(tk?.operatorScore);
  if (!tk?.scored || s == null) return null;
  return { pos: Math.max(0, Math.min(100, s)), score: s, ticks: [TIER_BARS.POSITIVE.score, TIER_BARS.CONSISTENT.score] };
}

/**
 * "2 of 4 daily windows" while building: how far the record is from being scored at all. Only from the record's
 * own gradedWindows (snapshots too far apart are not graded windows, so a snapshot count would overstate it);
 * without it, the snapshot count, named as such.
 */
export function buildingLine(tk) {
  const g = num(tk?.gradedWindows);
  if (g != null) return `${Math.min(Math.max(0, g), SCORE_MIN_WINDOWS)} of ${SCORE_MIN_WINDOWS} daily windows`;
  const p = num(tk?.points);
  return p ? `${p} ${p === 1 ? "snapshot" : "snapshots"} so far` : "not watched yet";
}

const usdShort = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : `${Math.round(a)}`;
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}$${s}`;
};

/** The facts the score is made of, each from the record. Unread parts are left out, never invented. */
export function recordFacts(tk) {
  if (!tk) return [];
  const out = [];
  const g = num(tk.gradedWindows), w = num(tk.winWindows);
  if (g != null && w != null && g > 0) out.push({ key: "green", text: `${w} of ${g} days green` });
  if (num(tk.netRealized) != null) out.push({ key: "net", text: `${usdShort(tk.netRealized)} realized while watched`, money: tk.netRealized });
  if (num(tk.maxDrawdown) != null && tk.maxDrawdown > 0) out.push({ key: "dd", text: `max drawdown $${Math.round(tk.maxDrawdown).toLocaleString("en-US")}` });
  if (num(tk.daysTracked) != null) out.push({ key: "days", text: `${tk.daysTracked}d watched` });
  return out;
}

/**
 * The board in the page's order: stage (best first), then how long it's been watched (graded days), then the
 * venue board's own order. Never by the blended score alone.
 */
export function sortWallets(board, trackMap = {}) {
  const rank = (t) => STAGES.indexOf(walletStage(trackMap[String(t?.address || "").toLowerCase()]));
  const days = (t) => num(trackMap[String(t?.address || "").toLowerCase()]?.gradedWindows) ?? -1;
  return (board || []).map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || days(b.t) - days(a.t) || a.i - b.i).map((x) => x.t);
}

/** The strip: wallets on the board (by venue) and how many sit at each stage. One source: the board + its records. */
export function stripCounts(board, trackMap = {}) {
  const list = board || [];
  const by = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const t of list) by[walletStage(trackMap[String(t?.address || "").toLowerCase()])]++;
  return {
    total: list.length,
    orderly: list.filter((t) => t?.source === "orderly").length,
    hl: list.filter((t) => t?.source === "hl").length,
    byStage: by,
  };
}

/** Each wallet's newest move from the live feed: the badge on its card ("opened LONG SOL"). */
export function lastMoves(events) {
  const out = {};
  for (const e of events || []) {
    const a = String(e?.addr || "").toLowerCase();
    if (!a || !(e.side === "LONG" || e.side === "SHORT")) continue;
    if (!out[a] || (Number(e.ts) || 0) > (Number(out[a].ts) || 0)) out[a] = { type: e.type, side: e.side, sym: e.sym, ts: Number(e.ts) || 0 };
  }
  return out;
}

export const NONE_SCORED_LINE = "No wallet has a scored record yet: each needs 4 daily windows watched. Listed by how long each has been watched.";

/**
 * Which wallets show at once and which fold. Building records fold behind a tap only while some wallet is
 * scored; with none scored, the building list IS the board (else the section would show nothing).
 * `sorted` = sortWallets' order.
 */
export function walletLists(sorted, trackMap = {}) {
  const st = (t) => walletStage(trackMap[String(t?.address || "").toLowerCase()]);
  const ready = (sorted || []).filter((t) => st(t) !== "BUILDING");
  const building = (sorted || []).filter((t) => st(t) === "BUILDING");
  return ready.length ? { shown: ready, folded: building, noneScored: false } : { shown: building, folded: [], noneScored: building.length > 0 };
}
