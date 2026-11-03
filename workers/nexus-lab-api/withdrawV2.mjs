// ── Withdrawals with a v2 key (auth v2 build step 3c, docs/auth-v2-spec.md §C) ──────────────────────
// Orderly takes a withdrawal only with BOTH:
//   • the request signed by an Orderly key on the account (here: the wallet's stored random v2 key,
//     scope read,trading: the same scope Orderly's own SDK registers, and its web withdraw uses it);
//   • the wallet's own EIP-712 `Withdraw` signature, receiver = the wallet.
// The key alone can't move funds, and nothing here can pay anyone but the wallet.
//
// Two callers, both behind AUTH_V2_KEYS="true" (index.js picks this path; v1 stays beside it):
//   • POST /proxy/bankr-withdraw {walletAddress, bankrApiKey, amount}: for a wallet that HAS a v2 key
//     record. Bankr signs the Withdraw as the wallet; it must recover to the wallet before anything is
//     sent. It never asks Bankr for the static "nexus-trading-key-v1" signature.
//   • POST /withdraw/prepare|submit {walletAddress, session, …}: the wallet signs the Withdraw itself.
//     submit also needs the per-request challenge (action "withdraw", bound to the units signed),
//     enforced here always.
import { recoverTypedDataAddress } from "viem";
import { checkChallenge, bankrSignTyped, Refused } from "./routes-key.mjs";
import { BROKER_ID, ORDERLY_CHAIN_ID } from "./v2Keys.mjs";

export const ORDERLY_BASE = "https://api-evm.orderly.org";
export const WITHDRAW_VC = "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203"; // Orderly ledger; passed in the POST body
export const SETTLE_WAIT_MS = 4000;
export const SETTLE_BUFFER_USDC = 0.5;

/** USDC amount → integer units (6 decimals), or null when it isn't a positive amount. */
export function usdcUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = Math.round(n * 1e6);
  return u > 0 && Number.isSafeInteger(u) ? u : null;
}

export function withdrawMessage({ wallet, units, withdrawNonce, now }) {
  return { brokerId: BROKER_ID, chainId: ORDERLY_CHAIN_ID, receiver: wallet, token: "USDC", amount: units, withdrawNonce: Number(withdrawNonce), timestamp: now };
}

export function withdrawTypedData(message) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      Withdraw: [
        { name: "brokerId", type: "string" }, { name: "chainId", type: "uint256" },
        { name: "receiver", type: "address" }, { name: "token", type: "string" },
        { name: "amount", type: "uint256" }, { name: "withdrawNonce", type: "uint64" },
        { name: "timestamp", type: "uint64" },
      ],
    },
    primaryType: "Withdraw",
    domain: { name: "Orderly", version: "1", chainId: ORDERLY_CHAIN_ID, verifyingContract: WITHDRAW_VC },
    message,
  };
}

/** Refuse a Withdraw message that isn't exactly "pay this wallet USDC from our broker". */
export function withdrawRefusal(m, wallet) {
  if (!m || typeof m !== "object") return "no_message";
  if (String(m.receiver || "").toLowerCase() !== wallet) return "receiver_mismatch";
  if (m.brokerId !== BROKER_ID) return "wrong_broker";
  if (m.chainId !== ORDERLY_CHAIN_ID) return "wrong_chain";
  if (m.token !== "USDC") return "wrong_token";
  if (!Number.isSafeInteger(m.amount) || m.amount <= 0) return "bad_amount";
  if (!Number.isSafeInteger(m.withdrawNonce) || m.withdrawNonce < 0) return "bad_nonce";
  if (!Number.isSafeInteger(m.timestamp)) return "bad_timestamp";
  return null;
}

/** Who signed this Withdraw (lower-case), or null. */
export async function withdrawSigner(message, signature) {
  try { return (await recoverTypedDataAddress({ ...withdrawTypedData(message), signature })).toLowerCase(); } catch { return null; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** One Orderly REST call signed by the stored key (`signer` from tradingSigner.mjs). */
export async function orderlyCall(signer, method, path, data, { fetchImpl = fetch, clock = Date.now } = {}) {
  const bs = data ? JSON.stringify(data) : undefined;
  const ts = clock();
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", signer.signingKey, new TextEncoder().encode(`${ts}${method}${path}${bs || ""}`)));
  const headers = {
    "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
    "orderly-timestamp": String(ts), "orderly-account-id": signer.accountId, "orderly-key": signer.orderlyKey, "orderly-signature": b64url(sig),
  };
  const r = await fetchImpl(ORDERLY_BASE + path, { method, headers, body: bs });
  try { return await r.json(); } catch { return null; }
}

async function withdrawNonce(signer, deps) {
  const d = await orderlyCall(signer, "GET", "/v1/withdraw_nonce", null, deps);
  const n = d?.data?.withdraw_nonce;
  if (n == null || !Number.isSafeInteger(Number(n))) throw new Refused(502, { error: "withdraw_nonce_unavailable", detail: d });
  return Number(n);
}

/** Settle PnL, wait, and read free USDC (the code-78 path; same steps as v1). */
async function settleAndFree(signer, deps) {
  await orderlyCall(signer, "POST", "/v1/settle_pnl", {}, deps);
  await (deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(SETTLE_WAIT_MS);
  const h = await orderlyCall(signer, "GET", "/v1/client/holding", null, deps);
  const row = (h?.data?.holding ?? []).find((x) => x.token === "USDC");
  return Number(row?.holding ?? row?.available ?? 0);
}

const isCode78 = (r) => r?.code === 78 || String(r?.message ?? "").includes("occupied");

const submit = (signer, message, signature, deps) =>
  orderlyCall(signer, "POST", "/v1/withdraw_request", { message, signature, userAddress: signer.wallet, verifyingContract: WITHDRAW_VC }, deps);

/**
 * Bankr withdraw for a wallet with a v2 key. `signer` = storedKeySigner(env, wallet); the wallet is
 * proven by Bankr's Withdraw signature recovering to it, checked before every submit. The nonce read
 * is the only call made before that proof, and it moves nothing.
 */
export async function bankrWithdrawV2(signer, { bankrApiKey, amount }, deps = {}) {
  const clock = deps.clock || Date.now;
  const fetchImpl = deps.fetchImpl || fetch;
  const d = { ...deps, clock, fetchImpl };
  const wallet = signer.wallet;
  const units = usdcUnits(amount);
  if (!units) throw new Refused(400, { error: "bad_amount", hint: "amount = USDC, more than 0." });

  const signed = async (u) => {
    const message = withdrawMessage({ wallet, units: u, withdrawNonce: await withdrawNonce(signer, d), now: clock() });
    const signature = await bankrSignTyped(bankrApiKey, withdrawTypedData(message), fetchImpl);
    if ((await withdrawSigner(message, signature)) !== wallet) {
      throw new Refused(401, { error: "signature_mismatch", hint: "Bankr signed as another wallet. Use the API key of the wallet you're withdrawing from." });
    }
    return { message, signature };
  };

  const first = await signed(units);
  const res = await submit(signer, first.message, first.signature, d);
  if (!isCode78(res)) {
    return { ok: res?.success === true, auth: "v2", walletAddress: wallet, amount: Number(amount), amountUnits: units, withdrawNonce: first.message.withdrawNonce, keyExpiresInDays: signer.keyExpiresInDays, raw: res };
  }
  const free = await settleAndFree(signer, d);
  const safe = Math.min(Number(amount), Math.max(0, free - SETTLE_BUFFER_USDC));
  const safeUnits = usdcUnits(safe);
  if (!safeUnits) {
    throw new Refused(400, { ok: false, error: "insufficient_free_collateral", freeCollateral: free,
      hint: "After settlement, free collateral is too low to withdraw. Close open positions or wait for Orderly's daily settlement." });
  }
  const second = await signed(safeUnits);
  const res2 = await submit(signer, second.message, second.signature, d);
  return {
    ok: res2?.success === true, auth: "v2", autoSettled: true, walletAddress: wallet, originalAmount: Number(amount), withdrawnAmount: safe, freeCollateral: free,
    keyExpiresInDays: signer.keyExpiresInDays, raw: res2,
  };
}

/** /withdraw/prepare (v2): the Withdraw typed data for the wallet to sign, and the challenge to mint. */
export async function withdrawPrepareV2(signer, { amount, settle }, deps = {}) {
  const clock = deps.clock || Date.now;
  const d = { ...deps, clock };
  if (!usdcUnits(amount)) throw new Refused(400, { error: "amount (USDC) required" });
  let eff = Number(amount);
  if (settle) {
    const free = await settleAndFree(signer, d);
    eff = Math.min(eff, Math.max(0, free - SETTLE_BUFFER_USDC));
    if (!usdcUnits(eff)) throw new Refused(400, { ok: false, error: "insufficient_free_collateral", freeCollateral: free,
      hint: "Free collateral too low to withdraw after settlement. Close positions or wait for the daily settlement cycle." });
  }
  const message = withdrawMessage({ wallet: signer.wallet, units: usdcUnits(eff), withdrawNonce: await withdrawNonce(signer, d), now: clock() });
  return {
    typedData: withdrawTypedData(message), message, amount: eff, verifyingContract: WITHDRAW_VC, auth: "v2",
    challenge: { action: "withdraw", amount: String(message.amount), url: `/auth/challenge?wallet=${signer.wallet}&action=withdraw&amount=${message.amount}` },
    keyExpiresInDays: signer.keyExpiresInDays,
  };
}

/** /withdraw/submit (v2): checks, then the challenge (burned only once every local check passed), then Orderly. */
export async function withdrawSubmitV2(env, signer, body, deps = {}) {
  const clock = deps.clock || Date.now;
  const d = { ...deps, clock };
  const { message, signature } = body || {};
  if (!message || !signature) throw new Refused(400, { error: "message and signature required" });
  const why = withdrawRefusal(message, signer.wallet);
  if (why) throw new Refused(400, { error: why === "receiver_mismatch" ? "receiver_mismatch" : "bad_withdraw_message", reason: why, hint: "Sign the typed data /withdraw/prepare returned, unchanged." });
  if ((await withdrawSigner(message, signature)) !== signer.wallet) throw new Refused(401, { error: "signature_mismatch", hint: "The Withdraw must be signed by this wallet." });
  await checkChallenge(env, { action: "withdraw", wallet: signer.wallet, nonce: body.nonce, v2Sig: body.v2Sig, now: clock(), amount: String(message.amount) });
  const res = await submit(signer, message, signature, d);
  if (isCode78(res)) return { ok: false, code: 78, needsSettle: true, auth: "v2", hint: "Unsettled PnL is occupying margin. Re-run /withdraw/prepare with settle:true, re-sign, and resubmit." };
  return { ok: res?.success === true, auth: "v2", raw: res };
}

/** Run one of the above as a { status, body } answer. */
export async function answer(fn) {
  try { return { status: 200, body: await fn() }; }
  catch (e) {
    if (e instanceof Refused) return { status: e.status, body: e.body };
    console.error("[withdrawV2]", e?.message || e);
    return { status: 500, body: { error: "withdraw_failed" } };
  }
}
