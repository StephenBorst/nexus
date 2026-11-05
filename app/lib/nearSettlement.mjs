// NEAR Intents 1Click: did the money actually arrive? Proven from the destination chain.
//
// nearIntents.mjs checkQuote proves, BEFORE the wallet signs, that the deposit address belongs
// to a quote 1Click signed for this user's swap. This module proves the END. 1Click's status
// API saying SUCCESS is a server's word; here:
//
// 1. The status reply is a list of POINTERS (tx hashes). Its amounts and its status word decide
//    nothing on their own.
// 2. Each pointed-to tx is read from its own chain (EVM receipt logs, Solana token balances,
//    Bitcoin outputs) and reduced to one number: how much of the PINNED asset it credited to the
//    address the user SIGNED FOR.
// 3. That on-chain total is compared with the floor 1Click SIGNED in the quote (minAmountOut;
//    refunds: what was sent − the signed refundFee), never with the status's amountOut.
//
// Fail closed: only DELIVERED and REFUNDED mean the money is where it should be. A chain read
// that fails, a transfer a receipt can't show, or a tx older than the quote never counts.
// Pure judge + readers over an injected chain call, so every rule is tested without the network.
// Used by the worker route GET /xc/settlement (routes-xcsettle.mjs); the card shows its verdict.

import { verifyQuoteSignature, sameAddress, XC_ASSETS } from "./nearIntents.mjs";

// ── What a delivery looks like on-chain, per asset ─────────────────────────────────────
// EVM token contracts come from XC_ASSETS (the table the deposit tx is built from). The Solana
// USDC mint is pinned here: 1Click's assetId hashes it, so XC_ASSETS has no token for it.
// Checked against GET https://1click.chaindefuser.com/v0/tokens (`contractAddress`) 2026-11-05.
export const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KIND = { arb: "evm", base: "evm", eth: "evm", sol: "sol", btc: "btc" };
export const SETTLEMENT_ASSETS = Object.fromEntries(Object.values(XC_ASSETS).map((a) => {
  const rule = { chain: a.chain, decimals: a.decimals, sym: a.sym };
  if (KIND[a.chain] === "evm") return [a.assetId, a.token ? { ...rule, kind: "erc20", token: a.token.toLowerCase() } : { ...rule, kind: "native" }];
  if (a.chain === "sol") return [a.assetId, a.sym === "USDC" ? { ...rule, kind: "spl", mint: SOL_USDC_MINT } : { ...rule, kind: "sol" }];
  return [a.assetId, { ...rule, kind: "btc" }];
}));

export const IN_FLIGHT = new Set(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING"]);
export const SETTLED = new Set(["DELIVERED", "REFUNDED"]);
// Worth asking again later (the chain may still catch up); every other verdict is final.
export const RECHECK = new Set(["PENDING", "CONFIRMING", "UNREAD", "UNPROVEN"]);

// ERC-20 Transfer(address,address,uint256)
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad32 = (addr) => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const big = (v) => { try { return BigInt(v); } catch { return null; } };
const errMsg = (e) => String((e && e.message) || e).slice(0, 120);

// ── Readers: one tx → what it credited `to`, in base units ─────────────────────────────
// `call(method, params)` returns the JSON-RPC result or throws. Every reader returns
// { ok:true, credited:bigint, final:boolean, timeMs, opaque?, note? } or { ok:false, reason }.
// `opaque` = the chain may have moved value in a way this read can't see (native coin inside a
// contract call), so a zero is "unproven", not "short".

export async function readEvmCredit({ call, hash, asset, to }) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "not an EVM tx hash" };
    const receipt = await call("eth_getTransactionReceipt", [hash]);
    if (!receipt) return { ok: false, reason: "tx not found" };
    const [block, fin] = await Promise.all([
      call("eth_getBlockByNumber", [receipt.blockNumber, false]),
      call("eth_getBlockByNumber", ["finalized", false]),
    ]);
    if (!block) return { ok: false, reason: "block not found" };
    const timeMs = Number(BigInt(block.timestamp)) * 1000;
    const final = !!fin && BigInt(fin.number) >= BigInt(receipt.blockNumber);
    if (receipt.status !== "0x1") return { ok: true, credited: 0n, final, timeMs, note: "reverted" };

    if (asset.kind === "erc20") {
      let credited = 0n;
      for (const log of receipt.logs || []) {
        if (log.removed) continue;
        if (String(log.address).toLowerCase() !== asset.token) continue;
        const t = log.topics || [];
        if (t.length !== 3 || String(t[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
        if (String(t[2]).toLowerCase() !== pad32(to)) continue;
        const v = big(log.data);
        if (v != null && v > 0n) credited += v;
      }
      return { ok: true, credited, final, timeMs };
    }
    if (asset.kind === "native") {
      const tx = await call("eth_getTransactionByHash", [hash]);
      if (!tx) return { ok: false, reason: "tx not found" };
      if (tx.to && sameAddress(tx.to, to)) return { ok: true, credited: big(tx.value) ?? 0n, final, timeMs };
      return { ok: true, credited: 0n, final, timeMs, opaque: true, note: "native value not visible in the receipt" };
    }
    return { ok: false, reason: `asset kind ${asset.kind} is not EVM` };
  } catch (e) {
    return { ok: false, reason: errMsg(e) };
  }
}

export async function readSolCredit({ call, hash, asset, to }) {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(hash)) return { ok: false, reason: "not a Solana signature" };
    const ask = (commitment) => call("getTransaction", [hash, { encoding: "jsonParsed", commitment, maxSupportedTransactionVersion: 0 }]);
    let tx = await ask("finalized");
    let final = true;
    if (!tx) { tx = await ask("confirmed"); final = false; }
    if (!tx) return { ok: false, reason: "tx not found" };
    const timeMs = (tx.blockTime ?? 0) * 1000;
    if (tx.meta?.err) return { ok: true, credited: 0n, final, timeMs, note: "failed" };

    if (asset.kind === "spl") {
      const owned = (rows) => (rows || []).filter((b) => b.owner === to && b.mint === asset.mint);
      const pre = new Map(owned(tx.meta?.preTokenBalances).map((b) => [b.accountIndex, big(b.uiTokenAmount?.amount) ?? 0n]));
      let credited = 0n;
      for (const b of owned(tx.meta?.postTokenBalances)) {
        const d = (big(b.uiTokenAmount?.amount) ?? 0n) - (pre.get(b.accountIndex) ?? 0n);
        if (d > 0n) credited += d;
      }
      return { ok: true, credited, final, timeMs };
    }
    if (asset.kind === "sol") {
      const keys = (tx.transaction?.message?.accountKeys || []).map((k) => (typeof k === "string" ? k : k.pubkey));
      const i = keys.indexOf(to);
      if (i < 0) return { ok: true, credited: 0n, final, timeMs };
      const d = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
      return { ok: true, credited: d > 0n ? d : 0n, final, timeMs };
    }
    return { ok: false, reason: `asset kind ${asset.kind} is not Solana` };
  } catch (e) {
    return { ok: false, reason: errMsg(e) };
  }
}

// Bitcoin: `call(path)` = a mempool.space-style GET returning JSON (e.g. "/tx/<txid>").
export async function readBtcCredit({ call, hash, to }) {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "not a bitcoin txid" };
    const tx = await call(`/tx/${hash}`);
    if (!tx) return { ok: false, reason: "tx not found" };
    let credited = 0n;
    for (const o of tx.vout || []) if (o.scriptpubkey_address === to) credited += BigInt(o.value);
    return { ok: true, credited, final: !!tx.status?.confirmed, timeMs: (tx.status?.block_time ?? 0) * 1000 };
  } catch (e) {
    return { ok: false, reason: errMsg(e) };
  }
}

const READERS = { evm: readEvmCredit, sol: readSolCredit, btc: readBtcCredit };
export const chainKind = (chain) => KIND[chain] || null;

// ── The plan: which txs to read, for what, against which bar ───────────────────────────
// `quoteResponse` = a signed quote for this deposit address. The worker passes the copy echoed in
// the status reply, re-verified here; the card also compares the result's recipient with its own.
// `deposited` (optional) = what was actually sent, if it differs from the quoted amountIn.
export function planSettlement(quoteResponse, status, { depositAddress, deposited } = {}) {
  const qr = quoteResponse?.quoteRequest, q = quoteResponse?.quote;
  if (!qr || !q) return { verdict: "MALFORMED", reason: "no quote" };
  if (!verifyQuoteSignature(quoteResponse)) return { verdict: "MALFORMED", reason: "the quote does not verify against 1Click's key" };
  if (depositAddress && q.depositAddress !== depositAddress) return { verdict: "MISMATCH", reason: "the quote is for another deposit address" };

  const echo = status?.quoteResponse;
  if (echo && (echo.signature !== quoteResponse.signature || echo.quote?.depositAddress !== q.depositAddress)) {
    return { verdict: "MISMATCH", reason: "the status reply is for a different quote" };
  }
  const word = status?.status;
  if (!word) return { verdict: "UNREAD", reason: "no status" };
  if (IN_FLIGHT.has(word)) return { verdict: "PENDING", status: word };

  const d = status.swapDetails || {};
  const hashes = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => (typeof x === "string" ? x : x?.hash)).filter((h) => typeof h === "string" && h))].slice(0, 10);
  const notBefore = Date.parse(quoteResponse.timestamp);

  if (word === "SUCCESS") {
    const asset = SETTLEMENT_ASSETS[qr.destinationAsset];
    if (!asset) return { verdict: "UNSUPPORTED", reason: `no on-chain rule for ${qr.destinationAsset}` };
    return { kind: "delivery", status: word, asset, to: qr.recipient, bar: BigInt(q.minAmountOut), notBefore, hashes: hashes(d.destinationChainTxHashes) };
  }
  if (word === "REFUNDED") {
    const asset = SETTLEMENT_ASSETS[qr.originAsset];
    if (!asset) return { verdict: "UNSUPPORTED", reason: `no on-chain rule for ${qr.originAsset}` };
    const sent = deposited != null ? BigInt(deposited) : BigInt(q.amountIn);
    const fee = big(q.refundFee) ?? 0n;
    // The origin list includes the user's own deposit; only transfers TO refundTo count, so it adds nothing.
    return { kind: "refund", status: word, asset, to: qr.refundTo, bar: sent > fee ? sent - fee : 0n, notBefore, hashes: hashes(d.originChainTxHashes) };
  }
  return { verdict: "NOT_SETTLED", status: word, reason: d.refundReason || word };
}

// ── The judge: reads in, one verdict out ───────────────────────────────────────────────
export function judgeSettlement(plan, reads) {
  if (plan.verdict) return { ...plan, final: false };
  let finalSum = 0n, anySum = 0n, unread = 0, opaque = 0, stale = 0;
  const txs = [];
  for (const r of reads) {
    const row = { hash: r.hash, ok: r.ok };
    if (!r.ok) { unread++; row.reason = r.reason; txs.push(row); continue; }
    row.credited = r.credited.toString(); row.final = r.final;
    if (r.note) row.note = r.note;
    if (r.opaque) opaque++;
    if (Number.isFinite(plan.notBefore) && r.timeMs && r.timeMs < plan.notBefore) {
      stale++; row.counted = false; row.note = "older than the quote"; txs.push(row); continue;
    }
    row.counted = r.credited > 0n;
    anySum += r.credited;
    if (r.final) finalSum += r.credited;
    txs.push(row);
  }
  const base = { kind: plan.kind, status: plan.status, chain: plan.asset.chain, asset: plan.asset.sym, decimals: plan.asset.decimals, to: plan.to, bar: plan.bar.toString(), credited: finalSum.toString(), txs };
  const DONE = plan.kind === "delivery" ? "DELIVERED" : "REFUNDED";
  const SHORT = plan.kind === "delivery" ? "SHORT" : "REFUND_SHORT";

  if (plan.bar > 0n && finalSum >= plan.bar) return { ...base, verdict: DONE, final: true };
  if (plan.bar > 0n && anySum >= plan.bar) return { ...base, verdict: "CONFIRMING", final: false, reason: "credited on-chain, not final yet" };
  if (!plan.hashes.length) return { ...base, verdict: "UNPROVEN", final: false, reason: `status says ${plan.status} but lists no ${plan.kind === "delivery" ? "destination" : "origin"} transaction` };
  if (unread) return { ...base, verdict: "UNREAD", final: false, reason: `${unread} transaction(s) could not be read` };
  if (opaque) return { ...base, verdict: "UNPROVEN", final: false, reason: "value may have moved inside a contract call; the receipt can't show it" };
  if (anySum > finalSum) return { ...base, verdict: "CONFIRMING", final: false, reason: "not final yet" };
  return { ...base, verdict: SHORT, final: true, reason: stale ? `${stale} listed transaction(s) predate the quote` : "on-chain credit is below the signed floor" };
}

// ── One call: status in, chain reads, verdict out ──────────────────────────────────────
// callers = { evm: { arb, base, eth }, sol, btc } — each a `call` function for that chain.
export async function checkSettlement(quoteResponse, status, { callers, depositAddress, deposited } = {}) {
  const plan = planSettlement(quoteResponse, status, { depositAddress, deposited });
  if (plan.verdict) return judgeSettlement(plan, []);
  const kind = chainKind(plan.asset.chain);
  const call = kind === "evm" ? callers?.evm?.[plan.asset.chain] : callers?.[kind];
  if (typeof call !== "function") return { verdict: "UNREAD", final: false, reason: `no reader for ${plan.asset.chain}` };
  const reads = [];
  for (const hash of plan.hashes) reads.push({ hash, ...(await READERS[kind]({ call, hash, asset: plan.asset, to: plan.to })) });
  return judgeSettlement(plan, reads);
}

// ── What the card says ─────────────────────────────────────────────────────────────────
// status = 1Click's word; check = GET /xc/settlement's reply (or null while it hasn't answered);
// recipient / refundTo = what the CARD sent the quote for. A check whose recipient isn't ours is
// treated as a mismatch, whatever its verdict. tone: "pos" (money arrived, proven) · "neg" ·
// "neutral" (working) · "muted" (1Click's word only, not proven on-chain).
const CHAIN_LABEL = { arb: "Arbitrum", base: "Base", eth: "Ethereum", sol: "Solana", btc: "Bitcoin" };
export function settlementLine(status, check, { recipient, refundTo } = {}) {
  if (status !== "SUCCESS" && status !== "REFUNDED") return null;
  const refund = status === "REFUNDED";
  const claim = refund ? "1Click reports a refund" : "1Click reports delivered";
  if (!check || check.error) return { text: `${claim} · checking the chain…`, tone: "neutral" };
  const on = CHAIN_LABEL[check.chain] || "the chain";
  const ours = refund ? refundTo : recipient;
  if (check.to && ours && !sameAddress(check.to, ours)) return { text: `${claim}, but to another address. Check the explorer.`, tone: "neg" };
  switch (check.verdict) {
    case "DELIVERED": return refund ? null : { text: `Delivered · confirmed on ${on}`, tone: "pos" };
    case "REFUNDED": return refund ? { text: `Refunded to your wallet · confirmed on ${on}`, tone: "neutral" } : null;
    case "CONFIRMING": return { text: `${refund ? "Refund" : "Delivery"} seen on ${on} · waiting for finality`, tone: "neutral" };
    case "PENDING": case "UNREAD": return { text: `${claim} · checking ${on}…`, tone: "neutral" };
    case "SHORT": case "REFUND_SHORT": return { text: `${claim}, but ${on} shows less than the signed minimum. Check the explorer.`, tone: "neg" };
    case "MISMATCH": case "MALFORMED": return { text: `${claim}, but its signed quote doesn't match this transfer. Check the explorer.`, tone: "neg" };
    default: return { text: `${claim} · not confirmed on-chain`, tone: "muted" };
  }
}
