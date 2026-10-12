// ── Spot discovery — pure rules for the /token landing + search (2026-10-12) ─────────────────────
// Read-only helpers: nothing here signs, quotes or moves funds. Kept out of the page so the rules
// that decide WHICH token a tap opens are tested (a recents chip or a pinned major that resolved to
// a look-alike would put a user on the wrong token).

// ── recently viewed ────────────────────────────────────────────────────────────────────────────
// The last 5 tokens this browser opened, keyed by chain + contract address (tickers collide: a
// "RAY" chip must reopen THAT RAY). Works without a wallet. A perp-only major (BTC/ETH…, no
// trusted spot token) has no CA, so it's kept as kind "perp" by its ticker. Separate from the
// wallet's bought-tokens list (holdings.ts recents), which drives balance reads.
export const VIEWED_KEY = "nx_spot_viewed_v1";
export const VIEWED_MAX = 5;

const EVM_CA = /^0x[0-9a-fA-F]{40}$/;
const SOL_CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYM = /^[A-Za-z0-9.$_-]{1,16}$/;
const CHAIN = /^[a-z0-9-]{2,24}$/;

/** EVM addresses compare case-insensitively; Solana mints (base58) exactly. */
export function sameAddress(a, b) {
  if (!a || !b) return false;
  const A = String(a), B = String(b);
  return EVM_CA.test(A) && EVM_CA.test(B) ? A.toLowerCase() === B.toLowerCase() : A === B;
}

const viewedKey = (v) => (v.kind === "perp" ? `perp:${v.sym.toUpperCase()}` : `${v.chain}:${EVM_CA.test(v.ca) ? v.ca.toLowerCase() : v.ca}`);

/** A stored row is shown only if every field has the shape we wrote (localStorage is user-editable). */
export function validViewed(v) {
  if (!v || typeof v !== "object" || !SYM.test(String(v.sym || ""))) return false;
  if (v.kind === "perp") return true;
  return v.kind === "spot" && CHAIN.test(String(v.chain || "")) && (EVM_CA.test(String(v.ca || "")) || SOL_CA.test(String(v.ca || "")));
}

/** Newest first, one row per token, at most VIEWED_MAX. Returns a new list. */
export function addViewed(list, entry, now = Date.now()) {
  const row = { ...entry, at: now };
  if (!validViewed(row)) return Array.isArray(list) ? list.filter(validViewed).slice(0, VIEWED_MAX) : [];
  const k = viewedKey(row);
  const rest = (Array.isArray(list) ? list : []).filter((v) => validViewed(v) && viewedKey(v) !== k);
  return [row, ...rest].slice(0, VIEWED_MAX);
}

export function readViewed(storage) {
  try {
    const raw = storage?.getItem(VIEWED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(validViewed).slice(0, VIEWED_MAX) : [];
  } catch { return []; }
}

export function writeViewed(storage, list) {
  try { storage?.setItem(VIEWED_KEY, JSON.stringify(list)); } catch { /* blocked storage: nothing remembered */ }
}

/** Where a chip goes: a spot token by its address (exact), a perp-only major by its ticker. */
export function viewedHref(v) {
  return `/token/${encodeURIComponent(v.kind === "perp" ? v.sym : v.ca)}`;
}

// ── address search: the token itself, not a pair it's quoted in ──────────────────────────────────
// DexScreener's /tokens/<address> returns every pair the address is IN — as base OR quote. Ranking
// all of them by liquidity can open, say, a BONK/SOL pool for a SOL search. Keep only pairs whose
// BASE is the address when any exist.
export function pairsForAddress(pairs, address) {
  const own = (pairs || []).filter((p) => sameAddress(p?.baseAddress, address));
  return own.length ? own : (pairs || []);
}

// ── is this pool a real market? ─────────────────────────────────────────────────────────────────
// A ticker search ranks pools by liquidity, so a padded pool wins it: a fake LP that holds nearly
// the whole supply reports liquidity close to its own market cap, and almost nothing trades in it.
// A pool reads as a REAL market only when it clears the volume + liquidity floors AND is neither:
//   padded: liquidity >= 80% of market cap (a real token's float is mostly outside its pool),
//   thin:   24h volume under 0.1% of the pool's liquidity (nobody trades it).
// Unknown market cap or volume never marks a pool padded or thin on its own; the floors still apply.
export const MIN_SPOT_VOL_USD = 1000;
export const MIN_SPOT_LIQ_USD = 5000;
export const PADDED_LIQ_TO_MCAP = 0.8;
export const MIN_DAILY_TURNOVER = 0.001;
const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function poolFlags(p) {
  const liq = n(p?.liquidityUsd), mcap = n(p?.marketCap), vol = n(p?.volume24h);
  return {
    padded: liq != null && mcap != null && mcap > 0 && liq >= PADDED_LIQ_TO_MCAP * mcap,
    thin: liq != null && liq > 0 && vol != null && vol < MIN_DAILY_TURNOVER * liq,
  };
}

export function isRealMarket(p) {
  if (!p || (n(p.volume24h) ?? 0) < MIN_SPOT_VOL_USD || (n(p.liquidityUsd) ?? 0) < MIN_SPOT_LIQ_USD) return false;
  const f = poolFlags(p);
  return !f.padded && !f.thin;
}

/** One caution line for a pool the page still shows (an address search is never second-guessed). */
export function poolCaution(p) {
  const f = poolFlags(p);
  if (f.padded) return "Pool liquidity is close to the token's whole market cap. That is the shape of a padded pool: the price may not hold for a real trade.";
  if (f.thin) return "Almost nothing traded in this pool in the last 24h. Quotes may not fill near the price shown.";
  return null;
}

// ── "did you mean" ───────────────────────────────────────────────────────────────────────────────
// After a TICKER search, the best different token the search also found: another contract (not
// just another pool of the same token), with a real market (the same isRealMarket the resolver
// uses), the deepest first. An address search is exact, so it never gets one.
export function didYouMean(best, alts, { addressQuery = false } = {}) {
  if (addressQuery || !best || !Array.isArray(alts)) return null;
  const seen = new Set();
  const cands = alts
    .filter((p) => p && p.baseAddress && !sameAddress(p.baseAddress, best.baseAddress))
    .filter(isRealMarket)
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .filter((p) => { const k = `${p.chainId}:${String(p.baseAddress).toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return cands[0] || null;
}

// ── pinned majors (Spot home) ────────────────────────────────────────────────────────────────────
// Solana majors open by their mint so a guest can't land on a same-ticker copy. BTC/ETH have no
// trusted spot token (the resolver sends them to the perp book) and HYPE resolves by ticker.
// NEXUS opens by its Base contract. Mints are the tokens' canonical addresses.
export const SPOT_MAJORS = [
  { sym: "BTC" },
  { sym: "ETH" },
  { sym: "SOL", ca: "So11111111111111111111111111111111111111112" },
  { sym: "HYPE" },
  { sym: "JUP", ca: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { sym: "RAY", ca: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { sym: "BONK", ca: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { sym: "WIF", ca: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { sym: "NEXUS", ca: "0x3D958634ab725B627919EF8F2Ed59227309fDba3" },
];
export const majorHref = (m) => `/token/${encodeURIComponent(m.ca || m.sym)}`;

// ── nothing to buy with on Solana ────────────────────────────────────────────────────────────────
// True only when BOTH balances were read and neither can pay for a buy: SOL below a small buy plus
// fees, and USDC under $1 (or no SOL to pay the fee a USDC buy needs). Unknown balances → false
// (never nag on a failed read).
export const SOL_BRIDGE_MIN_SOL = 0.02;
export const SOL_BRIDGE_MIN_USDC = 1;
export const SOL_FEE_RESERVE = 0.003;
export function needsSolanaFunds({ sol, usdc }) {
  if (typeof sol !== "number" || typeof usdc !== "number" || !Number.isFinite(sol) || !Number.isFinite(usdc)) return false;
  const canPaySol = sol >= SOL_BRIDGE_MIN_SOL;
  const canPayUsdc = usdc >= SOL_BRIDGE_MIN_USDC && sol >= SOL_FEE_RESERVE;
  return !canPaySol && !canPayUsdc;
}

// ── callers count (search hero) ──────────────────────────────────────────────────────────────────
// A plain count of OPEN PUBLIC CALLS on the coin: no long/short split, no lean (borst, 2026-10-12:
// not until the verified board has a net-positive caller). Prefers the server's `callCount`; an
// older response falls back to counting the listed callers whose stance came from a call.
export function openCallCount(data) {
  if (!data) return 0;
  if (Number.isInteger(data.callCount) && data.callCount >= 0) return data.callCount;
  return (data.callers || []).filter((c) => Array.isArray(c?.sources) && c.sources.includes("thesis")).length;
}
export function callCountLine(n, coin) {
  if (!n || n < 1) return null;
  return `${n} public call${n === 1 ? "" : "s"} open on ${coin}`;
}
