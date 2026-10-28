import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { jupFeeConfig, feeAccountFor, jupQuoteParams, withJupSwapFee, isTokenAccountFor, validFeeAccounts, _resetJupFeeCache, USDC_MINT, WSOL_MINT } from "./jupFee.mjs";

const USDC_ACCT = "Fee1USDCaccount111111111111111111111111111";
const WSOL_ACCT = "Fee2WSoLaccount111111111111111111111111111";
const TOKEN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const ENV = { JUP_FEE_BPS: "10", JUP_FEE_ACCOUNT_USDC: USDC_ACCT, JUP_FEE_ACCOUNT_WSOL: WSOL_ACCT, JUP_FEE_LIVE: "true" };
const CFG = jupFeeConfig(ENV);
const BOTH = { usdc: true, wsol: true };
beforeEach(() => _resetJupFeeCache());

test("config: off unless a sane bps; bad addresses dropped", () => {
  assert.deepEqual(jupFeeConfig(ENV), { bps: 10, usdc: USDC_ACCT, wsol: WSOL_ACCT, live: true });
  assert.equal(jupFeeConfig({ ...ENV, JUP_FEE_LIVE: undefined }).live, false);
  for (const b of [undefined, "", "0", "-1", "101", "2.5", "x"]) assert.equal(jupFeeConfig({ ...ENV, JUP_FEE_BPS: b }).bps, 0);
  assert.equal(jupFeeConfig({ ...ENV, JUP_FEE_ACCOUNT_USDC: "not an address!" }).usdc, "");
});

test("fee mint per trade: USDC if either side is USDC, else wSOL, else none", () => {
  assert.equal(feeAccountFor(USDC_MINT, TOKEN, CFG, BOTH), USDC_ACCT); // USDC buy
  assert.equal(feeAccountFor(TOKEN, USDC_MINT, CFG, BOTH), USDC_ACCT); // sell
  assert.equal(feeAccountFor(WSOL_MINT, TOKEN, CFG, BOTH), WSOL_ACCT); // SOL buy
  assert.equal(feeAccountFor(WSOL_MINT, USDC_MINT, CFG, BOTH), USDC_ACCT);
  assert.equal(feeAccountFor(TOKEN, "Other1111111111111111111111111111111111111", CFG, BOTH), "");
  assert.equal(feeAccountFor(WSOL_MINT, TOKEN, CFG, { usdc: true, wsol: false }), ""); // unchecked account = off
  assert.equal(feeAccountFor(USDC_MINT, TOKEN, { ...CFG, bps: 0 }, BOTH), "");
});

const sp = (o) => new URLSearchParams({ inputMint: USDC_MINT, outputMint: TOKEN, amount: "1000000", slippageBps: "100", swapMode: "ExactIn", ...o });

test("quote: our bps added for a fee pair; whitelist only; a browser fee is ignored", () => {
  const p = jupQuoteParams(sp({ platformFeeBps: "100", evil: "1" }), CFG, BOTH);
  assert.equal(p.get("platformFeeBps"), "10");
  assert.equal(p.get("evil"), null);
  assert.equal(jupQuoteParams(sp({}), CFG, { usdc: false, wsol: false }).get("platformFeeBps"), null);
});

test("staged (not live): only a feetest=1 quote carries the fee", () => {
  const staged = jupFeeConfig({ ...ENV, JUP_FEE_LIVE: "false" });
  assert.equal(jupQuoteParams(sp({}), staged, BOTH).get("platformFeeBps"), null);
  assert.equal(jupQuoteParams(sp({ feetest: "1" }), staged, BOTH).get("platformFeeBps"), "10");
  assert.equal(jupQuoteParams(sp({ feetest: "1" }), staged, BOTH).get("feetest"), null, "never forwarded to Jupiter");
});

test("quote: nofee=1 (price read) and ExactOut carry no fee", () => {
  assert.equal(jupQuoteParams(sp({ nofee: "1" }), CFG, BOTH).get("platformFeeBps"), null);
  assert.equal(jupQuoteParams(sp({ swapMode: "ExactOut" }), CFG, BOTH).get("platformFeeBps"), null);
});

const body = (quote, extra = {}) => JSON.stringify({ quoteResponse: quote, userPublicKey: "User111111111111111111111111111111111111111", ...extra });

test("swap: our feeAccount added when the quote carries our fee; a browser feeAccount is dropped", () => {
  const out = JSON.parse(withJupSwapFee(body({ inputMint: USDC_MINT, outputMint: TOKEN, platformFee: { feeBps: 10 } }, { feeAccount: "Attacker" }), CFG, BOTH).body);
  assert.equal(out.feeAccount, USDC_ACCT);
  const none = JSON.parse(withJupSwapFee(body({ inputMint: USDC_MINT, outputMint: TOKEN, platformFee: null }, { feeAccount: "Attacker" }), CFG, BOTH).body);
  assert.equal(none.feeAccount, undefined);
});

test("swap: a quote with another fee rate, or no usable account, is refused", () => {
  assert.equal(withJupSwapFee(body({ inputMint: USDC_MINT, outputMint: TOKEN, platformFee: { feeBps: 50 } }), CFG, BOTH).error, "fee_mismatch");
  assert.equal(withJupSwapFee(body({ inputMint: USDC_MINT, outputMint: TOKEN, platformFee: { feeBps: 10 } }), CFG, { usdc: false, wsol: false }).error, "fee_account_unavailable");
  assert.equal(withJupSwapFee("not json", CFG, BOTH).body, "not json");
});

const acct = (mint, state = "initialized") => ({ data: { parsed: { type: "account", info: { mint, state } } } });

test("account check: an initialized token account of the right mint only", () => {
  assert.equal(isTokenAccountFor(acct(USDC_MINT), USDC_MINT), true);
  assert.equal(isTokenAccountFor(acct(WSOL_MINT), USDC_MINT), false);
  assert.equal(isTokenAccountFor(acct(USDC_MINT, "frozen"), USDC_MINT), false);
  assert.equal(isTokenAccountFor(null, USDC_MINT), false);
  assert.equal(isTokenAccountFor({ data: { parsed: { type: "mint", info: {} } } }, USDC_MINT), false); // a wallet or mint address
});

test("validFeeAccounts: checks over RPC, caches, keeps the last answer on an RPC failure, no RPC when off", async () => {
  let calls = 0;
  const rpc = async (_m, [addr]) => { calls++; return { value: addr === USDC_ACCT ? acct(USDC_MINT) : acct(USDC_MINT) /* wrong mint for wSOL */ }; };
  assert.deepEqual(await validFeeAccounts(CFG, rpc, 1000), { usdc: true, wsol: false });
  assert.equal(calls, 2);
  await validFeeAccounts(CFG, rpc, 2000);
  assert.equal(calls, 2, "cached");
  const down = async () => { throw new Error("rpc down"); };
  assert.deepEqual(await validFeeAccounts(CFG, down, 1000 + 11 * 60_000), { usdc: true, wsol: false }, "kept on failure");
  _resetJupFeeCache();
  let off = 0;
  assert.deepEqual(await validFeeAccounts(jupFeeConfig({}), async () => { off++; }, 0), { usdc: false, wsol: false });
  assert.equal(off, 0);
});
