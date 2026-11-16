// On-chain → Lab watchdog (2026-11-16, borst: a call was registered on Arbitrum but never reached the Lab before the
// 6-hour index window closed, and nobody was told). A registration lands in the Lab only when something calls
// indexRegistration: the proxy right after it submits (/proxy/thesis-register), or the caller's own POST /theses/index
// after a raw submit. If neither happens, the call is lost for good once INDEX_MAX_AGE_MS passes.
//
// Every 5 minutes (lab-api's */5 cron) this reads the ThesisRegistry's new logs on a public Arbitrum RPC, and any
// registration still missing from its wallet's Lab record GRACE_MS after it was first seen is indexed here, through
// the same indexRegistration (same proof from the chain, same lock and seal, same follower alerts). The owner gets a
// Telegram line for each one indexed here (it means the publisher's path skipped the index) and for each one that
// can't be indexed (refused, too old, or still unconfirmed after MAX_TRIES runs). Alerts that fail to send are kept
// and retried next run. State: LAB_STORE `onchain:regwatch:v1`. Reads the chain, writes only the calls it proves.

import { registryEvents, THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";
import { isRangeError } from "./onchainWallets.mjs";

export const REGWATCH_KEY = "onchain:regwatch:v1";
export const GRACE_MS = 5 * 60_000;        // the publisher's own index gets this long first
export const LOOKBACK_BLOCKS = 110_000;    // first run: ~7.5h of Arbitrum (~0.25 s blocks), past the 6h index window
export const CHUNK = 10_000;                // blocks per eth_getLogs (~40 min of Arbitrum); halves on a range refusal
export const MIN_CHUNK = 500;              // halving stops here; an endpoint capped below PROVIDER_MIN_SPAN is skipped first
export const MAX_CHUNKS = 14;              // first run covers LOOKBACK_BLOCKS in ≤ 11 calls; a normal run needs 1
export const CALL_GAP_MS = 250;            // between getLogs calls: shared public endpoints rate-limit bursts
export const MAX_INDEX_PER_RUN = 5;        // subrequest budget: each index is ~4 RPC reads + KV
export const MAX_TRIES = 12;               // a registration still unconfirmed after ~1h of runs is reported
export const DONE_KEEP = 300;
export const ALERTS_KEEP = 30;
export const SCAN_FAILS_ALERT = 6;
export const LATE_WINDOW_MS = 7 * 86_400_000;   // the digest counts calls indexed late over the last 7 days         // ~30 min blind = the owner hears once (and again when it reads again)

// ── Where the logs are read (2026-11-16: the public endpoint answered 429 "Too Many Requests" for 6 runs in a row; the
// Worker shares its egress IP with every other Cloudflare app hitting the same free RPC) ─────────────────────────────
// ARBITRUM_RPC_URL or ARB_LOGS_RPC (a secret: provider URLs carry the key) goes first when set; the public endpoints follow. A 429 waits
// and retries the same endpoint (RETRY_WAITS_MS), then moves to the next one; the endpoint that last answered is tried
// first on the next call. Whatever a provider's eth_getLogs range limit is, scanForward halves the chunk until it fits.
export const PUBLIC_LOGS_RPCS = Object.freeze([
  "https://arb1.arbitrum.io/rpc",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://arbitrum.drpc.org",
]);
export const RETRY_WAITS_MS = Object.freeze([500, 1_500, 4_000]);

/** The endpoints to read logs from, in order: the configured one (https only), then the public ones. */
export function logsRpcUrls(env = {}) {
  // ARBITRUM_RPC_URL, or ARB_LOGS_RPC (the name /wallets/onchain already reads): either one, set once, serves both.
  const own = [env.ARBITRUM_RPC_URL, env.ARB_LOGS_RPC]
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => /^https:\/\/\S+$/.test(u));
  return [...new Set([...own, ...PUBLIC_LOGS_RPCS])];
}

// An endpoint that won't serve this request at all (2026-11-16: publicnode without its free Allnodes token answers
// "Archive requests require a personal token" to any eth_getLogs past ~10 blocks; others want a key or a paid plan).
// That isn't the chain's answer, so the next endpoint is tried instead of the watchdog going blind.
export function isProviderRefusal(msg, status) {
  return status === 401 || status === 403
    || /archive|personal token|api.?key|unauthori[sz]ed|forbidden|not (supported|allowed|available)|method not found|upgrade|paid plan|requires? (a )?(token|key|plan|subscription)/i.test(String(msg || ""));
}
// A provider whose eth_getLogs cap is below this many blocks can't keep up (a normal 5-min run needs ~1,200).
export const PROVIDER_MIN_SPAN = 2_000;
const logSpan = (method, params) => {
  if (method !== "eth_getLogs") return null;
  const f = parseInt(params?.[0]?.fromBlock, 16), t = parseInt(params?.[0]?.toBlock, 16);
  return Number.isFinite(f) && Number.isFinite(t) ? t - f + 1 : null;
};

export function isRateLimited(msg, status) {
  return status === 429 || /rate.?limit|too many requests|\b429\b|exceeded.*(capacity|quota)/i.test(String(msg || ""));
}

/**
 * JSON-RPC over several endpoints with backoff. rpc(method, params) → result; a JSON-RPC error that isn't a rate limit
 * (e.g. a range refusal) is thrown as is so the caller can shrink the range. Errors name the endpoint by host only.
 */
export function makeLogsRpc(urls, { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waits = RETRY_WAITS_MS } = {}) {
  let prefer = 0;
  const host = (u) => { try { return new URL(u).host; } catch { return "rpc"; } };
  return async function rpc(method, params) {
    let last = "no rpc configured";
    for (let k = 0; k < urls.length; k++) {
      const i = (prefer + k) % urls.length, url = urls[i];
      for (let attempt = 0; attempt <= waits.length; attempt++) {
        let status = 0, body = null, msg = "";
        try {
          const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          status = r.status;
          const text = await r.text();
          try { body = JSON.parse(text); } catch { body = null; msg = text.slice(0, 120); }
        } catch (e) { msg = String(e?.message || e); }
        if (body && "result" in body && !body.error) { prefer = i; return body.result; }
        if (body && body.error) msg = String(body.error.message || "rpc error");
        else if (!msg) msg = `http ${status}`;
        last = `${host(url)}: ${msg}`;
        if (isRateLimited(msg, status)) {
          if (attempt < waits.length) { await sleep(waits[attempt]); continue; }
          break;                                          // still limited: next endpoint
        }
        if (status === 401 || status === 403) break;     // no access at all: next endpoint
        // A range cap is checked before the refusal words: drpc's free plan answers "ranges over 10000 blocks are not
        // supported on free plan" (2026-11-17), which "not supported" read as a refusal, so the endpoint was skipped
        // instead of the scanner halving to a range it serves, and the watchdog went blind for 6 runs.
        if (body && body.error && isRangeError(msg)) {
          const span = logSpan(method, params);
          if (span != null && span <= PROVIDER_MIN_SPAN) break; // capped too small to keep up: next endpoint
          const e = new Error(msg); e.rpcError = body.error; throw e;                  // the scanner halves the range
        }
        if (isProviderRefusal(msg, status)) break;       // this endpoint won't serve it: next endpoint
        if (body && body.error) { const e = new Error(msg); e.rpcError = body.error; throw e; } // the chain's answer
        break;                                            // network / http error: next endpoint
      }
    }
    throw new Error(last);
  };
}

const hex = (n) => "0x" + Math.max(0, Math.floor(n)).toString(16);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Registrations in a getLogs result: { txHash, wallet, block }, layout-checked like every other reader. */
export function registrationsFromLogs(logs, registry = THESIS_REGISTRY) {
  const out = [];
  for (const l of Array.isArray(logs) ? logs : []) {
    const [ev] = registryEvents([l], registry);
    const tx = String(l?.transactionHash || "").toLowerCase();
    if (!ev || !/^0x[0-9a-f]{64}$/.test(tx)) continue;
    out.push({ txHash: tx, wallet: ev.trader, block: parseInt(l.blockNumber, 16) || null });
  }
  return out;
}

/** What one index answer means for the watchdog. */
export function judgeIndex(res) {
  const s = res?.status, b = res?.body || {};
  if (s === 200 && b.already) return { done: true, alert: null };
  if (s === 200 && b.ok) return { done: true, alert: "indexed" };
  if (s === 202 || s === 503 || s == null) return { done: false, alert: null };   // not mined / unreadable: next run
  return { done: true, alert: "failed" };
}

/** The owner's line for one outcome. */
export function alertLine(kind, { wallet, txHash, body = {}, minutesSeen = null }) {
  const who = `<code>${esc(short(wallet))}</code>`, tx = `tx <code>${esc(short(txHash))}</code>`;
  if (kind === "indexed") {
    const what = [b(body.symbol), b(body.direction)].filter(Boolean).join(" ");
    const late = minutesSeen != null ? `, ${minutesSeen} min after the watchdog first saw it` : "";
    return `Call on-chain but missing from the Lab, indexed now by the watchdog: ${who}${what ? ` ${esc(what)}` : ""} · ${tx}${late}. Graded from now. The publisher's path skipped /theses/index.`;
  }
  if (kind === "unconfirmed") return `Call on-chain still not in the Lab after ${MAX_TRIES} tries (receipt or chain unreadable): ${who} · ${tx}. Check it and POST /theses/index before the 6h window closes.`;
  const why = [body.error, body.reason || body.hint].filter(Boolean).join(": ");
  return `Call on-chain could NOT be added to the Lab: ${who} · ${tx} · ${esc(why || "unknown")}.`;
}
function b(v) { return typeof v === "string" ? v.replace(/^PERP_/, "").replace(/_USDC$/, "") : null; }

/** Scan forward from the stored cursor. Returns the new registrations and the cursor reached. */
export async function scanForward(rpc, state, { registry = THESIS_REGISTRY, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const latest = parseInt(await rpc("eth_blockNumber", []), 16);
  if (!Number.isFinite(latest)) throw new Error("latest block unreadable");
  let scannedTo = Number.isFinite(state?.scannedTo) ? state.scannedTo : Math.max(0, latest - LOOKBACK_BLOCKS);
  let chunk = Number.isFinite(state?.chunk) && state.chunk >= MIN_CHUNK ? state.chunk : CHUNK;
  const found = [];
  let calls = 0, error = null;
  const start = scannedTo;
  while (calls < MAX_CHUNKS && scannedTo < latest) {
    const from = scannedTo + 1, to = Math.min(latest, from + chunk - 1);
    if (calls++) await sleep(CALL_GAP_MS);
    let logs;
    try { logs = await rpc("eth_getLogs", [{ address: registry, fromBlock: hex(from), toBlock: hex(to) }]); }
    catch (e) {
      const msg = String(e?.message || e);
      if (isRangeError(msg) && chunk > MIN_CHUNK) { chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2)); continue; }
      error = msg; break;
    }
    if (!Array.isArray(logs)) { error = "eth_getLogs returned no list"; break; }
    found.push(...registrationsFromLogs(logs, registry));
    scannedTo = to;
  }
  return { found, scannedTo, chunk, latest, error, progressed: scannedTo > start };
}

/**
 * One run. deps: logsRpc (public RPC for getLogs), index(txHash, wallet) → indexRegistration's { status, body },
 * send(text) → boolean, now().
 */
export async function runRegWatch(env, { logsRpc, index, send, now = Date.now, scanOpts = {} }) {
  let state;
  try { state = JSON.parse((await env.LAB_STORE.get(REGWATCH_KEY)) || "null"); } catch { state = null; }
  const s = {
    scannedTo: state?.scannedTo, chunk: state?.chunk,
    open: state?.open && typeof state.open === "object" ? { ...state.open } : {},
    done: Array.isArray(state?.done) ? [...state.done] : [],
    alerts: Array.isArray(state?.alerts) ? [...state.alerts] : [],
    scanFails: Number(state?.scanFails) || 0,
    lastReadAt: Number(state?.lastReadAt) || null,
    late: Array.isArray(state?.late) ? state.late.filter(Number.isFinite) : [],   // when a call had to be indexed here
  };
  const t = now();
  const doneSet = new Set(s.done);
  let scanError = null, foundN = 0;
  try {
    const r = await scanForward(logsRpc, s, scanOpts);
    s.scannedTo = r.scannedTo; s.chunk = r.chunk;
    // Catching up counts as reading: an error after some chunks landed isn't blindness, the next run continues.
    scanError = r.progressed ? null : r.error;
    for (const f of r.found) {
      if (doneSet.has(f.txHash) || s.open[f.txHash]) continue;
      s.open[f.txHash] = { wallet: f.wallet, block: f.block, seenAt: t, tries: 0 };
      foundN++;
    }
  } catch (e) { scanError = String(e?.message || e); }

  // A watchdog that can't read the chain is blind: say so once after ~30 min, and once when it reads again.
  if (scanError) {
    s.scanFails++;
    if (s.scanFails === SCAN_FAILS_ALERT) s.alerts.push(`On-chain → Lab watchdog can't read Arbitrum logs (${SCAN_FAILS_ALERT} runs in a row): ${esc(scanError.slice(0, 160))}. Calls registered meanwhile are checked once it reads again, if still inside the 6h window.`);
  } else {
    if (s.scanFails >= SCAN_FAILS_ALERT) s.alerts.push("On-chain → Lab watchdog reads Arbitrum again.");
    s.scanFails = 0;
    s.lastReadAt = t;
  }

  let indexed = 0, attempted = 0;
  const finish = (tx) => { delete s.open[tx]; s.done.push(tx); doneSet.add(tx); };
  for (const [tx, o] of Object.entries(s.open).sort((a, b) => a[1].seenAt - b[1].seenAt)) {
    if (attempted >= MAX_INDEX_PER_RUN) break;
    if (t - o.seenAt < GRACE_MS) continue;
    attempted++;
    let res;
    try { res = await index(tx, o.wallet); } catch (e) { res = { status: 503, body: { error: String(e?.message || e) } }; }
    const j = judgeIndex(res);
    if (j.done) {
      finish(tx);
      if (j.alert === "indexed") { indexed++; s.late.push(t); s.alerts.push(alertLine("indexed", { wallet: o.wallet, txHash: tx, body: res.body, minutesSeen: Math.round((t - o.seenAt) / 60_000) })); }
      if (j.alert === "failed") s.alerts.push(alertLine("failed", { wallet: o.wallet, txHash: tx, body: res.body }));
    } else if (++o.tries >= MAX_TRIES) {
      finish(tx);
      s.alerts.push(alertLine("unconfirmed", { wallet: o.wallet, txHash: tx }));
    }
  }

  let sent = 0;
  if (s.alerts.length) {
    const ok = await send(s.alerts.join("\n\n"));
    if (ok) { sent = s.alerts.length; s.alerts = []; }
    else s.alerts = s.alerts.slice(-ALERTS_KEEP);   // kept: the next run tries again
  }
  s.done = s.done.slice(-DONE_KEEP);
  s.late = s.late.filter((x) => t - x <= LATE_WINDOW_MS);
  await env.LAB_STORE.put(REGWATCH_KEY, JSON.stringify(s));
  return { found: foundN, open: Object.keys(s.open).length, attempted, indexed, sent, held: s.alerts.length, scanError };
}

/**
 * The daily digest's line for the watchdog (opsDigest gatherFacts → digestText). Plain text; null state = never ran.
 * Blind = the last run couldn't read the chain; otherwise when it last read, and how many calls the publisher's path
 * skipped this week (each one the watchdog had to index itself).
 */
export function watchdogLine(state, now = Date.now()) {
  if (!state || typeof state !== "object") return "No run recorded yet.";
  const ago = (ms) => { const m = Math.max(0, Math.round((now - ms) / 60_000)); return m < 90 ? `${m} min ago` : `${Math.round(m / 60)}h ago`; };
  const late = (Array.isArray(state.late) ? state.late : []).filter((x) => now - x <= LATE_WINDOW_MS).length;
  const waiting = state.open && typeof state.open === "object" ? Object.keys(state.open).length : 0;
  const lateText = late ? `${late} call${late === 1 ? "" : "s"} indexed late in 7 days (the publisher skipped /theses/index)` : "no call needed indexing this week";
  if (Number(state.scanFails) > 0) {
    return `Can't read Arbitrum logs (${state.scanFails} run${state.scanFails === 1 ? "" : "s"} in a row${state.lastReadAt ? `, last read ${ago(state.lastReadAt)}` : ""}). Set ARBITRUM_RPC_URL if it keeps happening. ${lateText}.`;
  }
  return `Reading${state.lastReadAt ? `, last read ${ago(state.lastReadAt)}` : ""}. ${lateText[0].toUpperCase()}${lateText.slice(1)}.${waiting ? ` ${waiting} waiting for their grace period or a retry.` : ""}`;
}
