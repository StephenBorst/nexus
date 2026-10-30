// ── /ops/halt — the owner's switch that pauses every LIVE agent's new entries ────────────────────
// Rules and the signed message: app/lib/liveHalt.mjs. nexus-agent-exec reads the flag once per tick.
//   GET  /ops/halt  → { halted, since?, reason? } (public: users can see why their agent isn't entering)
//   POST /ops/halt  { address, on, ts, sig, reason? } → a treasury Safe owner or an OPS_WALLETS address,
//                   signing liveHaltMessage(address, on, ts) within 5 minutes. Pause writes the flag,
//                   resume deletes it; both are logged (ops:halt:log). Closes nothing, moves nothing.
import { json, recoverEthAddress } from "./shared.mjs";
import { isRevenueViewer } from "./revenue.mjs";
import { ownersOf } from "./routes-revenue.mjs";
import {
  LIVE_HALT_KEY, LIVE_HALT_LOG_KEY, parseLiveHalt, publicHalt, checkHaltRequest, haltRecord, appendHaltLog, lastHaltTs,
} from "../../app/lib/liveHalt.mjs";

export async function handleHalt(parts, request, env, { now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  if (!(parts[0] === "ops" && parts[1] === "halt" && parts.length === 2)) return null;
  const KV = env.NEXUS_AGENT;
  if (!KV) return json({ error: "agent_store_unbound" }, request, 503);

  if (request.method === "GET") return json(publicHalt(parseLiveHalt(await KV.get(LIVE_HALT_KEY))), request);
  if (request.method !== "POST") return json({ error: "method not allowed" }, request, 405);

  let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  let log = [];
  try { log = JSON.parse((await KV.get(LIVE_HALT_LOG_KEY)) || "[]"); } catch { log = []; }
  const at = now();
  const req = checkHaltRequest(body, { now: at, recover: recoverEthAddress, lastTs: lastHaltTs(log) });
  if (!req.ok) return json({ error: req.error }, request, req.status);

  const owners = await ownersOf(env, fetchImpl);
  if (!isRevenueViewer(req.address, owners, env.OPS_WALLETS)) {
    return json({ error: "not_allowed", hint: "Only a treasury Safe owner (or an OPS_WALLETS address) can switch this.", ownersRead: owners.length > 0 }, request, 403);
  }

  if (req.on) await KV.put(LIVE_HALT_KEY, JSON.stringify(haltRecord({ address: req.address, ts: req.ts, reason: req.reason, now: at })));
  else await KV.delete(LIVE_HALT_KEY);
  await KV.put(LIVE_HALT_LOG_KEY, JSON.stringify(appendHaltLog(log, { on: req.on, at, by: req.address, sigTs: req.ts, reason: req.reason })));
  console.log(`[ops] live entries ${req.on ? "PAUSED" : "RESUMED"} by ${req.address.slice(0, 10)}${req.reason ? ` · ${req.reason}` : ""}`);
  return json({ ok: true, ...publicHalt(parseLiveHalt(req.on ? await KV.get(LIVE_HALT_KEY) : null)) }, request);
}
