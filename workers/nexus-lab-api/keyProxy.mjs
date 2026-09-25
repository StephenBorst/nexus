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
