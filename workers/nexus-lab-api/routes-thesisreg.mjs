// ── Registering a call on-chain: POST /proxy/thesis-register and POST /theses/index ─────────────
// Rules in thesisRegister.mjs. This file is the I/O around them: Arbitrum RPC, Bankr, KV.
//
// /proxy/thesis-register {walletAddress, bankrApiKey, symbol, direction, entryPrice, stopLoss,
//   takeProfit1, takeProfit2?, isPublic?, notes?, exitPlan?, retry?}
//   1. checkRegistration, then an eth_call of the exact calldata from the wallet: a call that would
//      revert is refused here, before any gas.
//   2. The same call from the same wallet can't be sent twice within PENDING_TTL_S. A repeat gets the
//      first submit's txHash (and is indexed from it), or 409 while the first is still in flight /
//      its outcome is unknown. `retry: true` overrides only a submit Bankr said FAILED.
//      KV has no compare-and-set: the marker blocks a repeat that arrives after it's written. Two
//      identical requests in the same isolate are serialised by `inflight`; two landing on different
//      isolates at the same instant can both be sent (a Durable Object would close that; not built).
//      The skill says so: send one request and wait for its answer.
//   3. Bankr /wallet/submit. A receipt not readable within ~15 s answers 202 with the txHash: the
//      call is on its way, and POST /theses/index {txHash, walletAddress} finishes the job.
// /theses/index {txHash, walletAddress}: no key. Proves the registration from the chain
//   (provenRegistration) and writes the call built from its calldata. Idempotent: the call's id is
//   derived from the txHash, and a call already holding that txHash is returned as is.
import { json } from "./shared.mjs";
import { prepareSeal } from "./labWrite.mjs";
import {
  checkRegistration, encodeRegisterThesis, provenRegistration, thesisFromRegistration, pendingKey,
  THESIS_REGISTRY, ARBITRUM_CHAIN_ID, PENDING_TTL_S, INDEX_MAX_AGE_MS, perpSymbol,
} from "./thesisRegister.mjs";
import { makeRateLimiter } from "./keyProxy.mjs";

const BANKR_SUBMIT = "https://api.bankr.bot/wallet/submit";
const BANKR_TIMEOUT_MS = 45_000;
const RECEIPT_TRIES = 10, RECEIPT_GAP_MS = 1500;
const WALLET_RE = /^0x[0-9a-f]{40}$/;
const TX_RE = /^0x[0-9a-f]{64}$/;

const registerLimiter = makeRateLimiter({ limit: 10, windowMs: 60_000 });
// Pending keys this isolate is working on right now (see step 2 above).
const inflight = new Set();
const indexLimiter = makeRateLimiter({ limit: 30, windowMs: 60_000 });

/** JSON-RPC over the given URLs in order: the first that answers wins. A JSON-RPC error is an
 *  answer (thrown with .rpcError), not a reason to try the next URL. */
export function makeRpc(urls, fetchImpl = globalThis.fetch) {
  return async function rpc(method, params) {
    let lastErr = null;
    for (const url of urls) {
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const d = await r.json();
        if (d && d.error) { const e = new Error(d.error.message || "rpc error"); e.rpcError = d.error; throw e; }
        if (d && "result" in d) return d.result;
        lastErr = new Error(`no result from ${method}`);
      } catch (e) {
        if (e && e.rpcError) throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error("no rpc");
  };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (s) => String(s || "").toLowerCase().trim();
const clip = (x) => { try { const s = JSON.stringify(x); return s.length > 600 ? s.slice(0, 600) + "…" : JSON.parse(s); } catch { return null; } };

async function readJson(kv, key) {
  try { return JSON.parse((await kv.get(key)) || "null"); } catch { return null; }
}

/**
 * Index one registration into the wallet's Lab record. { status, body } — the route serialises it.
 * `waitForReceipt` polls (the proxy, right after submitting); the index route asks once.
 */
export async function indexRegistration(env, { txHash, wallet, rpc, readMark, now = Date.now, waitForReceipt = false, sleep = sleepMs }) {
  const labKey = `lab:${wallet}`;
  const record = (await readJson(env.LAB_STORE, labKey)) || { theses: [] };
  const prev = Array.isArray(record.theses) ? record.theses : [];
  const have = prev.find((t) => t && lower(t.onChainTxHash) === txHash);
  if (have) return { status: 200, body: { ok: true, already: true, thesisId: have.id, txHash } };

  let receipt = null;
  for (let i = 0; i < (waitForReceipt ? RECEIPT_TRIES : 1) && !receipt; i++) {
    if (i) await sleep(RECEIPT_GAP_MS);
    try { receipt = await rpc("eth_getTransactionReceipt", [txHash]); } catch { receipt = null; }
  }
  if (!receipt) {
    return { status: 202, body: { ok: false, pending: true, txHash, hint: "Sent, not mined yet (or the receipt isn't readable yet). Nothing to resend: POST /theses/index {txHash, walletAddress} in a minute writes the call." } };
  }
  let input = null, block = null;
  try {
    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    input = tx && tx.input;
    block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  } catch { /* handled below */ }
  if (!input || !block) return { status: 503, body: { error: "chain_unreadable", txHash, hint: "The transaction couldn't be read from Arbitrum right now. Try /theses/index again shortly." } };

  const proven = provenRegistration({ receipt, input, wallet });
  if (proven.error) return { status: proven.error === "receipt_unavailable" ? 202 : 422, body: { error: proven.error, hint: proven.hint, txHash } };
  const blockTimeMs = parseInt(block.timestamp, 16) * 1000;
  if (!(blockTimeMs > 0)) return { status: 503, body: { error: "chain_unreadable", txHash, hint: "The block time couldn't be read." } };
  if (now() - blockTimeMs > INDEX_MAX_AGE_MS) {
    return { status: 422, body: { error: "too_old", txHash, hint: `Only registrations from the last ${INDEX_MAX_AGE_MS / 3600000}h can be indexed: a call is graded from when it lands in the Lab.` } };
  }
  const thesis = thesisFromRegistration(proven, { txHash, blockTimeMs });
  const prep = await prepareSeal(env, wallet, prev, [thesis, ...prev], now(), { readMark });
  if (prep.error) return { status: 400, body: { error: prep.error, txHash } };
  // The lock refused to publish it (another wallet's id, a split with TP2 not beyond TP1): nothing is
  // written, and the answer says why, never "in /feed".
  const refusal = prep.sealed.refused.find((r) => r.id === thesis.id);
  if (refusal) return { status: 422, body: { error: "publish_refused", reason: refusal.reason, txHash } };
  await prep.commit(record);
  const saved = prep.sealed.theses.find((t) => t.id === thesis.id) || thesis;
  return {
    status: 200,
    body: {
      ok: true, txHash, thesisId: saved.id, onChainId: saved.onChainId ?? null,
      symbol: saved.symbol, direction: saved.direction, entryPrice: saved.entryPrice, stopLoss: saved.stopLoss,
      takeProfit1: saved.takeProfit1, takeProfit2: saved.takeProfit2, riskReward: saved.riskReward,
      exitPlan: saved.exitPlan ?? null, isPublic: saved.isPublic, publishedAt: saved.publishedAt ?? null,
      hint: "Registered on-chain and in /feed. Graded from public price from now on.",
    },
  };
}

async function proxyRegister(body, request, env, deps) {
  const wallet = lower(body.walletAddress);
  if (!WALLET_RE.test(wallet) || !body.bankrApiKey) {
    return json({ error: "missing required fields: walletAddress (0x…), bankrApiKey, symbol, direction, entryPrice, stopLoss, takeProfit1" }, request, 400);
  }
  const bad = checkRegistration(body);
  if (bad) return json(bad, request, 400);
  const calldata = encodeRegisterThesis(body);
  const kv = env.LAB_STORE;
  const key = await pendingKey(wallet, calldata);
  if (inflight.has(key)) {
    return json({ error: "in_flight", hint: "This exact call is being sent right now. Don't resend: wait for the first request's answer." }, request, 409);
  }
  inflight.add(key);
  try {
    return await proxyRegisterOnce(body, request, env, deps, { wallet, calldata, kv, key });
  } finally {
    inflight.delete(key);
  }
}

async function proxyRegisterOnce(body, request, env, deps, { wallet, calldata, kv, key }) {
  const { rpc, readMark, now, fetchImpl, sleep } = deps;
  const prior = await readJson(kv, key);
  if (prior && prior.txHash) {
    // Already sent: never pay twice. Finish indexing from the first submit.
    const r = await indexRegistration(env, { txHash: prior.txHash, wallet, rpc, readMark, now, sleep });
    return json({ ...r.body, resent: false, note: "This exact call was already sent; nothing new was submitted." }, request, r.status);
  }
  if (prior && !(prior.failed && body.retry === true)) {
    return json({
      error: prior.failed ? "recent_failure" : "in_flight", since: prior.at, detail: prior.detail ?? null,
      hint: prior.failed
        ? "Bankr reported this exact call failed a few minutes ago. Check the wallet's last Arbitrum transaction: if a registration landed, POST /theses/index {txHash, walletAddress}. To send again anyway, repeat with retry: true."
        : "This exact call was sent and its outcome isn't known yet. Don't resend: check the wallet's last Arbitrum transaction and POST /theses/index {txHash, walletAddress}, or wait 15 minutes.",
    }, request, 409);
  }

  // Would it revert? Same calldata, same sender, no gas.
  try {
    await rpc("eth_call", [{ from: wallet, to: THESIS_REGISTRY, data: calldata }, "latest"]);
  } catch (e) {
    if (e && e.rpcError) return json({ error: "would_revert", detail: clip(e.rpcError), hint: "The registry would reject this call, so nothing was sent and no gas was spent." }, request, 400);
    return json({ error: "simulation_unavailable", hint: "Arbitrum couldn't be reached to check the call first, so nothing was sent. Try again shortly." }, request, 503);
  }

  await kv.put(key, JSON.stringify({ at: now() }), { expirationTtl: PENDING_TTL_S });
  let bankrData = null, unknown = null;
  try {
    const res = await fetchImpl(BANKR_SUBMIT, {
      method: "POST",
      headers: { "X-API-Key": body.bankrApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction: { to: THESIS_REGISTRY, chainId: ARBITRUM_CHAIN_ID, value: "0", data: calldata },
        description: `Register ${String(body.direction).toUpperCase()} thesis for ${perpSymbol(body.symbol)} on ThesisRegistry`,
        waitForConfirmation: true,
      }),
      signal: AbortSignal.timeout(BANKR_TIMEOUT_MS),
    });
    try { bankrData = await res.json(); } catch { bankrData = { status: res.status, unreadable: true }; }
  } catch (e) {
    unknown = String((e && e.name) || e);
  }
  const txHash = lower(bankrData && (bankrData.txHash || bankrData.transactionHash || bankrData.hash || bankrData.transaction?.hash));
  if (TX_RE.test(txHash)) {
    await kv.put(key, JSON.stringify({ at: now(), txHash }), { expirationTtl: PENDING_TTL_S });
    const r = await indexRegistration(env, { txHash, wallet, rpc, readMark, now, sleep, waitForReceipt: true });
    return json(r.body, request, r.status);
  }
  if (unknown || (bankrData && bankrData.success)) {
    // Sent or not, we can't tell: keep the block so an automatic retry can't pay a second time.
    return json({
      error: unknown ? "bankr_timeout" : "bankr_no_tx_hash", detail: clip(bankrData) ?? unknown,
      hint: "Bankr didn't return a transaction hash, so it's unknown whether the call was sent. Don't resend: check the wallet's last Arbitrum transaction and POST /theses/index {txHash, walletAddress}.",
    }, request, 502);
  }
  await kv.put(key, JSON.stringify({ at: now(), failed: true, detail: clip(bankrData) }), { expirationTtl: PENDING_TTL_S });
  return json({ error: "bankr_submit_failed", detail: clip(bankrData), hint: "Bankr refused the transaction. Check the wallet's last Arbitrum transaction before sending again (repeat with retry: true)." }, request, 502);
}

/**
 * The two routes, or null when the path isn't one of them.
 * deps: { rpcUrls, readMark, fetchImpl?, now?, sleep? }
 */
export async function handleThesisRegistration(parts, request, env, deps = {}) {
  const isProxy = parts[0] === "proxy" && parts[1] === "thesis-register" && parts.length === 2;
  const isIndex = parts[0] === "theses" && parts[1] === "index" && parts.length === 2;
  if (!isProxy && !isIndex) return null;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, request, 405);
  const now = deps.now || Date.now;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if ((isProxy ? registerLimiter : indexLimiter)(ip, now())) return json({ error: "rate_limited" }, request, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, request, 400);
  const rpc = deps.rpc || makeRpc(deps.rpcUrls || [], fetchImpl);
  const d = { rpc, readMark: deps.readMark, now, fetchImpl, sleep: deps.sleep || sleepMs };
  if (isProxy) return proxyRegister(body, request, env, d);

  const wallet = lower(body.walletAddress), txHash = lower(body.txHash);
  if (!WALLET_RE.test(wallet) || !TX_RE.test(txHash)) return json({ error: "txHash (0x + 64 hex) and walletAddress (0x + 40 hex) required" }, request, 400);
  const r = await indexRegistration(env, { txHash, wallet, rpc, readMark: d.readMark, now });
  return json(r.body, request, r.status);
}
