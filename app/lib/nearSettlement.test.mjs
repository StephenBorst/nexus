// Settlement check. Quotes and the PENDING status are REAL 1Click replies (signed, no funds sent;
// usdc-base / usdc-sol / status-pending fetched 2026-11-05). Chain replies are built here in the
// standard JSON-RPC / mempool.space shapes; a fake node throws on anything a test didn't define.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planSettlement, judgeSettlement, checkSettlement, readEvmCredit, readSolCredit, readBtcCredit,
  SETTLEMENT_ASSETS, SOL_USDC_MINT, TRANSFER_TOPIC, RECHECK, SETTLED,
} from "./nearSettlement.mjs";
import { XC_ASSETS } from "./nearIntents.mjs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)));
const clone = (o) => JSON.parse(JSON.stringify(o));

const LIVE = fx("oneclick-quote-live");            // USDC.arb → ETH.base (native); recipient = refundTo = USER
const FEE = fx("oneclick-quote-fee");              // another real quote, same pair
const USDC_BASE = fx("oneclick-quote-usdc-base");  // USDC.arb → USDC.base (erc20)
const USDC_SOL = fx("oneclick-quote-usdc-sol");    // USDC.arb → USDC.sol (spl)
const PENDING = fx("oneclick-status-pending");     // real status reply for LIVE's deposit address
const USER = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const SOL_USER = "6uB2ugTM4m7P1BpEG6pLAc2B327nb75JUqVE6svoMRWT";
const USDC_BASE_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB_TOKEN = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const SOLVER = "0x2cff890f0378a11913b6129b2e97417a2c302680";

const h = (n) => "0x" + String(n).padStart(64, "0");
const secs = (iso, plus = 0) => Math.floor(Date.parse(iso) / 1000) + plus;
const hex = (n) => "0x" + BigInt(n).toString(16);
const topicAddr = (a) => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
const transferLog = (token, from, to, amount) => ({ address: token, topics: [TRANSFER_TOPIC, topicAddr(from), topicAddr(to)], data: hex(amount), removed: false });

function status(quote, word, { dest = [], origin = [], amountOut = null } = {}) {
  const s = clone(PENDING);
  s.status = word;
  s.quoteResponse = clone(quote);
  s.swapDetails.destinationChainTxHashes = dest.map((hash) => ({ hash, explorerUrl: "x" }));
  s.swapDetails.originChainTxHashes = origin.map((hash) => ({ hash, explorerUrl: "x" }));
  s.swapDetails.amountOut = amountOut;
  return s;
}

// Fake EVM chain: txs = { hash: { block, time, status, logs, to, value } }.
function evm(txs, { finalized = 1000, fail = false } = {}) {
  const calls = [];
  const call = async (method, params) => {
    calls.push(method);
    if (fail) throw new Error("all RPCs failed");
    if (method === "eth_getTransactionReceipt") { const t = txs[params[0]]; return t ? { blockNumber: hex(t.block), status: t.status ?? "0x1", logs: t.logs || [] } : null; }
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "finalized") return { number: hex(finalized) };
      const t = Object.values(txs).find((x) => hex(x.block) === params[0]);
      return t ? { number: params[0], timestamp: hex(t.time) } : null;
    }
    if (method === "eth_getTransactionByHash") { const t = txs[params[0]]; return t ? { to: t.to ?? null, value: hex(t.value ?? 0) } : null; }
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls };
}
const onChain = (chain, node) => ({ evm: { [chain]: node.call } });
const run = (quote, st, callers, extra = {}) => checkSettlement(quote, st, { callers, depositAddress: quote.quote.depositAddress, ...extra });

// ── Pins ──────────────────────────────────────────────────────────────────────────────

test("every XC_ASSETS entry has an on-chain rule; EVM tokens match the table the deposit tx is built from", () => {
  for (const a of Object.values(XC_ASSETS)) {
    const r = SETTLEMENT_ASSETS[a.assetId];
    assert.ok(r, a.assetId);
    assert.equal(r.chain, a.chain);
    if (a.token) assert.deepEqual([r.kind, r.token], ["erc20", a.token.toLowerCase()]);
  }
  assert.equal(SETTLEMENT_ASSETS["nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"].mint, SOL_USDC_MINT);
  assert.equal(SETTLEMENT_ASSETS["nep141:base.omft.near"].kind, "native");
  assert.equal(SETTLEMENT_ASSETS["1cs_v1:btc:native:coin"].kind, "btc");
});

test("only DELIVERED and REFUNDED are settled; neither is ever re-checked", () => {
  assert.deepEqual([...SETTLED].sort(), ["DELIVERED", "REFUNDED"]);
  for (const v of SETTLED) assert.equal(RECHECK.has(v), false);
});

// ── Binding the status to the quote ───────────────────────────────────────────────────

test("the real PENDING status binds to the real quote and reads PENDING with no chain read", async () => {
  const node = evm({});
  const r = await run(LIVE, PENDING, onChain("base", node));
  assert.equal(r.verdict, "PENDING");
  assert.equal(node.calls.length, 0);
});

test("a status echoing a different quote → MISMATCH; a quote for another deposit address → MISMATCH", () => {
  assert.equal(planSettlement(FEE, PENDING).verdict, "MISMATCH");
  assert.equal(planSettlement(LIVE, PENDING, { depositAddress: FEE.quote.depositAddress }).verdict, "MISMATCH");
});

test("a quote that no longer verifies is refused before anything else", () => {
  const q = clone(LIVE);
  q.quote.minAmountOut = "1";
  assert.equal(planSettlement(q, PENDING).verdict, "MALFORMED");
});

test("FAILED and INCOMPLETE_DEPOSIT are NOT_SETTLED, never a delivery", () => {
  for (const w of ["FAILED", "INCOMPLETE_DEPOSIT"]) assert.equal(planSettlement(LIVE, status(LIVE, w)).verdict, "NOT_SETTLED");
});

// ── ERC-20 delivery (real USDC.arb → USDC.base quote) ─────────────────────────────────

const MIN = BigInt(USDC_BASE.quote.minAmountOut);
const T = secs(USDC_BASE.timestamp, 60);

test("SUCCESS + a final Transfer of the pinned token to the signed recipient ≥ the signed floor → DELIVERED", async () => {
  const node = evm({ [h(1)]: { block: 900, time: T, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, MIN)] } });
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", node));
  assert.equal(r.verdict, "DELIVERED", r.reason);
  assert.deepEqual([r.final, r.credited, r.chain, r.asset, r.decimals], [true, MIN.toString(), "base", "USDC", 6]);
});

test("the status's amountOut decides nothing: over-claimed or lowered to match a short delivery, it's SHORT", async () => {
  const short = MIN - 1000n;
  for (const amountOut of ["999999999999", short.toString()]) {
    const node = evm({ [h(1)]: { block: 900, time: T, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, short)] } });
    const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)], amountOut }), onChain("base", node));
    assert.equal(r.verdict, "SHORT", amountOut);
    assert.equal(r.bar, MIN.toString(), "the bar is the SIGNED minAmountOut");
  }
});

test("a look-alike token contract, or a transfer to someone else, is not counted", async () => {
  for (const log of [transferLog("0x1111111111111111111111111111111111111111", SOLVER, USER, MIN * 10n), transferLog(USDC_BASE_TOKEN, SOLVER, "0x2222222222222222222222222222222222222222", MIN)]) {
    const node = evm({ [h(1)]: { block: 900, time: T, logs: [log] } });
    const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", node));
    assert.equal(r.verdict, "SHORT");
    assert.equal(r.credited, "0");
  }
});

test("a tx that paid you before the quote existed is not this swap's delivery", async () => {
  const node = evm({ [h(1)]: { block: 900, time: secs(USDC_BASE.timestamp, -3600), logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, MIN)] } });
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", node));
  assert.equal(r.verdict, "SHORT");
  assert.match(r.reason, /predate the quote/);
  assert.equal(r.txs[0].counted, false);
});

test("a reverted tx credits nothing; a removed (reorged) log is ignored", async () => {
  const reverted = evm({ [h(1)]: { block: 900, time: T, status: "0x0", logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, MIN)] } });
  assert.equal((await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", reverted))).verdict, "SHORT");
  const reorged = evm({ [h(1)]: { block: 900, time: T, logs: [{ ...transferLog(USDC_BASE_TOKEN, SOLVER, USER, MIN), removed: true }] } });
  assert.equal((await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", reorged))).verdict, "SHORT");
});

test("two partial deliveries add up; the same hash listed twice counts once", async () => {
  const half = MIN / 2n + 1n;
  const node = evm({
    [h(1)]: { block: 900, time: T, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, half)] },
    [h(2)]: { block: 901, time: T + 5, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, half)] },
  });
  assert.equal((await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1), h(2)] }), onChain("base", node))).verdict, "DELIVERED");
  const dup = evm({ [h(1)]: { block: 900, time: T, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, half)] } });
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1), h(1)] }), onChain("base", dup));
  assert.equal(r.verdict, "SHORT");
  assert.equal(r.txs.length, 1);
});

test("credited but past the finalized block → CONFIRMING (re-checked), not DELIVERED", async () => {
  const node = evm({ [h(1)]: { block: 1200, time: T, logs: [transferLog(USDC_BASE_TOKEN, SOLVER, USER, MIN)] } }, { finalized: 1000 });
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", node));
  assert.equal(r.verdict, "CONFIRMING");
  assert.ok(RECHECK.has(r.verdict));
});

test("a chain that can't be read → UNREAD, never DELIVERED and never SHORT", async () => {
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), onChain("base", evm({}, { fail: true })));
  assert.equal(r.verdict, "UNREAD");
});

test("no reader for the destination chain → UNREAD", async () => {
  const r = await run(USDC_BASE, status(USDC_BASE, "SUCCESS", { dest: [h(1)] }), { evm: {} });
  assert.equal(r.verdict, "UNREAD");
});

test("SUCCESS that lists no destination tx → UNPROVEN", async () => {
  assert.equal((await run(USDC_BASE, status(USDC_BASE, "SUCCESS"), onChain("base", evm({})))).verdict, "UNPROVEN");
});

// ── Native coin delivery (real USDC.arb → ETH.base quote) ─────────────────────────────

test("native ETH sent straight to the recipient ≥ floor → DELIVERED", async () => {
  const node = evm({ [h(7)]: { block: 900, time: secs(LIVE.timestamp, 60), to: USER, value: LIVE.quote.minAmountOut } });
  assert.equal((await run(LIVE, status(LIVE, "SUCCESS", { dest: [h(7)] }), onChain("base", node))).verdict, "DELIVERED");
});

test("native ETH moved inside a contract call can't be seen in a receipt → UNPROVEN, not SHORT", async () => {
  const node = evm({ [h(7)]: { block: 900, time: secs(LIVE.timestamp, 60), to: "0x3333333333333333333333333333333333333333", value: 0 } });
  const r = await run(LIVE, status(LIVE, "SUCCESS", { dest: [h(7)] }), onChain("base", node));
  assert.equal(r.verdict, "UNPROVEN");
  assert.match(r.reason, /contract call/);
});

// ── Refunds (real quote: origin USDC.arb, refundTo = USER) ────────────────────────────

const OWED = BigInt(LIVE.quote.amountIn) - BigInt(LIVE.quote.refundFee);

test("REFUNDED + a transfer back to refundTo ≥ amountIn − the SIGNED refund fee → REFUNDED; your own deposit adds nothing", async () => {
  const node = evm({
    [h(10)]: { block: 900, time: secs(LIVE.timestamp, 30), logs: [transferLog(USDC_ARB_TOKEN, USER, LIVE.quote.depositAddress, LIVE.quote.amountIn)] },
    [h(11)]: { block: 950, time: secs(LIVE.timestamp, 120), logs: [transferLog(USDC_ARB_TOKEN, LIVE.quote.depositAddress, USER, OWED)] },
  });
  const r = await run(LIVE, status(LIVE, "REFUNDED", { origin: [h(10), h(11)] }), onChain("arb", node));
  assert.equal(r.verdict, "REFUNDED", r.reason);
  assert.equal(r.bar, OWED.toString());
  assert.equal(r.txs.find((x) => x.hash === h(10)).credited, "0");
});

test("a refund below what's owed → REFUND_SHORT; a partial deposit is owed back on what was sent", async () => {
  const short = evm({ [h(11)]: { block: 950, time: secs(LIVE.timestamp, 120), logs: [transferLog(USDC_ARB_TOKEN, SOLVER, USER, OWED - 1n)] } });
  assert.equal((await run(LIVE, status(LIVE, "REFUNDED", { origin: [h(11)] }), onChain("arb", short))).verdict, "REFUND_SHORT");
  const sent = 5_000_000n;
  const partial = evm({ [h(11)]: { block: 950, time: secs(LIVE.timestamp, 120), logs: [transferLog(USDC_ARB_TOKEN, SOLVER, USER, sent - BigInt(LIVE.quote.refundFee))] } });
  assert.equal((await run(LIVE, status(LIVE, "REFUNDED", { origin: [h(11)] }), onChain("arb", partial), { deposited: sent })).verdict, "REFUNDED");
});

// ── Solana token delivery (real USDC.arb → USDC.sol quote) ────────────────────────────

const SIG = "5".repeat(87);
function sol(tx, { finalized = true } = {}) {
  return async (method, params) => {
    if (method !== "getTransaction") throw new Error(`unexpected ${method}`);
    return params[1].commitment === "finalized" && !finalized ? null : tx;
  };
}
const SOL_MIN = BigInt(USDC_SOL.quote.minAmountOut);
const tb = (i, owner, mint, amount) => ({ accountIndex: i, owner, mint, uiTokenAmount: { amount: String(amount) } });
const solTx = (pre, post) => ({ blockTime: secs(USDC_SOL.timestamp, 60), meta: { err: null, preTokenBalances: pre, postTokenBalances: post, preBalances: [], postBalances: [] }, transaction: { message: { accountKeys: [] } } });
const runSol = (tx, opts) => run(USDC_SOL, status(USDC_SOL, "SUCCESS", { dest: [SIG] }), { sol: sol(tx, opts) });

test("Solana: a USDC increase on the recipient's own account ≥ floor, finalized → DELIVERED; a first-ever account counts from zero", async () => {
  const r = await runSol(solTx([tb(2, SOL_USER, SOL_USDC_MINT, 1_000)], [tb(2, SOL_USER, SOL_USDC_MINT, 1_000n + SOL_MIN)]));
  assert.equal(r.verdict, "DELIVERED", r.reason);
  assert.equal(r.credited, SOL_MIN.toString());
  assert.equal((await runSol(solTx([], [tb(3, SOL_USER, SOL_USDC_MINT, SOL_MIN)]))).verdict, "DELIVERED");
});

test("Solana: another mint, or another owner, is not counted", async () => {
  const tx = solTx([], [tb(3, SOL_USER, "So11111111111111111111111111111111111111112", SOL_MIN * 9n), tb(4, "Other1111111111111111111111111111111111111", SOL_USDC_MINT, SOL_MIN)]);
  assert.equal((await runSol(tx)).verdict, "SHORT");
});

test("Solana: confirmed but not finalized → CONFIRMING; a failed tx credits nothing", async () => {
  assert.equal((await runSol(solTx([], [tb(3, SOL_USER, SOL_USDC_MINT, SOL_MIN)]), { finalized: false })).verdict, "CONFIRMING");
  const failed = solTx([], [tb(3, SOL_USER, SOL_USDC_MINT, SOL_MIN)]);
  failed.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal((await runSol(failed)).verdict, "SHORT");
});

test("Solana native SOL: lamport increase on the recipient's key", async () => {
  const tx = { blockTime: 2_000_000_000, meta: { err: null, preBalances: [5, 100], postBalances: [4, 600] }, transaction: { message: { accountKeys: [{ pubkey: "Payer" }, { pubkey: SOL_USER }] } } };
  const r = await readSolCredit({ call: sol(tx), hash: SIG, asset: SETTLEMENT_ASSETS["nep141:sol.omft.near"], to: SOL_USER });
  assert.deepEqual([r.credited, r.final], [500n, true]);
});

// ── Bitcoin ───────────────────────────────────────────────────────────────────────────

test("Bitcoin: sums outputs to the recipient; unconfirmed is not final", async () => {
  const to = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
  const call = (confirmed) => async (path) => {
    assert.match(path, /^\/tx\/[0-9a-f]{64}$/);
    return { vout: [{ scriptpubkey_address: to, value: 60000 }, { scriptpubkey_address: "bc1other", value: 9 }, { scriptpubkey_address: to, value: 40000 }], status: { confirmed, block_time: 2_000_000_000 } };
  };
  const r1 = await readBtcCredit({ call: call(true), hash: "a".repeat(64), to });
  assert.deepEqual([r1.credited, r1.final], [100000n, true]);
  assert.equal((await readBtcCredit({ call: call(false), hash: "a".repeat(64), to })).final, false);
});

// ── Shape guards ──────────────────────────────────────────────────────────────────────

test("readers refuse hashes that aren't one, without calling the chain", async () => {
  const never = async () => { throw new Error("must not be called"); };
  assert.equal((await readEvmCredit({ call: never, hash: "nope", asset: SETTLEMENT_ASSETS["nep141:base.omft.near"], to: USER })).ok, false);
  assert.equal((await readSolCredit({ call: never, hash: "0x" + "a".repeat(64), asset: SETTLEMENT_ASSETS["nep141:sol.omft.near"], to: SOL_USER })).ok, false);
  assert.equal((await readBtcCredit({ call: never, hash: "../x", to: "bc1q" })).ok, false);
});

test("judge: an empty read list on a delivery plan is never DELIVERED", () => {
  const plan = { kind: "delivery", status: "SUCCESS", asset: { sym: "USDC", chain: "base", decimals: 6 }, to: USER, bar: 1n, notBefore: 0, hashes: [] };
  assert.equal(judgeSettlement(plan, []).verdict, "UNPROVEN");
});

// ── The card's line ───────────────────────────────────────────────────────────────────
import { settlementLine } from "./nearSettlement.mjs";

test("settlementLine: green only on a proven delivery to OUR recipient", () => {
  const ok = { verdict: "DELIVERED", chain: "base", to: USER };
  assert.deepEqual(settlementLine("SUCCESS", ok, { recipient: USER.toLowerCase() }), { text: "Delivered · confirmed on Base", tone: "pos" });
  assert.equal(settlementLine("SUCCESS", { ...ok, to: SOLVER }, { recipient: USER }).tone, "neg", "someone else's delivery");
  for (const verdict of ["SHORT", "MISMATCH", "MALFORMED"]) assert.equal(settlementLine("SUCCESS", { ...ok, verdict }, { recipient: USER }).tone, "neg", verdict);
  for (const verdict of ["CONFIRMING", "UNREAD", "PENDING"]) assert.equal(settlementLine("SUCCESS", { ...ok, verdict }, { recipient: USER }).tone, "neutral", verdict);
  for (const verdict of ["UNPROVEN", "UNSUPPORTED", "NOT_SETTLED"]) assert.equal(settlementLine("SUCCESS", { ...ok, verdict }, { recipient: USER }).tone, "muted", verdict);
  assert.equal(settlementLine("SUCCESS", null, { recipient: USER }).text, "1Click reports delivered · checking the chain…");
  assert.equal(settlementLine("SUCCESS", { error: "rate_limited" }, { recipient: USER }).tone, "neutral");
});

test("settlementLine: refunds check the refund address; in-flight words get no line", () => {
  assert.deepEqual(settlementLine("REFUNDED", { verdict: "REFUNDED", chain: "arb", to: USER }, { refundTo: USER }), { text: "Refunded to your wallet · confirmed on Arbitrum", tone: "neutral" });
  assert.equal(settlementLine("REFUNDED", { verdict: "REFUND_SHORT", chain: "arb", to: USER }, { refundTo: USER }).tone, "neg");
  assert.equal(settlementLine("REFUNDED", { verdict: "REFUNDED", chain: "arb", to: SOLVER }, { refundTo: USER }).tone, "neg");
  for (const s of ["PENDING_DEPOSIT", "PROCESSING", "FAILED"]) assert.equal(settlementLine(s, null, {}), null);
});

// ── Native coin inside a contract call: trace, then balance; finality tags ─────────────
import { tracedCredit, FINALITY_TAGS } from "./nearSettlement.mjs";

// A fuller fake EVM node for the native paths. tags = { safe, finalized } block numbers (absent = unknown tag).
function evmNative({ tx, trace, blockTxs = [], balances = {}, tags = { safe: 1000, finalized: 1000 }, failBalance = false }) {
  const calls = [];
  const call = async (method, params) => {
    calls.push(method);
    if (method === "eth_getTransactionReceipt") return { blockNumber: hex(tx.block), blockHash: "0xbb" + tx.block, status: "0x1", logs: [] };
    if (method === "eth_getTransactionByHash") return { to: tx.to, from: tx.from, value: hex(tx.value ?? 0) };
    if (method === "eth_getBlockByNumber") {
      const [tag, full] = params;
      if (tag === "safe" || tag === "finalized") { if (tags[tag] == null) throw new Error("unknown block tag"); return { number: hex(tags[tag]) }; }
      if (full) return { number: tag, transactions: [{ hash: tx.hash, from: tx.from, to: tx.to }, ...blockTxs] };
      return { number: tag, hash: "0xbb" + tx.block, timestamp: hex(tx.time) };
    }
    if (method === "debug_traceTransaction") { if (!trace) throw new Error("method not found"); return trace; }
    if (method === "eth_getBalance") { if (failBalance) throw new Error("missing trie node"); return hex(balances[params[1]] ?? 0); }
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls };
}
const NATIVE_MIN = BigInt(LIVE.quote.minAmountOut);
const CONTRACT = "0x3333333333333333333333333333333333333333";
const NTX = { hash: h(7), block: 900, time: secs(LIVE.timestamp, 60), to: CONTRACT, from: SOLVER, value: 0 };
const runNative = (node, memo) => checkSettlement(LIVE, status(LIVE, "SUCCESS", { dest: [h(7)] }), { callers: { evm: { base: node.call } }, depositAddress: LIVE.quote.depositAddress, memo });

test("tracedCredit: CALL / SELFDESTRUCT value to the recipient counts; DELEGATECALL, STATICCALL and reverted subtrees don't", () => {
  const tree = { type: "CALL", from: SOLVER, to: CONTRACT, value: "0x0", calls: [
    { type: "CALL", to: USER, value: hex(100) },
    { type: "DELEGATECALL", to: USER, value: hex(1000) },
    { type: "STATICCALL", to: USER },
    { type: "CALL", to: CONTRACT, value: "0x0", error: "execution reverted", calls: [{ type: "CALL", to: USER, value: hex(5000) }] },
    { type: "CALL", to: CONTRACT, value: "0x0", calls: [{ type: "SELFDESTRUCT", to: USER.toLowerCase(), value: hex(7) }] },
    { type: "CALL", to: SOLVER, value: hex(99999) },
  ] };
  assert.equal(tracedCredit(tree, USER), 107n);
  assert.equal(tracedCredit({ type: "CALL", to: USER, value: hex(9), error: "out of gas" }, USER), 0n);
});

test("native ETH via a contract call, node can trace → DELIVERED (method trace), and the proof is memoised by block hash", async () => {
  const trace = { type: "CALL", from: SOLVER, to: CONTRACT, value: "0x0", calls: [{ type: "CALL", to: USER, value: hex(NATIVE_MIN) }] };
  const store = new Map();
  const memo = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
  const r = await runNative(evmNative({ tx: NTX, trace }), memo);
  assert.equal(r.verdict, "DELIVERED", r.reason);
  assert.equal(r.txs[0].method, "trace");
  assert.equal(store.size, 1);
  assert.match([...store.keys()][0], /^base:0x0+7:0x06cd.*:0xbb900$/);
  // Later the node can't trace any more (or the state is gone): the memo carries the proof.
  const again = evmNative({ tx: NTX, trace: null, failBalance: true });
  const r2 = await runNative(again, memo);
  assert.equal(r2.verdict, "DELIVERED");
  assert.ok(!again.calls.includes("eth_getBalance"));
});

test("native ETH, no tracer → balance before/after the block, only when nothing else in the block touches the address", async () => {
  const pre = hex(899), post = hex(900);
  const ok = evmNative({ tx: NTX, balances: { [pre]: 5n, [post]: 5n + NATIVE_MIN } });
  const r = await runNative(ok);
  assert.equal(r.verdict, "DELIVERED", r.reason);
  assert.equal(r.txs[0].method, "balance");
  // Another tx in the same block pays the address: the rise can't be pinned on ours → UNPROVEN.
  const busy = evmNative({ tx: NTX, balances: { [pre]: 5n, [post]: 5n + NATIVE_MIN }, blockTxs: [{ hash: h(8), from: SOLVER, to: USER }] });
  assert.equal((await runNative(busy)).verdict, "UNPROVEN");
  // ...or the address itself sends something in that block.
  const spends = evmNative({ tx: NTX, balances: { [pre]: 5n, [post]: 5n + NATIVE_MIN }, blockTxs: [{ hash: h(9), from: USER, to: SOLVER }] });
  assert.equal((await runNative(spends)).verdict, "UNPROVEN");
  // State already pruned: can't tell → UNPROVEN, never DELIVERED.
  assert.equal((await runNative(evmNative({ tx: NTX, failBalance: true }))).verdict, "UNPROVEN");
  // A balance that went DOWN credits nothing.
  const down = evmNative({ tx: NTX, balances: { [pre]: NATIVE_MIN * 2n, [post]: NATIVE_MIN } });
  assert.equal((await runNative(down)).verdict, "SHORT");
});

test("finality: L2s use 'safe' (minutes), falling back to 'finalized' on a node that lacks it; Ethereum uses 'finalized'", async () => {
  assert.deepEqual(FINALITY_TAGS.base, ["safe", "finalized"]);
  assert.deepEqual(FINALITY_TAGS.arb, ["safe", "finalized"]);
  assert.deepEqual(FINALITY_TAGS.eth, ["finalized"]);
  const direct = { ...NTX, to: USER, value: NATIVE_MIN };
  assert.equal((await runNative(evmNative({ tx: direct, tags: { safe: 900, finalized: 10 } }))).verdict, "DELIVERED", "safe covers the block");
  assert.equal((await runNative(evmNative({ tx: direct, tags: { finalized: 900 } }))).verdict, "DELIVERED", "no 'safe' tag → finalized");
  assert.equal((await runNative(evmNative({ tx: direct, tags: { safe: 899, finalized: 10 } }))).verdict, "CONFIRMING");
  assert.equal((await runNative(evmNative({ tx: direct, tags: {} }))).verdict, "CONFIRMING", "no tag known = not final, never final by default");
});

// ── Receipt ───────────────────────────────────────────────────────────────────────────
import { settlementReceipt, receiptWanted } from "./nearSettlement.mjs";

test("settlementReceipt: every number a support ticket needs, in human units, and nothing private", () => {
  const track = { status: "SUCCESS", hash: h(1), chainName: "Arbitrum", depositAddress: USDC_BASE.quote.depositAddress, recipient: USER, refundTo: USER };
  const check = { verdict: "SHORT", reason: "on-chain credit is below the signed floor", kind: "delivery", chain: "base", asset: "USDC", decimals: 6, to: USER, bar: "19793822", credited: "19000000",
    txs: [{ hash: h(2), ok: true, credited: "19000000", final: true }, { hash: h(3), ok: false, reason: "tx not found" }] };
  const r = settlementReceipt(track, check, { at: "2026-11-05T07:00:00.000Z" });
  for (const want of [
    "Deposit address: " + USDC_BASE.quote.depositAddress, "Your transfer: Arbitrum " + h(1), "1Click status: SUCCESS",
    "On-chain check: SHORT · on-chain credit is below the signed floor", "Signed minimum: 19.793822 USDC on Base to " + USER,
    "Credited on-chain (final): 19 USDC", `  tx ${h(2)}  +19`, `  tx ${h(3)}  unread: tx not found`, "Checked at: 2026-11-05T07:00:00.000Z",
    `/xc/settlement?depositAddress=${USDC_BASE.quote.depositAddress}`,
  ]) assert.ok(r.includes(want), want);
  assert.ok(!/signature|walletSig|labAuth|private/i.test(r));
  assert.match(settlementReceipt({ ...track, status: "REFUNDED" }, { ...check, verdict: "REFUND_SHORT", kind: "refund", chain: "arb" }), /Owed back: 19.793822 USDC on Arbitrum/);
  assert.match(settlementReceipt({ ...track, status: "FAILED" }, null), /On-chain check: none yet/);
});

test("receiptWanted: offered when something needs attention, not while a check is still settling or on success", () => {
  const t = { status: "SUCCESS" };
  assert.equal(receiptWanted(t, { verdict: "DELIVERED", final: true }), false);
  assert.equal(receiptWanted(t, { verdict: "CONFIRMING" }), false);
  assert.equal(receiptWanted(t, { verdict: "UNREAD" }), false);
  for (const verdict of ["SHORT", "REFUND_SHORT", "MISMATCH", "MALFORMED", "UNPROVEN"]) assert.equal(receiptWanted(t, { verdict, final: verdict !== "UNPROVEN" ? true : false }), true, verdict);
  assert.equal(receiptWanted({ status: "FAILED" }, null), true);
  assert.equal(receiptWanted({ status: "INCOMPLETE_DEPOSIT" }, null), true);
  assert.equal(receiptWanted({ status: "PROCESSING", timedOut: true }, null), true);
  assert.equal(receiptWanted({ status: "PROCESSING" }, null), false);
});

import { depositHandoff } from "./nearSettlement.mjs";
test("depositHandoff: only a PROVEN USDC delivery to the trading account's own wallet, on a chain it deposits from", () => {
  const ok = { verdict: "DELIVERED", asset: "USDC", chain: "arb", to: USER };
  assert.equal(depositHandoff(ok, USER.toLowerCase()), true);
  assert.equal(depositHandoff({ ...ok, chain: "base" }, USER), true);
  for (const verdict of ["CONFIRMING", "UNREAD", "UNPROVEN", "SHORT", "PENDING"]) assert.equal(depositHandoff({ ...ok, verdict }, USER), false, verdict);
  assert.equal(depositHandoff({ ...ok, asset: "ETH" }, USER), false, "not USDC");
  assert.equal(depositHandoff({ ...ok, to: SOLVER }, USER), false, "someone else's wallet");
  assert.equal(depositHandoff({ ...ok, chain: "sol", to: SOL_USER }, USER), false, "EVM account can't take Solana USDC");
  assert.equal(depositHandoff({ ...ok, chain: "sol", to: SOL_USER }, SOL_USER), true, "Solana account, Solana USDC");
  assert.equal(depositHandoff({ ...ok, chain: "arb", to: SOL_USER }, SOL_USER), false);
  assert.equal(depositHandoff(ok, null), false);
  assert.equal(depositHandoff(null, USER), false);
});
