// ── One call, one wallet ───────────────────────────────────────────────────────────────────────
// The Lab's device copy used to be shared by every wallet on a browser, so a wallet's first save
// carried in the previous wallet's calls. On 2026-09-28 the public feed held 35 calls that appeared
// in 2–7 wallets each (114 extra copies), and the caller board counted every copy for every wallet.
// labCache.mjs stops new copies; the publish lock (callLock.mjs) stops a copy being published anew.
// This settles the copies that already exist.
//
// A call is settled ONLY on proof of who made it, and only when that wallet holds a copy:
//   • house ids: `nexus-…` / `catalyst-…` are minted by the house-call generators alone, so the call
//     belongs to that house wallet (HOUSE_CALLER_ADDRESS / HOUSE_CATALYST_ADDRESS);
//   • on-chain: a copy carrying the publish transaction's hash — the ThesisRegistry's event names the
//     wallet that registered it (its msg.sender), and must match the copy's onChainId when the copy
//     has one (none do yet: the Lab never kept it before 2026-09-29, see app/lib/registryEvent.mjs).
// Anything else stays as it is and is listed as unresolved. The owner's copy is never touched.
// Every OTHER copy gets `duplicateOf: <owner>` (a server field). Nothing is deleted, so it can be
// undone, and the published copies stay permanent; the caller board, the feed, the stance board,
// the hourly grader and a wallet's public view all skip calls marked duplicateOf.
//
// REPORT FIRST: the marks are written only when CALL_DEDUPE_LIVE === "true". Until then the hourly
// pass writes the plan to `dedupe:report` (GET /theses/duplicates) and changes nothing.
import { thesisRegistrant } from "./callLock.mjs";
import { registryEvents, THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";

export { THESIS_REGISTRY };
export const REPORT_KEY = "dedupe:report";
export const PROOF_KEY = (id) => `callproof:${id}`;
const HOUSE_IDS = [["nexus-", "HOUSE_CALLER_ADDRESS"], ["catalyst-", "HOUSE_CATALYST_ADDRESS"]];

const lower = (a) => String(a || "").trim().toLowerCase();

/** Public calls that appear in more than one wallet: Map id → [{ wallet, t }]. Copies already marked count too. */
export function findCopies(records) {
  const byId = new Map();
  for (const { wallet, theses } of records) {
    const seen = new Set();
    for (const t of Array.isArray(theses) ? theses : []) {
      if (!t || t.isPublic !== true || typeof t.id !== "string" || !t.id || seen.has(t.id)) continue;
      seen.add(t.id);
      if (!byId.has(t.id)) byId.set(t.id, []);
      byId.get(t.id).push({ wallet, t });
    }
  }
  for (const [id, list] of byId) if (list.length < 2) byId.delete(id);
  return byId;
}

/** House-minted id → { owner, evidence } when that house address is configured. */
export function houseProof(id, env) {
  for (const [prefix, key] of HOUSE_IDS) {
    if (!id.startsWith(prefix)) continue;
    const owner = lower(env && env[key]);
    return /^0x[0-9a-f]{40}$/.test(owner) ? { owner, evidence: `house id (${prefix}…) minted by ${key}` } : null;
  }
  return null;
}

/**
 * Work out, and cache, who made each copied call; write marks only when live.
 * @param {object} env  LAB_STORE (+ house addresses, CALL_DEDUPE_LIVE)
 * @param {{ fetchReceipt?: (txHash:string)=>Promise<object|null>, live?: boolean, now?: number, maxReceipts?: number }} [o]
 */
export async function resolveDuplicates(env, { fetchReceipt = async () => null, live = env.CALL_DEDUPE_LIVE === "true", now = Date.now(), maxReceipts = 40 } = {}) {
  const kv = env.LAB_STORE;
  const listed = await kv.list({ prefix: "lab:" });
  const records = [];
  for (const key of listed.keys) {
    try { const d = JSON.parse((await kv.get(key.name)) || "null"); if (d && Array.isArray(d.theses)) records.push({ wallet: key.name.slice(4), theses: d.theses }); } catch { /* skip a bad record */ }
  }
  const copies = findCopies(records);
  let receipts = 0;
  const plan = [];
  for (const [id, list] of copies) {
    const holders = list.map((c) => c.wallet);
    let proof = null, noProof = "no proof of who made it";
    try { proof = JSON.parse((await kv.get(PROOF_KEY(id))) || "null"); } catch { proof = null; }
    if (!proof) {
      proof = houseProof(id, env);
      if (!proof) {
        const onChain = list.find((c) => typeof c.t.onChainTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(c.t.onChainTxHash));
        if (onChain && receipts >= maxReceipts) noProof = "on-chain proof not read yet (receipt budget for this pass spent)";
        else if (onChain) {
          receipts++;
          let rc = null;
          try { rc = await fetchReceipt(onChain.t.onChainTxHash); } catch { rc = null; }
          const owner = rc ? thesisRegistrant(rc, THESIS_REGISTRY, onChain.t.onChainId ?? null) : null;
          if (owner) {
            const event = registryEvents(rc.logs, THESIS_REGISTRY).find((e) => e.trader === owner)?.topic0 || null;
            proof = { owner, evidence: `registered on-chain by ${owner} in ${onChain.t.onChainTxHash}`, event };
          } else {
            // Said plainly, so the report tells a missing receipt from a transaction that proves nothing.
            noProof = !rc ? "its publish transaction's receipt couldn't be read (retried next pass)"
              : rc.status !== "0x1" ? "its publish transaction failed"
              : registryEvents(rc.logs, THESIS_REGISTRY).length ? "its publish transaction's registry events don't name one wallet"
              : "its publish transaction has no registry event";
          }
        }
      }
      if (proof) await kv.put(PROOF_KEY(id), JSON.stringify({ ...proof, at: now }));   // a proof never changes
    }
    const owner = proof && holders.includes(proof.owner) ? proof.owner : null;
    plan.push({
      id, symbol: list[0].t.symbol, direction: list[0].t.direction, holders,
      owner, evidence: proof ? proof.evidence : null,
      unresolvedWhy: owner ? null : proof ? `proven owner ${proof.owner} holds no copy` : noProof,
      mark: owner ? holders.filter((w) => w !== owner) : [],
    });
  }

  // Per wallet: its public calls as counted now, and after the marks (already-marked copies count as marked).
  const toMark = new Map();   // wallet → Set(ids)
  for (const p of plan) for (const w of p.mark) { if (!toMark.has(w)) toMark.set(w, new Set()); toMark.get(w).add(p.id); }
  const perWallet = {};
  for (const { wallet, theses } of records) {
    const pub = theses.filter((t) => t && t.isPublic === true);
    if (!pub.length) continue;
    const counted = pub.filter((t) => !t.duplicateOf).length;
    const after = pub.filter((t) => !t.duplicateOf && !(toMark.get(wallet)?.has(t.id))).length;
    perWallet[wallet] = { publicNow: counted, publicAfter: after, marked: counted - after };
  }

  let written = 0;
  if (live) {
    const byWallet = new Map();
    for (const p of plan) for (const w of p.mark) { if (!byWallet.has(w)) byWallet.set(w, new Map()); byWallet.get(w).set(p.id, p.owner); }
    for (const [w, ids] of byWallet) {
      // Onto a fresh read, touching only duplicateOf on the marked calls (a save in between survives).
      let d = null;
      try { d = JSON.parse((await kv.get(`lab:${w}`)) || "null"); } catch { d = null; }
      if (!d || !Array.isArray(d.theses)) continue;
      let changed = false;
      for (const t of d.theses) {
        const owner = t && ids.get(t.id);
        if (owner && t.duplicateOf !== owner) { t.duplicateOf = owner; changed = true; written++; }
      }
      if (changed) await kv.put(`lab:${w}`, JSON.stringify(d));
    }
    for (const p of plan) if (p.owner) await kv.put(`callowner:${p.id}`, p.owner);
  }

  const report = {
    at: now, live,
    duplicated: plan.length,
    resolved: plan.filter((p) => p.owner).length,
    unresolved: plan.filter((p) => !p.owner).length,
    copiesToMark: plan.reduce((a, p) => a + p.mark.length, 0),
    marksWritten: written,
    perWallet,
    plan,
    note: live
      ? "Copies of calls another wallet is proven to have made are marked duplicateOf and left out of the board, the feed and public views. Nothing is deleted."
      : "Report only (CALL_DEDUPE_LIVE is off): the plan below is what the marks would be. Nothing has changed.",
  };
  await kv.put(REPORT_KEY, JSON.stringify(report));
  return report;
}
