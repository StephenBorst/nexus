// ── Report a finished spot trade to the spot ledger (owner's /ops/revenue page) ─────────────────
// Fire-and-forget: never blocks or fails a trade. The worker books it only once the chain (or
// 1Click) proves it (workers/nexus-lab-api/spotLedger.mjs); no wallet address is sent.
const SPOT_FILL = "https://og.nexustradinglabs.com/spot/fill";

export type SpotRoute = "spandex" | "jupiter" | "near" | "woofi";

export function reportSpotFill(route: SpotRoute, id = "", chainId?: number): void {
  try {
    void fetch(SPOT_FILL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route, id, ...(chainId ? { chainId } : {}) }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* never let reporting touch the trade */ }
}
