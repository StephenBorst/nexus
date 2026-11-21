// The Trading Agent tab before a wallet connects (borst 2026-11-21): live proof instead of a feature list. Pure,
// tested (agentShowcase.test.mjs).
//
// What it shows, each from a public route, each a COUNT or a state, never an R, a sum or a dollar figure:
//   • every registered read's own paper agent (GET /signals/paper-counts): n of 30 trades, a trade open now. The same
//     agent code a user runs in PAPER; the 30-trade judgment is what grades it.
//   • whether live entries are open or paused platform-wide (GET /ops/halt; unread = said so, never "open").
//   • how many live agents publish their positions right now (GET /agents/live).
// An unread source says "unread", never 0.

export const PAPER_TARGET = 30;
const ACRONYMS = new Set(["oi", "rsi", "btc", "bb", "cvd", "atr", "4h", "2x", "1h"]);

/** "oi_div_reversal_4h" → "OI div reversal 4h". */
export function readTitle(id) {
  const words = String(id || "").split("_").filter(Boolean);
  return words.map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase().replace(/^(\d+)([A-Z])$/, (_, n, u) => n + u.toLowerCase()) : i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * @param {{ runs?: Record<string, {count?:number, target?:number, open?:boolean, unread?:boolean, house?:boolean}> } | null} reply
 * @returns {{ rows: Array<{ id: string, title: string, count: number|null, target: number, open: boolean, house: boolean, unread: boolean }>, trades: number, openNow: number, unread: boolean }}
 */
export function paperRows(reply) {
  if (!reply || typeof reply.runs !== "object" || !reply.runs) return { rows: [], trades: 0, openNow: 0, unread: true };
  const rows = Object.entries(reply.runs).map(([id, r]) => {
    const n = Number(r?.count);
    const unread = !!r?.unread || !Number.isFinite(n);
    return { id, title: readTitle(id), count: unread ? null : n, target: Number(r?.target) || PAPER_TARGET, open: !!r?.open, house: !!r?.house, unread };
  });
  // Furthest along first, then a trade open now, then by name. Unread rows last, never counted as 0.
  rows.sort((a, b) => (a.unread - b.unread) || ((b.count ?? -1) - (a.count ?? -1)) || (b.open - a.open) || a.title.localeCompare(b.title));
  const read = rows.filter((r) => !r.unread);
  return { rows, trades: read.reduce((s, r) => s + r.count, 0), openNow: read.filter((r) => r.open).length, unread: false };
}

/** One line on live entries. null reply = unread. */
export function haltLine(reply) {
  if (!reply || typeof reply.halted !== "boolean") return { text: "Live entries: status unread right now.", paused: null };
  return reply.halted
    ? { text: "Live entries are paused platform-wide by the owner. Exits, stops and kills still run.", paused: true }
    : { text: "Live entries are open. The owner can pause every live entry at once; exits and kills keep running.", paused: false };
}

/** Live agents publishing positions now. */
export function liveLine(reply) {
  const n = Number(reply?.count);
  if (!reply || !Number.isFinite(n)) return "Live agents: unread right now.";
  return n === 0 ? "No live agent is publishing a position right now." : `${n} live agent${n === 1 ? " is" : "s are"} publishing ${n === 1 ? "its" : "their"} positions right now.`;
}

/** The headline under the runs: counts only. */
export function runsSummary({ rows, trades, openNow, unread }) {
  if (unread) return "The paper runs are unread right now.";
  if (!rows.length) return "No paper runs yet.";
  return `${rows.length} reads, each with its own paper agent · ${trades} trades so far · ${openNow} open now. Each is judged at ${PAPER_TARGET} trades, after fees.`;
}
