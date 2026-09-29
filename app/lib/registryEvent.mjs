// ── The ThesisRegistry's registration event, read by its layout ─────────────────────────────────
// ThesisRegistry (Arbitrum, 0x2F4E…46Bc) emits one event per registration whose first two indexed
// topics are the thesis id and the trader (the registry's msg.sender). The contract's source isn't in
// this repo, and the event signature the Lab's ABI declared, ThesisRegistered(uint256,address), is
// not the one the contract emits: none of the 94 calls registered from the Lab carries its on-chain
// id, and a server check pinned to that signature's hash proved none of 17 registrations
// (2026-09-29). So the event is read by who emitted it and its layout, never by a guessed signature:
// a log from the registry with an indexed id and an indexed address. Shared by the Lab (to keep the
// on-chain id) and lab-api (callLock.mjs: who registered a call).
//
// Pure; `logs` = a receipt's logs (raw JSON-RPC or viem, both carry address + topics).

export const THESIS_REGISTRY = "0x2f4eda890f96a7979d6f26bcb210cedad68346bc";

const ADDRESS_WORD = /^0x0{24}[0-9a-f]{40}$/;   // an address, left-padded to 32 bytes

/**
 * @param {Array<{address?:string, topics?:string[]}>} logs
 * @param {string} [registryAddress]
 * @returns {{ topic0: string, thesisId: bigint|null, trader: string }[]}
 */
export function registryEvents(logs, registryAddress = THESIS_REGISTRY) {
  const reg = String(registryAddress || "").toLowerCase();
  const out = [];
  for (const l of Array.isArray(logs) ? logs : []) {
    if (!l || String(l.address || "").toLowerCase() !== reg || !Array.isArray(l.topics) || l.topics.length < 3) continue;
    const who = String(l.topics[2]).toLowerCase();
    if (!ADDRESS_WORD.test(who)) continue;
    let thesisId = null;
    try { thesisId = BigInt(l.topics[1]); } catch { thesisId = null; }
    out.push({ topic0: String(l.topics[0]).toLowerCase(), thesisId, trader: "0x" + who.slice(-40) });
  }
  return out;
}
