// The watchlist (2026-11-14, borst: "watchlist home"). Coins a trader watches (☆ in the market drawer, kept on
// this device; no wallet, no push needed) become a Lab home panel that says what CHANGED on each since they last
// looked: the price move, and the same three changes the phone alerts use (marketAlerts.mjs: funding stretched
// past its range, tracked traders' 2× agreement formed or flipped, a forecast swing). Inputs, never a verdict.
// Opening a coin's drawer marks it seen. Pure, tested.
import { marketCoin } from "./marketRead.mjs";
import { marketTransitions, marketAlertMessage, MARKET_WATCH_COINS_MAX } from "./marketAlerts.mjs";

export const WATCH_KEY = "nx_watchlist_v1";
export const WATCH_EVENT = "nexus:watchlist";
export const WATCH_MAX = MARKET_WATCH_COINS_MAX;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A stored watchlist, cleaned: { coins: string[], seen: { COIN: { snap, price, at } } }. */
export function parseWatch(raw) {
  let v = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { v = null; } }
  const coins = [];
  for (const c of Array.isArray(v?.coins) ? v.coins : []) { const k = marketCoin(c); if (k && !coins.includes(k)) coins.push(k); }
  const seen = {};
  for (const c of coins) { const s = v?.seen?.[c]; if (s && typeof s === "object") seen[c] = s; }
  return { coins: coins.slice(0, WATCH_MAX), seen };
}

/** Add (newest first) or remove a coin. A removed coin forgets its last look. At the cap, adding is refused. */
export function toggleWatch(state, coin) {
  const s = parseWatch(state);
  const c = marketCoin(coin);
  if (!c) return { state: s, on: false, full: false };
  if (s.coins.includes(c)) {
    const seen = { ...s.seen }; delete seen[c];
    return { state: { coins: s.coins.filter((x) => x !== c), seen }, on: false, full: false };
  }
  if (s.coins.length >= WATCH_MAX) return { state: s, on: false, full: true };
  return { state: { coins: [c, ...s.coins], seen: s.seen }, on: true, full: false };
}

/** The look a trader just had at a coin (drawer opened, or first time on the panel). */
export function markSeen(state, coin, live, now) {
  const s = parseWatch(state);
  const c = marketCoin(coin);
  if (!c || !s.coins.includes(c) || !live) return s;
  const prev = s.seen[c];
  // Same baseline rules as the alerts: an unread field keeps the old value (marketTransitions' `seen`).
  const { seen } = marketTransitions(c, prev?.snap ?? null, live.snap ?? {});
  return { ...s, seen: { ...s.seen, [c]: { snap: seen, price: num(live.price) ?? prev?.price ?? null, at: now } } };
}

/**
 * One row of the panel: the live price, the move since the last look, and what changed since then in plain
 * words. A coin never looked at yet has no changes ("watching from now"); the caller marks it seen.
 */
export function watchRow(coin, live, seenEntry) {
  const c = marketCoin(coin);
  const price = num(live?.price);
  const row = { coin: c, price, change24hPct: num(live?.change24hPct), sincePct: null, sinceAt: seenEntry?.at ?? null, changes: [], first: !seenEntry };
  if (!live) return { ...row, unread: true };
  if (!seenEntry) return row;
  const p0 = num(seenEntry.price);
  if (p0 && price) row.sincePct = ((price - p0) / p0) * 100;
  const { events } = marketTransitions(c, seenEntry.snap ?? null, live.snap ?? {});
  row.changes = events.map((e) => marketAlertMessage(e).replace(new RegExp(`^${c}: `), ""));
  return row;
}
