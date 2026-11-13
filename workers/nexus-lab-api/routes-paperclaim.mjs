// ── /pipeline/paper-wallet — bind a paper wallet to a TRADEABLE read, signed by the owner ─────────────
// Rules + the signed message: app/lib/paperClaim.mjs. Read by the scoreboard build (the served stage moves
// TRADEABLE → PAPER on its next hourly build), the paper run page and the tape checker.
//   GET  /pipeline/paper-wallets → { claims: [{ axis, wallet, at, startedAt, by, sigTs, sig }], reads: paperSetupRows } (public)
//   POST /pipeline/paper-wallet  { address, axis, wallet, ts, sig } → a treasury Safe owner or an OPS_WALLETS
//        address signing paperClaimMessage within 5 minutes. Under a NexusLock lease: first registration wins,
//        never overwritten. Trades nothing, moves nothing.
import { json, recoverEthAddress } from "./shared.mjs";
import { isRevenueViewer } from "./revenue.mjs";
import { ownersOf } from "./routes-revenue.mjs";
import { withLock, LOCK_KEYS, LockBusy } from "./lock.mjs";
import {
  PAPER_CLAIMS_KEY, checkClaimSignature, claimRefusal, claimRecord, parseClaims, publicClaims, paperSetupRows,
} from "../../app/lib/paperClaim.mjs";

/** The stored claims (LAB_STORE). Unreadable = none. */
export async function readPaperClaims(env) {
  try { return parseClaims(await env.LAB_STORE.get(PAPER_CLAIMS_KEY)); } catch { return {}; }
}

/** Each read's served stage from the stored scoreboard (or its last-good copy), parsed once. {} = unread. */
export async function servedStages(env, scorecardKey) {
  for (const key of [scorecardKey, `${scorecardKey}:lastgood`]) {
    try {
      const raw = await env.LAB_STORE.get(key);
      const reads = raw ? JSON.parse(raw)?.pipeline?.reads : null;
      if (!Array.isArray(reads)) continue;
      return Object.fromEntries(reads.filter((r) => r?.axis && r.stage).map((r) => [r.axis, r.stage]));
    } catch { /* next */ }
  }
  return {};
}

async function getJson(kv, key) {
  try { const raw = await kv.get(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function handlePaperClaim(parts, request, env, { scorecardKey, now = Date.now, fetchImpl = globalThis.fetch, lock = withLock, setups } = {}) {
  const isList = parts[0] === "pipeline" && parts[1] === "paper-wallets" && parts.length === 2;
  const isClaim = parts[0] === "pipeline" && parts[1] === "paper-wallet" && parts.length === 2;
  if (!isList && !isClaim) return null;
  if (!env.LAB_STORE || !env.NEXUS_AGENT) return json({ error: "store_unbound" }, request, 503);

  if (isList) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, request, 405);
    const claims = await readPaperClaims(env);
    const stages = await servedStages(env, scorecardKey);
    return json({ claims: publicClaims(claims), reads: paperSetupRows(claims, stages) }, request);
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, request, 405);

  let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const at = now();
  const sig = checkClaimSignature(body, { now: at, recover: recoverEthAddress });
  if (!sig.ok) return json({ error: sig.error }, request, sig.status);
  const owners = await ownersOf(env, fetchImpl);
  if (!isRevenueViewer(sig.address, owners, env.OPS_WALLETS)) {
    return json({ error: "not_allowed", hint: "Only a treasury Safe owner (or an OPS_WALLETS address) can register a paper wallet.", ownersRead: owners.length > 0 }, request, 403);
  }

  try {
    return await lock(env, LOCK_KEYS.paperClaims(), async () => {
      const claims = await readPaperClaims(env);
      const [stage, config, state] = await Promise.all([
        servedStages(env, scorecardKey).then((s) => s[sig.axis] ?? null),
        getJson(env.NEXUS_AGENT, `agent:config:${sig.wallet}`),
        getJson(env.NEXUS_AGENT, `agent:state:${sig.wallet}`),
      ]);
      const no = claimRefusal({ axis: sig.axis, wallet: sig.wallet, stage, claims, config, state, ...(setups ? { setups } : {}) });
      if (no) return json(no, request, no.status);
      const rec = claimRecord({ axis: sig.axis, wallet: sig.wallet, address: sig.address, ts: sig.ts, sig: sig.sig, state, now: at });
      await env.LAB_STORE.put(PAPER_CLAIMS_KEY, JSON.stringify({ ...claims, [sig.axis]: rec }));
      console.log(`[pipeline] ${sig.axis} paper wallet ${sig.wallet.slice(0, 10)} registered by ${sig.address.slice(0, 10)}`);
      return json({ ok: true, claim: rec, note: "The served stage moves to PAPER on the next scoreboard build (within the hour). The daily watcher writes it into the code." }, request);
    });
  } catch (e) {
    if (e instanceof LockBusy) return json({ error: "busy", hint: "another registration is in flight; try again" }, request, 409);
    return json({ error: "lock_unavailable" }, request, 503);
  }
}
