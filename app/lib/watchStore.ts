// The watchlist on this device (rules: app/lib/watchlist.mjs). One read/write pair so the drawer's ☆ and the
// Lab home panel stay in step: every write fires WATCH_EVENT. Fail-soft in private mode (an empty list).
import { parseWatch, toggleWatch, WATCH_KEY, WATCH_EVENT } from "./watchlist.mjs";

export type WatchState = { coins: string[]; seen: Record<string, { snap?: unknown; price?: number | null; at?: number }> };

export function readWatch(): WatchState {
  try { return parseWatch(localStorage.getItem(WATCH_KEY)) as WatchState; } catch { return { coins: [], seen: {} }; }
}

export function writeWatch(s: WatchState) {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(WATCH_EVENT)); } catch { /* non-browser */ }
}

/** ☆ / ★ in the drawer. Returns { on, full }. */
export function toggleWatchCoin(coin: string): { on: boolean; full: boolean } {
  const r = toggleWatch(readWatch(), coin) as { state: WatchState; on: boolean; full: boolean };
  if (!r.full) writeWatch(r.state);
  return { on: r.on, full: r.full };
}
