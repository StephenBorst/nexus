// ── Revoked trading signatures ───────────────────────────────────────────────────────────────
// The trading signature is personal_sign("nexus-trading-key-v1"): a fixed message, so a wallet's
// signature is the same every time and never expires. Whoever holds a copy can derive the wallet's
// order-only Orderly key and pass every check that takes `walletSig` (trade, close, cancel,
// leverage, agent control). Re-signing can't rotate it. When a copy leaks, the wallet goes on the
// list in worker var REVOKED_TRADING_WALLETS (comma-separated addresses), and every request that
// presents that wallet's trading signature is refused here, at one gate in front of all routes.
// Keyed to the WALLET, never the signature value: the value must not sit in the repo or a var.
//
// Still open on purpose, because a leaked signature can't use them to take anything:
//   - withdrawals (/withdraw/prepare|submit, /proxy/bankr-withdraw): they pay only the wallet itself
//     and need the wallet's own fresh EIP-712 signature;
//   - /balance and /positions: the owner needs them to see what to withdraw.
// Bankr flows that sign the same message server-side (/proxy/bankr-register, /proxy/bankr-deposit)
// are refused by `walletAddress`: they would re-register the leaked key or fund the account it
// controls.
//
// This closes Nexus's own routes only. The derived key still works directly against Orderly until
// it is removed there (POST /proxy/bankr-remove-key, routes-removekey.mjs, passes this gate: it takes
// no walletSig and can only kill the key) or the account holds nothing.
// Lift a wallet only once a new signing message is live (`docs/history.md`, 2026-10-26).

export const TRADING_MESSAGE = "nexus-trading-key-v1";

const ADDR = /^0x[0-9a-f]{40}$/;

/** The revoked wallets from the worker var, lower-cased. Malformed entries are dropped. */
export function revokedWallets(env) {
  return new Set(String(env?.REVOKED_TRADING_WALLETS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter((s) => ADDR.test(s)));
}

/** Routes a revoked wallet may still use (see above). `parts` = the URL path split on "/". */
export function openToRevoked(parts) {
  const [a, b] = parts;
  if (a === "withdraw" && (b === "prepare" || b === "submit")) return true;
  if (a === "proxy" && b === "bankr-withdraw") return true;
  return parts.length === 1 && (a === "balance" || a === "positions");
}

/** Bankr flows that have Bankr sign the trading message for `walletAddress` server-side. */
const BANKR_SIGNING = new Set(["bankr-register", "bankr-deposit"]);

/**
 * null = let the request through; otherwise the refusal to send.
 * @param {{ method: string, parts: string[], body: any, revoked: Set<string>, recover: (msg: string, sig: string) => string|null }} p
 */
export function revokedTradingRefusal({ method, parts, body, revoked, recover }) {
  if (!revoked || revoked.size === 0) return null;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (!body || typeof body !== "object") return null;
  if (openToRevoked(parts)) return null;
  let wallet = null;
  if (typeof body.walletSig === "string" && body.walletSig) {
    try { wallet = String(recover(TRADING_MESSAGE, body.walletSig) || "").toLowerCase(); } catch { wallet = null; }
  }
  if (!(wallet && revoked.has(wallet)) && parts[0] === "proxy" && BANKR_SIGNING.has(parts[1])) {
    wallet = String(body.walletAddress || "").toLowerCase();
  }
  if (!wallet || !revoked.has(wallet)) return null;
  return {
    status: 403,
    body: {
      error: "trading_signature_revoked",
      wallet,
      hint: "This wallet's trading signature was exposed, so Nexus refuses it for trading and agent control. Withdrawals to the wallet still work. It will be re-enabled with a new signing message.",
    },
  };
}
