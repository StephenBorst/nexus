// ── Guards for the proxies that carry OUR API keys (/flash, /swap/jup) ──────────
// Those routes add a paid/secret key server-side, so without a gate they are an open relay for
// anyone to spend our quota (or get the key revoked). Two cheap layers:
//   1. Origin — only our own app origins. A non-browser can forge the header, so this stops
//      other websites and casual scripts, not a determined attacker; hence…
//   2. A per-IP budget per window, kept in isolate memory (best-effort: each Worker isolate has
//      its own counter — it bounds a burst, it isn't a billing-grade meter).
// Neither can touch user funds: every order still needs the user's own wallet signature.
import { ALLOWED_ORIGINS } from "./shared.mjs";

const PAGES_HOST = "nexus-trading-lab.pages.dev";

export function keyProxyOriginOk(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return u.hostname === PAGES_HOST || u.hostname.endsWith(`.${PAGES_HOST}`);
}

// Fixed-window counter. Returns true when this hit is OVER the limit.
export function makeRateLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const hits = new Map();
  return function over(key, now = Date.now()) {
    const cur = hits.get(key);
    if (!cur || now - cur.start >= windowMs) {
      if (hits.size >= maxKeys) hits.clear(); // bound memory; a reset only forgives, never blocks
      hits.set(key, { start: now, n: 1 });
      return false;
    }
    cur.n += 1;
    return cur.n > limit;
  };
}

// ── Flash route whitelist ──────────────────────────────────────────────────────
// Maps OUR /flash/* route to ONE fixed upstream Flash URL, or null. Everything that reaches the
// upstream URL is validated here (UUID order ids, EVM funder addresses, known statuses, an
// opaque-but-charset-bound page token), so a crafted path or query can't steer our key at any
// other Flash endpoint (no batch cancel, no PATCH, no setup-transaction relay) or anywhere else.
const FLASH_V1 = "https://flash.definitive.fi/v1";
const FLASH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const FLASH_STATUSES = new Set(["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED", "ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"]);

export function flashUpstream(method, parts, searchParams) {
  if (!Array.isArray(parts) || parts[0] !== "flash") return null;
  const q = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams();
  if (method === "POST" && parts.length === 2 && (parts[1] === "quote" || parts[1] === "order"))
    return { url: `${FLASH_V1}/${parts[1]}`, method: "POST", body: true };
  if (method === "POST" && parts.length === 4 && parts[1] === "orders" && FLASH_UUID.test(parts[2]) && parts[3] === "cancel")
    return { url: `${FLASH_V1}/orders/${parts[2]}/cancel`, method: "POST", body: true };
  if (method !== "GET" || parts[1] !== "orders") return null;
  const funder = q.get("funderAddress") || "";
  if (!EVM_ADDR.test(funder)) return null;
  if (parts.length === 3 && FLASH_UUID.test(parts[2]))
    return { url: `${FLASH_V1}/orders/${parts[2]}?funderAddress=${funder}`, method: "GET", body: false };
  if (parts.length !== 2) return null;
  const out = new URLSearchParams({ funderAddress: funder, pageSize: "100" });
  const st = q.get("statuses");
  if (st) {
    const list = st.split(",");
    if (!list.every((x) => FLASH_STATUSES.has(x))) return null;
    out.set("statuses", list.join(","));
  }
  const tok = q.get("pageToken");
  if (tok) {
    if (!/^[A-Za-z0-9_\-.=+/]{1,512}$/.test(tok)) return null;
    out.set("pageToken", tok);
  }
  return { url: `${FLASH_V1}/orders?${out.toString()}`, method: "GET", body: false };
}
