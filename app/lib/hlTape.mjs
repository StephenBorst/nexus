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

// ── The stored tape (worker KV, forward collection) ───────────────────────────
// HL forgets anything older than its 10k window, so the worker keeps what it has seen
// and extends it on every sync. From a wallet's first view on, no fill is lost —
// unless the wallet makes more than 10k fills between two syncs, which leaves a GAP
// that no public endpoint can fill. That case is detected and disclosed, never papered
// over: `completeFrom` moves forward to where the tape is continuous again.
//
// `completeFrom` = the time from which the tape is known complete; null = complete
// from the wallet's very first fill (the first read held fewer than HL's 10k).

export const TAPE_STORE_CAP = 50_000;

// Compact row: ~half the bytes of the raw fill object (KV value + response size).
export function compactFill(f) {
  return [f.tid ?? null, Number(f.time), f.coin, f.px, f.sz, f.side, f.dir, f.closedPnl, f.fee];
}
export function expandFill(a) {
  const [tid, time, coin, px, sz, side, dir, closedPnl, fee] = a;
  const f = { coin, px, sz, side, time, dir, closedPnl, fee };
  if (tid !== null && tid !== undefined) f.tid = tid;
  return f;
}

// Fold a fresh read into the stored record.
//   prev   — the stored record, or null on first view
//   fresh  — the slices read now. MUST include the forward page from the newest stored
//            fill (startTime inclusive): if HL still serves that fill, it comes back and
//            proves continuity. No overlap with what we hold ⇒ HL has moved past it ⇒ gap.
export function syncTape(prev, freshSlices, { cap = TAPE_STORE_CAP, now = Date.now() } = {}) {
  const prevFills = Array.isArray(prev?.fills) ? prev.fills.map(expandFill) : [];
  const fresh = mergeFills(...(Array.isArray(freshSlices) ? freshSlices : []));
  let completeFrom;
  let gap = false;
  let merged;
  if (!prevFills.length) {
    merged = fresh;
    completeFrom = fresh.length >= HL_SERVED_MAX ? Number(fresh[0].time) : null;
  } else {
    const prevKeys = new Set(prevFills.map(fillKey));
    const newOnes = fresh.filter((f) => !prevKeys.has(fillKey(f)));
    const overlap = newOnes.length < fresh.length;
    gap = fresh.length > 0 && !overlap;
    completeFrom = prev.completeFrom ?? null;
    if (gap) completeFrom = Math.min(...newOnes.map((f) => Number(f.time)));
    merged = mergeFills(prevFills, fresh);
  }
  if (merged.length > cap) {
    merged = merged.slice(merged.length - cap);
    const oldestKept = Number(merged[0].time);
    completeFrom = completeFrom == null ? oldestKept : Math.max(completeFrom, oldestKept);
  }
  const record = {
    v: 1,
    fills: merged.map(compactFill),
    completeFrom,
    seededAt: prev?.seededAt ?? now,
    syncedAt: now,
  };
  return { record, added: merged.length - prevFills.length, gap };
}

// Newest stored fill time — where the next incremental page starts (inclusive).
export function tapeNewest(record) {
  const f = record?.fills;
  return Array.isArray(f) && f.length ? Number(f[f.length - 1][1]) : null;
}
