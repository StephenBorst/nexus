// ── Hyperliquid fill tape: merge + completeness ───────────────────────────────
// Pure + dependency-free (tested in hlTape.test.mjs). Shared by the browser read
// (@/utils/hyperliquid) and, later, the worker's per-wallet fill store, so both
// agree on what "the tape" and "partial" mean.
//
// Ground truth: Hyperliquid's public info API serves only a wallet's 10,000 MOST
// RECENT fills (userFillsByTime pages ≤2,000 at a time inside that window; plain
// userFills returns the newest ~2,000). Nothing public pages further back. So:
//   • never REPLACE one slice with another — merge every slice we read, dedupe;
//   • the tape is partial exactly when we hold HL's serving cap — older history
//     exists that no public endpoint returns.

export const HL_SERVED_MAX = 10_000;

// Stable identity for a fill. `tid` is HL's trade id; fall back to the fill's own
// fields for any row that lacks it (never observed, but never silently merge two).
export function fillKey(f) {
  if (f && f.tid !== undefined && f.tid !== null) return `t:${f.tid}`;
  return `f:${f?.coin}|${f?.time}|${f?.px}|${f?.sz}|${f?.side}|${f?.dir}`;
}

// Merge any number of fill lists → one list, deduped, oldest → newest.
export function mergeFills(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      if (!f || !Number.isFinite(Number(f.time))) continue;
      const k = fillKey(f);
      if (!byKey.has(k)) byKey.set(k, f);
    }
  }
  return [...byKey.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

// What we hold and how much of the wallet's history it covers.
//   truncated — we hold HL's serving cap, so older fills exist that we can't read
//   oldestTs  — the oldest fill held (the tape is complete from here forward)
export function tapeStatus(fills, { cap = HL_SERVED_MAX } = {}) {
  const list = Array.isArray(fills) ? fills : [];
  const oldestTs = list.length ? Number(list[0].time) : null;
  const newestTs = list.length ? Number(list[list.length - 1].time) : null;
  return { fills: list.length, truncated: list.length >= cap, oldestTs, newestTs };
}
