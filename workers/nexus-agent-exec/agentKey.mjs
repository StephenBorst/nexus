// ── Load the key an agent (or a TWAP) signs with (auth v2 build step 3b) ───────────────────────────
// `agent:key:{addr}` (and `twap:key:{addr}`) hold one of two things:
//   • v1: { tradingKey: <sealed bs58 seed>, accountId, … }: the key derived from the static signature;
//   • v2: a LINK { v: 2, source: "v2key" } (app/lib/agentKeyExpiry.mjs V2_KEY_LINK), written by lab-api
//     when the owner activated with a trading session. The key itself lives in the wallet's one v2
//     record, `v2key:{addr}` (lab-api v2Keys.mjs): one key per wallet, shared by chat trading and the
//     agent (spec Q2). It is read fresh every time, so a rotated key is picked up on the next tick.
// Deleting the agent's record (DEACTIVATE, KILL) deletes only the link; the wallet keeps its key.
// A link to a removed v2 key reads as "no key", exactly as a deleted v1 record does today.
// Pure apart from the injected kv + decrypt; tests: agentKey.test.mjs.
import { isV2Link } from "../../app/lib/agentKeyExpiry.mjs";

const V2_RECORD = (addr) => `v2key:${String(addr).toLowerCase()}`;

async function readJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** { v, expiresAt? } for the record at `recordKey`, without decrypting anything. null = no key. */
export async function agentKeyMeta(kv, address, { recordKey = `agent:key:${address}` } = {}) {
  const rec = await readJson(kv, recordKey);
  if (!rec) return null;
  if (!isV2Link(rec)) return { v: 1 };
  const v2 = await readJson(kv, V2_RECORD(address));
  if (!v2 || v2.v !== 2) return null;
  return { v: 2, expiresAt: Number(v2.expiresAt), orderlyKey: v2.orderlyKey };
}

/**
 * The decrypted key data exec's orderlyRequest signs with: { tradingKey (bs58 seed), accountId, v,
 * expiresAt? }. null = no key (nothing stored, or a link to a removed v2 key).
 */
export async function loadAgentKey(kv, address, { decrypt, recordKey = `agent:key:${address}` }) {
  const rec = await readJson(kv, recordKey);
  if (!rec) return null;
  if (!isV2Link(rec)) {
    return { ...rec, v: 1, tradingKey: await decrypt(rec.tradingKey) };
  }
  const v2 = await readJson(kv, V2_RECORD(address));
  if (!v2 || v2.v !== 2 || !v2.tradingKey || !v2.accountId) return null;
  return { v: 2, tradingKey: await decrypt(v2.tradingKey), accountId: v2.accountId, orderlyKey: v2.orderlyKey, expiresAt: Number(v2.expiresAt) };
}
