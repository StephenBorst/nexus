// ── Your copy, beside the call you copied (borst 2026-11-26, "Copy Trades: pick up") ──────────────────────────────
// A copy is private, and the grader grades only PUBLIC calls (grading.mjs), so a copy never gets a grade of its own:
// the tab used to show "3 copies · 3 open" long after the originals hit their target or stop. The original IS graded
// (same levels, from public price), so each copy now reads its original from the public feed:
//   · findOriginal: by the id saved on the copy (`copiedFromId`, saved since 2026-11-26), else the caller's public call
//     with the same coin, side, entry and stop posted before the copy (older copies),
//   · originalState: the grader's own outcome in words (won / stopped / time stop / open / waiting for its entry /
//     expired unfilled / invalid),
//   · planDrift: what you changed from the caller's plan (a changed stop or target = a different trade, so the
//     original's grade is the caller's, not yours),
//   · copyTiming: how long after the post you copied, and whether its entry had already traded by then.
// Pure + tested (copyMatch.test.mjs). Facts only: never "copy more", never a verdict on the caller beyond the grader's.

const n = (v) => (v == null || v === "" ? NaN : Number(v));
const same = (a, b) => {
  const x = n(a), y = n(b);
  if (!Number.isFinite(x) && !Number.isFinite(y)) return true;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * 1e-9;
};
const at = (t) => n(t?.publishedAt ?? t?.createdAt);

/** The original call this copy was made from, among the CALLER's public rows (feed rows of that wallet). */
export function findOriginal(copy, callerRows) {
  const rows = (Array.isArray(callerRows) ? callerRows : []).filter((t) => t && !t.resolution && !t.duplicateOf);
  if (copy?.copiedFromId) {
    const hit = rows.find((t) => String(t.id) === String(copy.copiedFromId));
    if (hit) return hit;
  }
  const sym = String(copy?.symbol || "").toUpperCase();
  const cand = rows.filter((t) => String(t.symbol || "").toUpperCase() === sym && t.direction === copy?.direction
    && same(t.entryPrice, copy?.entryPrice) && same(t.stopLoss, copy?.stopLoss)
    && (!Number.isFinite(at(t)) || !Number.isFinite(n(copy?.createdAt)) || at(t) <= n(copy.createdAt)));
  return cand.sort((a, b) => (at(b) || 0) - (at(a) || 0))[0] ?? null;
}

/**
 * The original's state, the grader's words. kind: WON | STOPPED | TIME | OPEN | WAITING | EXPIRED | INVALID | MISSING.
 * @returns {{ kind: string, r: number|null, line: string }}
 */
export function originalState(o) {
  if (!o) return { kind: "MISSING", r: null, line: "The original isn’t in the public feed (made before it was public, or holders-only)." };
  const r = Number.isFinite(n(o.gradedR)) ? Math.round(n(o.gradedR) * 100) / 100 : null;
  const rTxt = r == null ? "" : ` ${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
  const how = o.exitReason === "TIME" ? " at its time stop" : o.exitReason === "TRAIL" ? " on its trail" : o.exitReason === "BE" ? " at breakeven" : "";
  if (o.gradedOutcome === "WIN") return { kind: o.exitReason === "TIME" ? "TIME" : "WON", r, line: `The original won${rTxt}${how}.` };
  if (o.gradedOutcome === "LOSS") return { kind: o.exitReason === "TIME" ? "TIME" : "STOPPED", r, line: `The original lost${rTxt}${how || " at its stop"}.` };
  if (o.status === "INVALIDATED" || o.gradedOutcome === "INVALID") return { kind: "INVALID", r: null, line: "The original is not graded (its levels were on the wrong side)." };
  if (o.fillState === "EXPIRED" || o.status === "EXPIRED") return { kind: "EXPIRED", r: null, line: "The original’s entry never traded: it expired unfilled. Not a win, not a loss." };
  if (o.fillState === "OPEN" || o.filledAt) return { kind: "OPEN", r: null, line: "The original is open: its entry traded, no target or stop yet." };
  return { kind: "WAITING", r: null, line: "The original is waiting for its entry to trade." };
}

const LEVELS = [
  ["entryPrice", "entry"], ["stopLoss", "stop"], ["takeProfit1", "target"], ["takeProfit2", "second target"],
];
/** What the copy changed from the caller's plan. [] = the same plan. */
export function planDrift(copy, o) {
  if (!copy || !o) return [];
  const out = [];
  for (const [k, word] of LEVELS) if (!same(copy[k], o[k])) out.push({ field: word, from: o[k] ?? null, to: copy[k] ?? null });
  if ((copy.exitPlan || null) !== (o.exitPlan || null)) out.push({ field: "exit plan", from: planWord(o.exitPlan), to: planWord(copy.exitPlan) });
  if (!same(copy.timeStopH, o.timeStopH)) out.push({ field: "time stop", from: o.timeStopH ?? null, to: copy.timeStopH ?? null });
  if (!same(copy.fillWithinH, o.fillWithinH)) out.push({ field: "order expiry", from: o.fillWithinH ?? null, to: copy.fillWithinH ?? null });
  return out;
}

const planWord = (p) => (p === "SPLIT_50" ? "half at each target" : p === "SPLIT_50_BE" ? "half at the target, the rest trails" : "one target");
const fmt = (v) => {
  if (typeof v === "string" && !Number.isFinite(Number(v))) return v;
  const x = n(v);
  if (!Number.isFinite(x)) return "none";
  return x >= 1000 ? Math.round(x).toLocaleString("en-US") : String(Number(x.toPrecision(6)));
};
/** "Same plan as the original." / "You changed the stop (61,200 → 60,800). The original's grade is the caller's plan, not yours." */
export function driftLine(d) {
  if (!d.length) return "Same plan as the original.";
  const parts = d.map((x) => `the ${x.field} (${fmt(x.from)} → ${fmt(x.to)})`);
  return `You changed ${parts.join(", ")}. The original’s grade is the caller’s plan, not yours.`;
}

/** "Copied 3h after the post, after its entry had traded." */
export function copyTiming(copy, o) {
  const c = n(copy?.createdAt), p = at(o);
  if (!Number.isFinite(c) || !Number.isFinite(p) || c < p) return null;
  const m = Math.round((c - p) / 60_000);
  const gap = m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  const filled = n(o?.filledAt);
  const after = Number.isFinite(filled) && filled <= c ? ", after its entry had traded (the market had moved on from the post)" : "";
  return `Copied ${gap} after the post${after}.`;
}

/** The originals of your copies, counted: "Their originals: 2 won · 1 stopped · 1 open (+1.80R on the 3 graded)". */
export function originalsLine(states) {
  const c = { WON: 0, STOPPED: 0, TIME: 0, OPEN: 0, WAITING: 0, EXPIRED: 0, INVALID: 0, MISSING: 0 };
  let r = 0, graded = 0;
  for (const s of states || []) {
    c[s.kind] = (c[s.kind] || 0) + 1;
    if (s.r != null && (s.kind === "WON" || s.kind === "STOPPED" || s.kind === "TIME")) { r += s.r; graded++; }
  }
  const parts = [];
  if (c.WON) parts.push(`${c.WON} won`);
  if (c.STOPPED) parts.push(`${c.STOPPED} stopped`);
  if (c.TIME) parts.push(`${c.TIME} at a time stop`);
  if (c.OPEN) parts.push(`${c.OPEN} open`);
  if (c.WAITING) parts.push(`${c.WAITING} waiting for entry`);
  if (c.EXPIRED) parts.push(`${c.EXPIRED} expired unfilled`);
  if (c.INVALID) parts.push(`${c.INVALID} not graded`);
  if (c.MISSING) parts.push(`${c.MISSING} not found`);
  if (!parts.length) return null;
  const rr = Math.round(r * 100) / 100;
  return `Their originals: ${parts.join(" · ")}${graded ? ` (${rr >= 0 ? "+" : "−"}${Math.abs(rr).toFixed(2)}R on the ${graded} graded)` : ""}.`;
}
