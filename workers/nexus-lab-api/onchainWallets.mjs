// ── On-chain wallet discovery: an incremental index of the ThesisRegistry's registrants ─────────
// GET /wallets/onchain used to ask ONE eth_getLogs for the last ~30M Arbitrum blocks. Alchemy's free
// tier allows 10 blocks per getLogs call, so it always failed and the route served an empty stale
// cache (the Feed read that as "0 on-chain callers"). Now:
//   · the wallet set + the last block scanned live in KV; each run scans FORWARD in chunks;
//   · getLogs goes to a public Arbitrum RPC (Alchemy stays for receipts);
//   · a provider that refuses a range halves the chunk (kept for the next run) instead of failing;
//   · a read that failed is REPORTED (`backfilled:false` / `error`), never an empty list.
// Events are read by emitter + layout (app/lib/registryEvent.mjs), NOT a signature hash: the Lab's
// ThesisRegistered(uint256,address) hash (0x479428a8…) is not what the contract emits.
//
// Pure: every network call goes through the injected `rpc(method, params)`.

import { registryEvents, THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";

export const ONCHAIN_INDEX_KEY = "onchain:wallets:v2";
export const DEFAULT_LOGS_RPC = "https://arb1.arbitrum.io/rpc";
export const DEFAULT_CHUNK = 500_000;   // blocks per getLogs (~35h of Arbitrum)
export const MIN_CHUNK = 2_000;         // below this, stop shrinking and report the error
export const MAX_CHUNKS_PER_RUN = 12;   // getLogs calls per request (Worker subrequest budget)
export const MAX_SEARCH_STEPS = 32;     // start-block binary search (one-time)
// No real call predates 2026 (grading.mjs GRADE_FLOOR_MS), so the scan starts at the first block of 2026.
export const SCAN_FLOOR_SEC = Math.floor(Date.UTC(2026, 0, 1) / 1000);

const hex = (n) => "0x" + Math.max(0, Math.floor(n)).toString(16);

/** Unique registrant wallets (lowercase, sorted) from getLogs results. Other emitters and logs
 *  without the indexed-id + indexed-address layout are ignored. */
export function walletsFromLogs(logs, registry = THESIS_REGISTRY) {
  return [...new Set(registryEvents(logs, registry).map((e) => e.trader))].sort();
}

/** True when an RPC error means "range / result set too large" (shrink and retry), not an outage. */
export function isRangeError(msg) {
  const m = String(msg || "");
  // A rate limit is an outage, not a range problem: shrinking on it would slow every later run.
  if (/rate.?limit|too many requests|\b429\b/i.test(m)) return false;
  return /range|too (large|big)|limit|exceed|10000|query returned more|timeout|timed out/i.test(m);
}

/** Lowest block whose timestamp is ≥ tsSec (binary search on headers; any node serves them). */
export async function findStartBlock(rpc, latestBlock, tsSec, maxSteps = MAX_SEARCH_STEPS) {
  let lo = 0, hi = latestBlock, steps = 0;
  while (lo < hi) {
    if (steps++ >= maxSteps) throw new Error("start-block search did not converge");
    const mid = Math.floor((lo + hi) / 2);
    const b = await rpc("eth_getBlockByNumber", [hex(mid), false]);
    const t = b && b.timestamp != null ? parseInt(b.timestamp, 16) : NaN;
    if (!Number.isFinite(t)) throw new Error(`block ${mid} unreadable`);
    if (t < tsSec) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Advance the index by up to `maxChunks` getLogs calls.
 * @param {object} o
 * @param {(method:string, params:any[]) => Promise<any>} o.rpc  resolves `result`, throws Error(message) on an RPC error
 * @param {object|null} o.state   the stored index ({wallets, startBlock, scannedTo, chunk}) or null
 * @param {string} [o.registry]
 * @param {number} [o.fromBlock]  pinned start block (env override); skips the timestamp search
 * @returns {Promise<{state:object, latestBlock:number|null, backfilled:boolean, scanned:number, error:string|null}>}
 */
export async function advanceIndex({ rpc, state, registry = THESIS_REGISTRY, fromBlock, maxChunks = MAX_CHUNKS_PER_RUN, floorSec = SCAN_FLOOR_SEC }) {
  const s = {
    wallets: Array.isArray(state?.wallets) ? [...state.wallets] : [],
    startBlock: Number.isFinite(state?.startBlock) ? state.startBlock : null,
    scannedTo: Number.isFinite(state?.scannedTo) ? state.scannedTo : null,   // last block INCLUDED
    chunk: Number.isFinite(state?.chunk) && state.chunk >= MIN_CHUNK ? state.chunk : DEFAULT_CHUNK,
  };
  let latestBlock = null, scanned = 0, error = null;
  try {
    latestBlock = parseInt(await rpc("eth_blockNumber", []), 16);
    if (!Number.isFinite(latestBlock)) throw new Error("latest block unreadable");
    if (s.startBlock == null) {
      s.startBlock = Number.isFinite(fromBlock) && fromBlock >= 0 ? fromBlock : await findStartBlock(rpc, latestBlock, floorSec);
    }
    if (s.scannedTo == null) s.scannedTo = s.startBlock - 1;
    const seen = new Set(s.wallets);
    while (scanned < maxChunks && s.scannedTo < latestBlock) {
      const from = s.scannedTo + 1;
      const to = Math.min(latestBlock, from + s.chunk - 1);
      let logs;
      try {
        logs = await rpc("eth_getLogs", [{ address: registry, fromBlock: hex(from), toBlock: hex(to) }]);
      } catch (e) {
        const msg = String(e?.message || e);
        if (isRangeError(msg) && s.chunk > MIN_CHUNK) { s.chunk = Math.max(MIN_CHUNK, Math.floor(s.chunk / 2)); scanned++; continue; }
        throw e;
      }
      if (!Array.isArray(logs)) throw new Error("eth_getLogs returned no list");
      // Wallets and progress move together: a later failure must not lose what this chunk found.
      for (const w of walletsFromLogs(logs, registry)) seen.add(w);
      s.wallets = [...seen].sort();
      s.scannedTo = to;
      scanned++;
    }
  } catch (e) {
    error = String(e?.message || e);
  }
  const backfilled = latestBlock != null && s.scannedTo != null && s.scannedTo >= latestBlock;
  return { state: s, latestBlock, backfilled, scanned, error };
}

/** The route's answer. `backfilled` = the index covers the registry's whole history up to `scannedTo`
 *  at some point; before that the list is partial and the count must not be shown as the total. */
export function onchainResponse(state, { latestBlock = null, error = null, fromCache = false } = {}) {
  const wallets = Array.isArray(state?.wallets) ? state.wallets : [];
  const backfilled = !!state?.backfilledAt;
  return {
    wallets,
    count: wallets.length,
    backfilled,
    scannedTo: state?.scannedTo ?? null,
    latestBlock,
    updatedAt: state?.updatedAt ?? null,
    fromCache,
    ...(error ? { error } : {}),
  };
}
