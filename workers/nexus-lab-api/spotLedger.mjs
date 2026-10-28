// ── Spot ledger: trades per route + Flash fees, by day ──────────────────────────────────────────
// What the owner's /ops/revenue page shows under "Spot". Counts only what we can PROVE:
//   flash    the proxy logs each order id at placement (logFlashOrder); the hourly job reads the order
//            from Flash once it's final and books one trade + its fills' notional + our integrator fee
//            (settleFlashOrders). Nothing comes from the browser.
//   spandex  EVM swap: the app reports the tx hash after its receipt reads success; booked only if the
//            receipt on that chain says status 0x1.
//   jupiter  Solana swap: the app reports the signature after confirmation; booked only if the chain
//            says confirmed/finalized with no error.
//   near     cross-chain: the app reports the deposit address on SUCCESS; booked only if 1Click's own
//            status says SUCCESS.
//   woofi    the WooFi widget reports no fills, so we count widget OPENS, labelled as opens.
// Each id is booked once (spot:fill:{route}:{id}). No wallet address is stored: route, day, id only.
// Day totals are read-modify-written under a NexusLock lease (KV has no compare-and-set).

import { LOCK_KEYS } from "./lock.mjs";

export const ROUTES = ["flash", "spandex", "jupiter", "near", "woofi"];
export const FILL_TTL_S = 400 * 86400;
const FLASH_FINAL = new Set(["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"]);
const FLASH_ORDER_MAX_AGE_MS = 45 * 86400 * 1000;
export const EVM_CHAINS = { 8453: "base", 42161: "arbitrum", 1: "ethereum" };
export const EVM_RPCS = {
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
};

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const DAY_KEY = (day) => `spot:day:${day}`;
export const FILL_KEY = (route, id) => `spot:fill:${route}:${id}`;
export const FLASH_PENDING = (id) => `spot:flash:${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const B58_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ANY_DEPOSIT = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{25,64}|[a-z0-9_.-]{2,64})$/;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Add one booking to a day's totals (pure). */
export function addToDay(day, route, { trades = 1, feeUsd = 0, notionalUsd = 0 } = {}) {
  const d = day && typeof day === "object" ? { ...day } : {};
  const r = { trades: 0, feeUsd: 0, notionalUsd: 0, ...(d[route] || {}) };
  r.trades += trades;
  r.feeUsd = Math.round((r.feeUsd + feeUsd) * 1e6) / 1e6;
  r.notionalUsd = Math.round((r.notionalUsd + notionalUsd) * 100) / 100;
  d[route] = r;
  return d;
}

/** Totals for a Flash order's fills (pure): notional + our integrator fee, in USD. */
export function flashFillTotals(fills) {
  let notionalUsd = 0, feeUsd = 0, lastAt = 0;
  for (const f of Array.isArray(fills) ? fills : []) {
    notionalUsd += num(f?.notional);
    feeUsd += num(f?.integratorFeeNotional);
    const t = Date.parse(f?.filledAt || "") || 0;
    if (t > lastAt) lastAt = t;
  }
  return { notionalUsd, feeUsd, lastAt, fills: Array.isArray(fills) ? fills.length : 0 };
}

/** Validate a report from the app. @returns {{route, id, chainId?} | {error}} */
export function parseFillReport(body) {
  const route = String(body?.route || "");
  const id = String(body?.id || "");
  if (route === "spandex") {
    const chainId = Number(body?.chainId);
    if (!EVM_CHAINS[chainId] || !TX_HASH.test(id)) return { error: "bad_report" };
    return { route, id: id.toLowerCase(), chainId };
  }
  if (route === "jupiter") return SOL_SIG.test(id) ? { route, id } : { error: "bad_report" };
  if (route === "near") return ANY_DEPOSIT.test(id) ? { route, id } : { error: "bad_report" };
  if (route === "woofi") return { route, id: "" };
  return { error: "bad_report" };
}

/**
 * Check a report against the chain / 1Click. @returns {Promise<boolean>} true = proven.
 * @param {{ evmRpc: (chainId, method, params) => Promise<any>, solRpc: (method, params) => Promise<any>, fetchImpl: typeof fetch }} io
 */
export async function verifyFill(rep, io) {
  try {
    if (rep.route === "spandex") {
      const r = await io.evmRpc(rep.chainId, "eth_getTransactionReceipt", [rep.id]);
      return !!r && typeof r.status === "string" && BigInt(r.status) === 1n;
    }
    if (rep.route === "jupiter") {
      const r = await io.solRpc("getSignatureStatuses", [[rep.id], { searchTransactionHistory: true }]);
      const st = r?.value?.[0];
      return !!st && st.err == null && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized");
    }
    if (rep.route === "near") {
      const r = await io.fetchImpl(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(rep.id)}`);
      if (!r.ok) return false;
      return (await r.json())?.status === "SUCCESS";
    }
  } catch { return false; }
  return false;
}

async function bookDay(env, lock, day, route, amounts) {
  await lock(LOCK_KEYS.spotDay(day), async () => {
    let cur = null;
    try { cur = JSON.parse((await env.LAB_STORE.get(DAY_KEY(day))) || "null"); } catch { cur = null; }
    await env.LAB_STORE.put(DAY_KEY(day), JSON.stringify(addToDay(cur, route, amounts)), { expirationTtl: FILL_TTL_S });
  });
}

/**
 * Book a verified report once. @returns {Promise<"booked" | "already" | "unproven">}
 * The id is claimed before booking; a failed booking releases it so a retry can land.
 */
export async function bookFill(env, rep, io, { lock, now = Date.now() } = {}) {
  if (rep.route === "woofi") { await bookDay(env, lock, dayOf(now), "woofi", { trades: 1 }); return "booked"; }
  const key = FILL_KEY(rep.route, rep.id);
  if (await env.LAB_STORE.get(key)) return "already";
  if (!(await verifyFill(rep, io))) return "unproven";
  const day = dayOf(now);
  return lock(LOCK_KEYS.spotFill(rep.route, rep.id), async () => {
    if (await env.LAB_STORE.get(key)) return "already";
    await env.LAB_STORE.put(key, JSON.stringify({ day }), { expirationTtl: FILL_TTL_S });
    try { await bookDay(env, lock, day, rep.route, { trades: 1 }); }
    catch (e) { await env.LAB_STORE.delete(key); throw e; }
    return "booked";
  });
}

/** Called by the Flash proxy after Flash accepted an order. Never throws (the order is placed either way). */
export async function logFlashOrder(env, responseText, requestText, now = Date.now()) {
  try {
    const id = JSON.parse(responseText)?.orderId;
    if (!UUID.test(String(id || ""))) return false;
    let funder = "";
    try { funder = String(JSON.parse(requestText)?.funderAddress || ""); } catch { /* none */ }
    if (!/^0x[0-9a-fA-F]{40}$/.test(funder) && !B58_ADDR.test(funder)) return false;
    // The funder is needed to read the order back from Flash; it's dropped once the order is booked.
    await env.LAB_STORE.put(FLASH_PENDING(id), JSON.stringify({ funder, at: now }), { expirationTtl: 60 * 86400 });
    return true;
  } catch { return false; }
}

/**
 * Hourly: read pending Flash orders from Flash; book the final ones (one trade, their notional and our
 * fee, on the day of the last fill), drop them from the pending list. @returns counts for the log.
 */
export async function settleFlashOrders(env, { fetchImpl = globalThis.fetch, lock, now = Date.now(), max = 40 } = {}) {
  const key = env.FLASH_API_KEY || "";
  const out = { seen: 0, booked: 0, waiting: 0, dropped: 0, failed: 0 };
  if (!key) return out;
  const listed = await env.LAB_STORE.list({ prefix: "spot:flash:", limit: max });
  for (const k of listed.keys || []) {
    out.seen++;
    const id = k.name.slice("spot:flash:".length);
    let rec;
    try { rec = JSON.parse(await env.LAB_STORE.get(k.name)); } catch { rec = null; }
    if (!rec || !UUID.test(id)) { await env.LAB_STORE.delete(k.name); out.dropped++; continue; }
    try {
      const r = await fetchImpl(`https://flash.definitive.fi/v1/orders/${id}?funderAddress=${rec.funder}`, { headers: { "x-definitive-api-key": key } });
      if (r.status === 404) { if (now - rec.at > 3600_000) { await env.LAB_STORE.delete(k.name); out.dropped++; } else out.waiting++; continue; }
      if (!r.ok) { out.failed++; continue; }
      const j = await r.json();
      const status = j?.order?.status;
      if (!FLASH_FINAL.has(status)) {
        if (now - rec.at > FLASH_ORDER_MAX_AGE_MS) { await env.LAB_STORE.delete(k.name); out.dropped++; } else out.waiting++;
        continue;
      }
      const t = flashFillTotals(j?.fills);
      if (t.fills > 0 && !(await env.LAB_STORE.get(FILL_KEY("flash", id)))) {
        const day = dayOf(t.lastAt || now);
        await env.LAB_STORE.put(FILL_KEY("flash", id), JSON.stringify({ day }), { expirationTtl: FILL_TTL_S });
        await bookDay(env, lock, day, "flash", { trades: 1, feeUsd: t.feeUsd, notionalUsd: t.notionalUsd });
        out.booked++;
      }
      await env.LAB_STORE.delete(k.name);
    } catch { out.failed++; }
  }
  return out;
}

/** The last `days` days of totals for the revenue page (pure summary over stored days). */
export function spotSummary(dayRecords, days, now = Date.now()) {
  const rows = [];
  const total = {};
  for (let i = 0; i < days; i++) {
    const day = dayOf(now - i * 86400_000);
    const rec = dayRecords[day] || null;
    rows.push({ day, routes: rec || {} });
    for (const [route, v] of Object.entries(rec || {})) {
      const t = (total[route] ||= { trades: 0, feeUsd: 0, notionalUsd: 0 });
      t.trades += num(v.trades); t.feeUsd += num(v.feeUsd); t.notionalUsd += num(v.notionalUsd);
    }
  }
  for (const t of Object.values(total)) { t.feeUsd = Math.round(t.feeUsd * 1e4) / 1e4; t.notionalUsd = Math.round(t.notionalUsd * 100) / 100; }
  return { days, total, rows };
}
