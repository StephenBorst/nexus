// Two wallets side by side on the X-Ray (borst 2026-11-21). Pure, tested (xrayCompare.test.mjs).
//
// Same grade, same windows, same copy gate as a single X-Ray (xrayGrade.mjs): nothing new is computed here, only laid
// out in two columns. No winner, no combined score: each row states each wallet's own number, an ungraded window says
// how far it is from grading, and an unread source says "unread", never 0. Colour = money sign only.

import { fmtPf } from "./xrayGrade.mjs";

export const COMPARE_WINDOWS = ["7D", "30D", "ALL"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const usd = (n) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}$${s}`;
};
const tone = (n) => (n == null ? null : n > 0 ? "pos" : n < 0 ? "neg" : null);

/** One wallet's cell for a Hyperliquid window grade. */
export function windowCell(side, key) {
  if (!side || side.unread) return { text: "unread", tone: "muted" };
  const g = side.grades?.[key];
  if (!g) return { text: "no Hyperliquid tape", tone: "muted" };
  if (g.status !== "GRADED") return { text: `${g.trades} of ${g.min} trades to grade`, tone: "muted" };
  const parts = [usd(g.net), `PF ${fmtPf(g.pf)}`];
  if (num(g.winRate) != null) parts.push(`${Math.round(g.winRate)}% win`);
  parts.push(`${g.trades} trades`);
  return { text: parts.join(" · "), tone: tone(g.net) };
}

/** The watched record (realized P&L deltas since we started watching). */
export function watchedCell(side) {
  if (!side || side.unread) return { text: "unread", tone: "muted" };
  const t = side.track;
  if (!t || t.building || num(t.netRealized) == null) return { text: "not watched long enough yet", tone: "muted" };
  const days = num(t.daysTracked);
  return { text: `${usd(t.netRealized)}${days != null ? ` over ${days}d watched` : ""}`, tone: tone(t.netRealized) };
}

/** Lifetime realized (Hyperliquid tape + Orderly indexer), context only: lifetime flatters. */
export function lifetimeCell(side) {
  if (!side || side.unread) return { text: "unread", tone: "muted" };
  const hl = num(side.hlLifetime), or = num(side.orderlyRealized);
  if (hl == null && or == null) return { text: "no perp record found", tone: "muted" };
  const total = (hl ?? 0) + (or ?? 0);
  const venues = [hl != null ? "HL" : null, or != null ? "Orderly" : null].filter(Boolean).join(" + ");
  return { text: `${usd(total)} · ${venues}`, tone: tone(total) };
}

export function gateCell(side) {
  if (!side || side.unread) return { text: "unread", tone: "muted" };
  if (!side.gate) return { text: "—", tone: "muted" };
  return side.gate.pass
    ? { text: "Clears the copy gate", tone: null, pass: true }
    : { text: `Locked: ${side.gate.reasons?.[0] ?? "no graded evidence"}`, tone: "muted", pass: false };
}

export function openCell(side) {
  if (!side || side.unread) return { text: "unread", tone: "muted" };
  const n = num(side.openPositions);
  return n == null ? { text: "unread", tone: "muted" } : { text: n ? `${n} open` : "flat", tone: null };
}

/** The table: one row per fact, both wallets. */
export function compareRows(a, b) {
  return [
    ...COMPARE_WINDOWS.map((k) => ({ key: `win:${k}`, label: `Hyperliquid ${k}`, a: windowCell(a, k), b: windowCell(b, k) })),
    { key: "watched", label: "Watched record", a: watchedCell(a), b: watchedCell(b) },
    { key: "lifetime", label: "Lifetime realized", a: lifetimeCell(a), b: lifetimeCell(b), note: "context only" },
    { key: "open", label: "Open now", a: openCell(a), b: openCell(b) },
    { key: "gate", label: "Copy gate (30D)", a: gateCell(a), b: gateCell(b) },
  ];
}

/** One sentence under the table: the gate, both ways. Never a winner. */
export function compareLine(a, b, la = "A", lb = "B") {
  const pa = a && !a.unread && a.gate ? a.gate.pass : null;
  const pb = b && !b.unread && b.gate ? b.gate.pass : null;
  if (pa == null || pb == null) return "One wallet is still loading or unread, so the gate can’t be compared yet.";
  if (pa && pb) return "Both clear the copy gate on their own records.";
  if (!pa && !pb) return "Neither clears the copy gate yet.";
  return `${pa ? la : lb} clears the copy gate; ${pa ? lb : la} doesn’t.`;
}
