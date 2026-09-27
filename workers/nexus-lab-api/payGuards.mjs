// ── Money-path guards: what our server key may pay, and what one payment may buy ─────────────
// Two leaks this closes (found 2026-09-27):
//   1. POST /wargame signs a USDC payment with OUR hot wallet (MIROSHARK_PAYER_KEY) against the
//      terms MiroShark's 402 hands back. Amount, receiver, token and chain were all taken verbatim,
//      so a buggy or hostile challenge could have asked for the whole wallet. The key now signs
//      only Base USDC, scheme "exact", to MiroShark's published receiver, for no more than the
//      user paid us for the credit.
//   2. /sub/verify and /sim/credits/verify each kept their OWN replay marker and both accept any
//      transfer to the same receiver, so one $20 tx bought 30 days of PRO AND 20 sim credits
//      (each sim costs us $1 of real USDC). A tx now buys one product, once.
// ⚠️ KV has no compare-and-set. The claim/credit/cap helpers below take their slot BEFORE money
// moves and re-check right before writing. That shrinks a race from seconds to milliseconds; it
// does not make it atomic. A Durable Object would. The daily sim cap stays the hard backstop.

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// MiroShark's published Base receiver (x402.miroshark.xyz/.well-known/x402, read 2026-09-27).
// If they rotate it, runs fail closed with the new address in the error; set the MIROSHARK_PAYTO
// var to the new one after checking it against their discovery doc.
export const MIROSHARK_PAYTO = "0x6cab485fc28ec70d3845113b704d4824e4d2b24f";
const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

// USD → USDC base units (6 dp). Rounds to the nearest unit so 1.005 isn't floored to 1.00.
export function usdcUnits(usd) {
  const n = Number(usd);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n;
}

// 2 dp, or as many as it takes to show a sub-cent difference (1.000001 must not read "1.00").
const usdc = (units) => (Number(units) / 1e6).toFixed(6).replace(/0{1,4}$/, "");

// Can our key sign this one x402 `accepts` entry? → { ok:true, units } | { ok:false, reason, stage }
// `stage` = how many checks passed; the caller reports the failure that got furthest.
export function checkServerPayment(a, { payTo, maxUnits }) {
  if (!a || typeof a !== "object") return { ok: false, stage: 0, reason: "no payment terms" };
  if ((a.scheme || "exact") !== "exact") return { ok: false, stage: 0, reason: `scheme "${a.scheme}" is not "exact"` };
  if (!BASE_NETWORKS.has(String(a.network || "").toLowerCase())) return { ok: false, stage: 1, reason: `network ${a.network} is not Base` };
  if (String(a.asset || "").toLowerCase() !== BASE_USDC.toLowerCase()) return { ok: false, stage: 2, reason: `asset ${a.asset} is not Base USDC` };
  if (String(a.payTo || "").toLowerCase() !== String(payTo || "").toLowerCase()) {
    return { ok: false, stage: 3, reason: `receiver ${a.payTo} is not MiroShark's published address ${payTo}` };
  }
  const raw = String(a.amount ?? a.maxAmountRequired ?? "");
  if (!/^[0-9]+$/.test(raw)) return { ok: false, stage: 4, reason: `amount "${raw}" is not a whole number of USDC units` };
  const units = BigInt(raw);
  if (units <= 0n) return { ok: false, stage: 4, reason: "amount is zero" };
  if (units > maxUnits) return { ok: false, stage: 4, reason: `asks ${usdc(units)} USDC per run, above the ${usdc(maxUnits)} USDC cap` };
  return { ok: true, units };
}

// The first entry our key may sign. MiroShark also lists Solana and Monad options, and the order
// of `accepts` isn't a contract, so never assume index 0.
export function pickServerPayment(accepts, opts) {
  let best = null;
  for (const a of Array.isArray(accepts) ? accepts : []) {
    const r = checkServerPayment(a, opts);
    if (r.ok) return { ok: true, accept: a, units: r.units };
    if (!best || r.stage > best.stage) best = r;
  }
  return { ok: false, reason: best ? best.reason : "no payment options" };
}

// ── One payment, one product ────────────────────────────────────────────────────────────────
// Both routes still write their own prefix (the admin payments count lists `sub:redeemed:` keys);
// they now CHECK both.
export const REDEEMED_PREFIXES = ["sub:redeemed:", "sim:redeemed:"];
const PRODUCT = { "sub:redeemed:": "PRO", "sim:redeemed:": "sim credits" };

// Which prefix already holds this tx, or null. A KV error throws: a replay guard that can't read
// must refuse, not grant.
export async function redeemedAs(store, txHash) {
  const hits = await Promise.all(REDEEMED_PREFIXES.map(async (p) => ((await store.get(p + txHash)) ? p : null)));
  return hits.find(Boolean) || null;
}

export function alreadyRedeemedMsg(prefix) {
  const what = PRODUCT[prefix];
  return what ? `this transaction was already redeemed for ${what}` : "this transaction was already redeemed";
}

// Re-check, claim the tx, then grant. If the grant throws, release the claim so the payer can
// retry instead of losing the payment. → { ok:true, value } | { ok:false, as }
export async function redeemOnce(store, txHash, prefix, owner, grant) {
  const as = await redeemedAs(store, txHash);
  if (as) return { ok: false, as };
  await store.put(prefix + txHash, owner);
  try {
    return { ok: true, value: await grant() };
  } catch (e) {
    try { await store.delete(prefix + txHash); } catch { /* claim stays; support can clear it */ }
    throw e;
  }
}

// ── Sim credits + the daily cap: take the slot before paying, give it back if the run isn't queued ──
// A failed write throws, so the caller stops BEFORE paying (fail closed).
export async function takeSimCredit(store, key) {
  const before = Number(await store.get(key)) || 0;
  if (before < 1) return { ok: false, left: Math.max(0, before) };
  await store.put(key, String(before - 1));
  return { ok: true, left: before - 1 };
}

export async function refundSimCredit(store, key) {
  const cur = Number(await store.get(key)) || 0;
  await store.put(key, String(Math.max(0, cur) + 1));
}

export async function takeCapSlot(store, key, cap, ttl) {
  const used = Number(await store.get(key)) || 0;
  if (used >= cap) return { ok: false, used };
  await store.put(key, String(used + 1), { expirationTtl: ttl });
  return { ok: true, used: used + 1 };
}

export async function releaseCapSlot(store, key, ttl) {
  const used = Number(await store.get(key)) || 0;
  await store.put(key, String(Math.max(0, used - 1)), { expirationTtl: ttl });
}
