// Open the market drawer from anywhere: openMarket("ETH"). Plug and play (2026-11-14): a tool doesn't import the
// drawer, it fires one window event; app/components/MarketDrawer.tsx (mounted once in App) listens. The drawer loads
// after first paint, so a tap that lands before it mounts is parked on window and picked up on mount.
import { marketCoin } from "./marketRead.mjs";

export const MARKET_EVENT = "nexus:market";
const PENDING = "__nxPendingMarket";

const DOCK = "__nxMarketDock";

/**
 * The desktop dock (2026-11-20, MarketDock.tsx beside the market table on a wide Lab home) takes coin taps while it is
 * on screen, so one coin stays in view instead of an overlay covering the terminal. null = no dock (the drawer opens).
 */
export function setMarketDock(fn, w = typeof window !== "undefined" ? window : null) {
  if (w) w[DOCK] = typeof fn === "function" ? fn : undefined;
}

/** Ask the drawer to open on a coin ("PERP_ETH_USDC" / "eth" / "ETH"). Returns the coin, or "" when refused. */
export function openMarket(coin, w = typeof window !== "undefined" ? window : null) {
  const c = marketCoin(coin);
  if (!c || !w) return "";
  if (typeof w[DOCK] === "function") { w[DOCK](c); return c; }
  w[PENDING] = c;
  w.dispatchEvent(new w.CustomEvent(MARKET_EVENT, { detail: { coin: c } }));
  return c;
}

/** The drawer takes (and clears) a tap that landed before it mounted. */
export function takePendingMarket(w = typeof window !== "undefined" ? window : null) {
  if (!w) return "";
  const c = marketCoin(w[PENDING]);
  w[PENDING] = undefined;
  return c;
}

/** The drawer's handler marks the pending tap consumed so a later mount doesn't reopen it. */
export function clearPendingMarket(w = typeof window !== "undefined" ? window : null) {
  if (w) w[PENDING] = undefined;
}
