// ── Flash (Definitive) browser helpers shared by the Spot ticket and the Flash orders panel ──
// Every call goes through OUR worker proxy (it holds FLASH_API_KEY; flashUpstream whitelists the
// routes). Signing always happens in the user's wallet, in the components — nothing here signs.
import { flashCancelMessage, utf8Hex } from "@/lib/flashGuards.mjs";

export const FLASH = "https://og.nexustradinglabs.com/flash";
export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
export const FLASH_CHANGED = "nx-flash-orders"; // window event: an order was placed or cancelled

const OPEN = "ORDER_STATUS_PENDING,ORDER_STATUS_ACCEPTED,ORDER_STATUS_PARTIALLY_FILLED";

// Chain → tx explorer, for the fill's settlement transaction (Flash returns it per fill).
const EXPLORER: Record<string, string> = {
  base: "https://basescan.org/tx/",
  ethereum: "https://etherscan.io/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
};
export const txLink = (chain: string, hash?: string | null) =>
  hash && /^0x[0-9a-fA-F]{64}$/.test(hash) && EXPLORER[chain] ? EXPLORER[chain] + hash : null;

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const r = await fetch(url);
  let body: Record<string, unknown> | null = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  return { ok: r.ok, status: r.status, body };
}

// All of the wallet's OPEN orders (every page), or null if any page can't be read. Used to size
// an approval (openSpend) — so a partial list must never pass for a whole one.
export async function fetchOpenOrders(wallet: string): Promise<unknown[] | null> {
  const all: unknown[] = [];
  let tok = "";
  for (let i = 0; i < 5; i++) {
    const r = await getJson(`${FLASH}/orders?funderAddress=${wallet}&statuses=${OPEN}${tok ? `&pageToken=${encodeURIComponent(tok)}` : ""}`);
    const rows = r.body?.orders;
    if (!r.ok || !Array.isArray(rows)) return null;
    all.push(...rows);
    tok = typeof r.body?.nextPageToken === "string" ? (r.body.nextPageToken as string) : "";
    if (!tok) return all;
  }
  return null; // 500+ open orders: don't size an approval blind
}

// Recent orders for the panel (first page, every status). Throws on failure. Cached per wallet
// for a minute: the panel mounts on every EVM token page, and Flash allows our key 5 req/s per
// endpoint across ALL users, so browsing between tokens must not refetch. `fresh` (after a
// place/cancel, or the open panel's poll) skips the cache.
const RECENT_TTL_MS = 60_000;
let recentCache: { wallet: string; at: number; rows: unknown[] } | null = null;
export async function fetchRecentOrders(wallet: string, fresh = false): Promise<unknown[]> {
  const key = wallet.toLowerCase();
  if (!fresh && recentCache && recentCache.wallet === key && Date.now() - recentCache.at < RECENT_TTL_MS) return recentCache.rows;
  const r = await getJson(`${FLASH}/orders?funderAddress=${wallet}`);
  if (!r.ok || !Array.isArray(r.body?.orders)) throw new Error(r.status === 429 ? "busy, retrying" : `orders ${r.status}`);
  recentCache = { wallet: key, at: Date.now(), rows: r.body!.orders as unknown[] };
  return recentCache.rows;
}

// One order + its fills. null while Flash is still projecting a just-placed order (404).
export async function fetchOrder(wallet: string, id: string): Promise<{ order: Record<string, unknown>; fills: Record<string, unknown>[] } | null> {
  const r = await getJson(`${FLASH}/orders/${id}?funderAddress=${wallet}`);
  if (r.status === 404 || !r.ok || !r.body?.order) return null;
  return { order: r.body.order as Record<string, unknown>, fills: Array.isArray(r.body.fills) ? (r.body.fills as Record<string, unknown>[]) : [] };
}

// Cancel = the funder wallet personal_signs Flash's exact plaintext; gasless, no transaction.
// Returns "cancelled" | "filled" (it filled before the cancel landed). Throws otherwise.
export async function cancelOrder(provider: Eip1193, wallet: string, id: string): Promise<"cancelled" | "filled"> {
  const cancelMessage = flashCancelMessage(id);
  const userSignature = (await provider.request({ method: "personal_sign", params: [utf8Hex(cancelMessage), wallet] })) as string;
  const r = await fetch(`${FLASH}/orders/${id}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cancelMessage, userSignature }),
  });
  if (r.ok) return "cancelled";
  let msg = "";
  try { const j = await r.json(); msg = j?.error?.message || j?.message || ""; } catch { /* ignore */ }
  if (r.status === 422 && /fill/i.test(msg)) return "filled";
  throw new Error(msg || `cancel failed (${r.status})`);
}

// ERC-20 reads through the wallet's own RPC (the caller has already switched chains).
const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
export async function erc20Balance(provider: Eip1193, token: string, owner: string): Promise<bigint> {
  const r = (await provider.request({ method: "eth_call", params: [{ to: token, data: "0x70a08231" + pad(owner) }, "latest"] })) as string;
  return BigInt(r && r !== "0x" ? r : "0x0");
}
export async function erc20Allowance(provider: Eip1193, token: string, owner: string, spender: string): Promise<bigint> {
  const r = (await provider.request({ method: "eth_call", params: [{ to: token, data: "0xdd62ed3e" + pad(owner) + pad(spender) }, "latest"] })) as string;
  return BigInt(r && r !== "0x" ? r : "0x0");
}

// base units → short human string (display only).
export function human(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const n = Number(`${whole}.${frac || "0"}`);
  const s = n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return (neg ? "-" : "") + s;
}
