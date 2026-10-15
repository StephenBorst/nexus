// ── POST /ops/revenue — the owner's revenue page (revenue.mjs) ────────────────────────────────
// Body { address, labAuth }: the Lab signature (app/lib/labAuth.mjs) from a treasury-Safe owner or
// an OPS_WALLETS address. Reads are cached 5 min (ops:rev:latest) so a refresh doesn't hammer the
// RPCs; one snapshot a day (ops:rev:snap:YYYY-MM-DD, kept 400 days) feeds "change since".
import { checkLabAuth, json } from "./shared.mjs";
import { readRevenue, readSafeOwners, isRevenueViewer, toSnapshot, withChanges, compareDay, SNAP_KEY, dayOf } from "./revenue.mjs";
import { orderlyGet } from "./orderlyGet.mjs";

const LATEST_KEY = "ops:rev:latest";
const OWNERS_KEY = "ops:safe:owners";
const LATEST_TTL_MS = 5 * 60 * 1000;
const SNAP_TTL_S = 400 * 86400;
const COMPARE = [7, 30];

async function ownersOf(env, fetchImpl) {
  const cached = await env.LAB_STORE.get(OWNERS_KEY);
  if (cached) { try { return JSON.parse(cached); } catch { /* re-read */ } }
  const owners = await readSafeOwners(fetchImpl);
  if (owners.length) await env.LAB_STORE.put(OWNERS_KEY, JSON.stringify(owners), { expirationTtl: 3600 });
  return owners;
}

async function markUsd(sym, fetchImpl) {
  try {
    const b = await orderlyGet(`https://api-evm.orderly.org/v1/public/futures/PERP_${sym}_USDC`, { tries: 2, fetchImpl });
    const px = Number(b?.data?.mark_price);
    return px > 0 ? px : null;
  } catch { return null; }
}

/** A fresh read, priced; stores today's snapshot if there isn't one yet. */
export async function freshRevenue(env, { fetchImpl = globalThis.fetch, nexusPrice, now = Date.now() } = {}) {
  const [ETH, SOL, BTC, NEXUS] = await Promise.all([
    markUsd("ETH", fetchImpl), markUsd("SOL", fetchImpl), markUsd("BTC", fetchImpl),
    typeof nexusPrice === "function" ? nexusPrice().catch(() => null) : null,
  ]);
  const rev = await readRevenue({ fetchImpl, prices: { ETH, SOL, BTC, NEXUS }, now });
  const allUnread = rev.groups.every((g) => g.unread === g.rows.length);
  if (!allUnread) {
    const key = SNAP_KEY(dayOf(now));
    if (!(await env.LAB_STORE.get(key))) await env.LAB_STORE.put(key, JSON.stringify(toSnapshot(rev)), { expirationTtl: SNAP_TTL_S });
  }
  return rev;
}

async function withHistory(env, rev) {
  const listed = await env.LAB_STORE.list({ prefix: "ops:rev:snap:" });
  const allDays = (listed.keys || []).map((k) => k.name.slice("ops:rev:snap:".length));
  const need = [...new Set(COMPARE.map((d) => compareDay(allDays, rev.at, d)).filter(Boolean))];
  const snaps = {};
  for (const day of need) { try { snaps[day] = JSON.parse(await env.LAB_STORE.get(SNAP_KEY(day))); } catch { /* skip */ } }
  return withChanges(rev, snaps, COMPARE, allDays);
}

export async function handleRevenue(parts, request, env, { now = Date.now, fetchImpl = globalThis.fetch, nexusPrice } = {}) {
  if (!(parts[0] === "ops" && parts[1] === "revenue" && parts.length === 2)) return null;
  if (request.method !== "POST") return json({ error: "method not allowed" }, request, 405);
  let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const address = String(body?.address || "").toLowerCase();
  const auth = checkLabAuth(address, body?.labAuth, now());
  if (!auth.ok) return json({ error: "sign_to_view", reason: auth.reason }, request, 401);
  const owners = await ownersOf(env, fetchImpl);
  if (!isRevenueViewer(address, owners, env.OPS_WALLETS)) {
    return json({ error: "not_allowed", hint: "Only a treasury Safe owner (or an OPS_WALLETS address) can open this page.", ownersRead: owners.length > 0 }, request, 403);
  }
  let rev = null;
  try { const c = JSON.parse(await env.LAB_STORE.get(LATEST_KEY)); if (c && now() - c.at < LATEST_TTL_MS && !body?.refresh) rev = c; } catch { /* stale or none */ }
  if (!rev) {
    rev = await freshRevenue(env, { fetchImpl, nexusPrice, now: now() });
    await env.LAB_STORE.put(LATEST_KEY, JSON.stringify(rev), { expirationTtl: 3600 });
  }
  return json(await withHistory(env, rev), request);
}
