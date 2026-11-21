// ── A Hyperliquid wallet's watched record (borst 2026-11-21) ──────────────────
// Pure + tested (hlRecord.test.mjs). The Smart Money board's Hyperliquid wallets had no daily record: the snapshot read
// Orderly brokers only, so they sat at "building" forever. Hyperliquid has no lifetime realized-P&L figure to snapshot,
// and its API serves only the newest 10k fills, so the record is built from the fill tape we collect forward
// (app/lib/hlTape.mjs): each daily row's `realized` = the sum of closed P&L net of fees over every fill since the
// record's first day (its ANCHOR). The same xrayTrack grades it as an Orderly record (the deltas between rows).
//
// Forward only, like the Orderly record: the first row is the anchor (realized 0); fills before it never count.
// A read that can't be complete since the anchor is never stored (it would book missing fills as a day of P&L):
//   unread — no tape; stale — the tape wasn't synced just now; gap — the tape is only complete from after the anchor.

export const HL_SYNC_FRESH_MS = 5 * 60 * 1000; // a tape row counts only if synced within this before the row

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** The record's anchor: where its realized sum starts (the first row's own time). null = no row yet. */
export function hlAnchor(hist) {
  const first = Array.isArray(hist) && hist.length ? hist[0] : null;
  if (!first) return null;
  return Number.isFinite(first.anchor) ? first.anchor : Number.isFinite(first.t) ? first.t : null;
}

/**
 * One row from a synced tape. `tape` = the stored record ({ fills: compact rows, completeFrom, syncedAt }).
 * Returns { row } or { refused: "unread" | "stale" | "gap" }.
 */
export function hlRealizedRow(tape, { anchor, now }) {
  if (!tape || !Array.isArray(tape.fills)) return { refused: "unread" };
  const at = Number(tape.syncedAt);
  if (!Number.isFinite(at) || now - at > HL_SYNC_FRESH_MS || at > now + 60_000) return { refused: "stale" };
  const from = anchor == null ? at : anchor;
  if (tape.completeFrom != null && Number(tape.completeFrom) > from) return { refused: "gap" };
  let realized = 0;
  const byCoin = new Map();
  for (const f of tape.fills) {
    // compact row: [tid, time, coin, px, sz, side, dir, closedPnl, fee]
    const t = Number(f[1]);
    if (!(t >= from && t <= at)) continue;
    const net = n(f[7]) - n(f[8]);
    realized += net;
    byCoin.set(f[2], (byCoin.get(f[2]) || 0) + net);
  }
  let wins = 0, losses = 0;
  for (const v of byCoin.values()) { if (v > 0) wins++; else if (v < 0) losses++; }
  return {
    row: {
      t: at, anchor: from, realized: Math.round(realized * 100) / 100, unrealized: null,
      markets: byCoin.size, wins, losses, open: null, venue: "hl",
    },
  };
}

/**
 * The next row for a stored series, or why none: { row } | { skip: "fresh" } | { refused }.
 * `minGapMs` = the same ~daily throttle as the Orderly record.
 */
export function nextHlRow(hist, tape, { now, minGapMs }) {
  const list = Array.isArray(hist) ? hist : [];
  const last = list[list.length - 1];
  if (last && Number.isFinite(last.t) && now - last.t < minGapMs) return { skip: "fresh" };
  return hlRealizedRow(tape, { anchor: hlAnchor(list), now });
}
