// ── Settling PnL at Orderly, the way Orderly's own SDK does it ──────────────────────────────────────
// Read from @orderly.network/core (Account.settle, _getSettleNonce) and default-evm-adapter
// (generateSettleMessage, getDomain(true)), 2026-11-06. A settle is THREE steps:
//   1. GET  /v1/settle_nonce                 signed by the account's Orderly key;
//   2. the WALLET signs EIP-712 SettlePnl {brokerId, chainId, settleNonce, timestamp} on the ON-CHAIN
//      domain (verifyingContract = the Orderly ledger 0x6F7a…D203, the same one Withdraw uses);
//   3. POST /v1/settle_pnl {signature, message (+ chainType "EVM"), userAddress, verifyingContract},
//      signed by the Orderly key.
// Until this module every settle path POSTed `{}` (or `{symbol}`) and ignored the answer, so no loss
// or gain was ever booked by us; the code-78 retry then sized itself from an unsettled balance (found
// live on 0xd9f7…b449, 2026-11-06). A settle moves no funds out: it books PnL into the balance.
// Pure apart from the injected I/O in runSettle; tests: settlePnl.test.mjs.
import { recoverTypedDataAddress } from "viem";

export const SETTLE_BROKER_ID = "nexus_trading";
export const SETTLE_CHAIN_ID = 42161;
export const SETTLE_VC = "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203"; // Orderly ledger, mainnet verifyContractAddress

/** The settle nonce from an Orderly GET /v1/settle_nonce reply, or null. */
export function settleNonceFrom(reply) {
  if (!reply || reply.success === false) return null;
  const n = Number(reply?.data?.settle_nonce);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function settleMessage({ settleNonce, now = Date.now() }) {
  return { brokerId: SETTLE_BROKER_ID, chainId: SETTLE_CHAIN_ID, settleNonce: Number(settleNonce), timestamp: now };
}

/** The EIP-712 the wallet signs (eth_signTypedData_v4 shape). */
export function settleTypedData(message) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      SettlePnl: [
        { name: "brokerId", type: "string" }, { name: "chainId", type: "uint256" },
        { name: "settleNonce", type: "uint64" }, { name: "timestamp", type: "uint64" },
      ],
    },
    primaryType: "SettlePnl",
    domain: { name: "Orderly", version: "1", chainId: SETTLE_CHAIN_ID, verifyingContract: SETTLE_VC },
    message,
  };
}

/** Refuse a SettlePnl message that isn't exactly ours (a caller-supplied one on /settle-pnl). */
export function settleRefusal(m) {
  if (!m || typeof m !== "object") return "no_message";
  if (m.brokerId !== SETTLE_BROKER_ID) return "wrong_broker";
  if (Number(m.chainId) !== SETTLE_CHAIN_ID) return "wrong_chain";
  if (!Number.isSafeInteger(Number(m.settleNonce)) || Number(m.settleNonce) < 0) return "bad_nonce";
  if (!Number.isSafeInteger(Number(m.timestamp))) return "bad_timestamp";
  return null;
}

/** Who signed this SettlePnl (lower-case), or null. */
export async function settleSigner(message, signature) {
  try {
    const td = settleTypedData({ brokerId: message.brokerId, chainId: Number(message.chainId), settleNonce: Number(message.settleNonce), timestamp: Number(message.timestamp) });
    const { EIP712Domain, ...types } = td.types;
    return (await recoverTypedDataAddress({ domain: td.domain, types, primaryType: td.primaryType, message: td.message, signature })).toLowerCase();
  } catch { return null; }
}

/** The POST /v1/settle_pnl body, as the SDK sends it. */
export function settleRequestBody({ message, signature, wallet }) {
  return {
    signature,
    message: { brokerId: message.brokerId, chainId: Number(message.chainId), settleNonce: Number(message.settleNonce), timestamp: Number(message.timestamp), chainType: "EVM" },
    userAddress: wallet,
    verifyingContract: SETTLE_VC,
  };
}

/**
 * A whole settle with injected I/O. Nothing is posted unless the signature recovers to `wallet`.
 * @param {object} io { getNonce(): Promise<reply>   (key-signed GET /v1/settle_nonce)
 *                      signTyped(typedData): Promise<hex>  (the WALLET's EIP-712 signature, e.g. Bankr)
 *                      post(body): Promise<reply>  (key-signed POST /v1/settle_pnl) }
 * @returns {Promise<{ ok: boolean, stage: "done"|"nonce"|"signer"|"orderly", raw?: object }>}
 */
export async function runSettle({ wallet, now = Date.now(), getNonce, signTyped, post }) {
  const w = String(wallet).toLowerCase();
  const nonceReply = await getNonce();
  const settleNonce = settleNonceFrom(nonceReply);
  if (settleNonce == null) return { ok: false, stage: "nonce", raw: nonceReply ?? null };
  const message = settleMessage({ settleNonce, now });
  const signature = await signTyped(settleTypedData(message));
  if ((await settleSigner(message, signature)) !== w) return { ok: false, stage: "signer" };
  const res = await post(settleRequestBody({ message, signature, wallet: w }));
  return { ok: res?.success === true, stage: res?.success === true ? "done" : "orderly", raw: res ?? null };
}

/** Plain words for a failed settle (route replies). */
export function settleFailure(r) {
  const hint = r.stage === "nonce" ? "Couldn't read the settle nonce from Orderly. Nothing was settled; try again."
    : r.stage === "signer" ? "The settle signature didn't come from this wallet. Use the API key (or wallet) of the account you're settling."
      : "Orderly refused the settle. Nothing was withdrawn.";
  return { ok: false, error: "settle_failed", stage: r.stage, withdrawnAmount: 0, hint, raw: r.raw ?? null };
}
