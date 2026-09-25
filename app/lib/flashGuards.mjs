// ── Flash (Definitive) pre-signature guards — the Fabric standard, applied to Flash ──
// Flash's quote hands the browser two things to act on: raw setup txs (an ERC-20 approve) and
// an EIP-712 FlashOrder to sign. Before this module both went to the wallet UNCHECKED — and the
// approve Flash returns is UNLIMITED (0xfff…). Everything here runs BEFORE any wallet prompt:
//   • the order must be a FlashOrder on this chain, against the pinned Flash allowance contract,
//     with swapper AND recipient = the connected wallet (output can't be redirected), the tokens
//     the trade names, fromAmount ≤ what the user typed, and a sane deadline;
//   • a setup tx must be a zero-ETH approve of the order's fromToken to that pinned contract —
//     and we never forward Flash's unlimited approve: the caller sends OUR exact-amount approve
//     (encodeApprove) for precisely the signed fromAmount, the same rule Fabric follows.
// Pure: no fetch, no wallet. Verified shapes: live Flash quote on Base, 2026-09-25.

// Flash's allowance/settlement contract (domain.verifyingContract of FlashOrder AND the approve
// spender, identical on the live quote). Pinned: a quote naming any other contract is refused.
export const FLASH_ALLOWANCE = "0x5d00000873b6bf41539e6f5365b0ff7d3c368f78";
export const APPROVE_SELECTOR = "0x095ea7b3";
export const MAX_DEADLINE_S = 3600; // a market order signed now has no business living longer

const lc = (a) => String(a || "").toLowerCase();
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));

// Decimal string → base units (truncates extra decimals; never floats).
export function toBaseUnits(qty, decimals) {
  const s = String(qty ?? "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  const [w, f = ""] = s.split(".");
  return BigInt((w || "0") + (f + "0".repeat(d)).slice(0, d));
}

function big(v) {
  try { const b = BigInt(String(v)); return b >= 0n ? b : null; } catch { return null; }
}

// The FlashOrder typed data (object or JSON string). expect = { chainId:number, wallet, fromToken,
// toToken, maxFromAmount:bigint, nowS? }. Returns { ok, reason?, fromAmount?:bigint, typed? }.
export function checkFlashOrder(typedIn, expect) {
  let typed = typedIn;
  if (typeof typed === "string") { try { typed = JSON.parse(typed); } catch { return { ok: false, reason: "order is not valid typed data" }; } }
  if (!typed || typeof typed !== "object") return { ok: false, reason: "no order to sign" };
  const { domain = {}, message = {}, primaryType } = typed;
  if (primaryType !== "FlashOrder") return { ok: false, reason: `unexpected order type (${primaryType || "none"})` };
  if (Number(domain.chainId) !== Number(expect.chainId)) return { ok: false, reason: `order is for chain ${domain.chainId}, wallet trade is on ${expect.chainId}` };
  if (lc(domain.verifyingContract) !== FLASH_ALLOWANCE) return { ok: false, reason: "order names an unknown Flash contract" };
  if (!isAddr(expect.wallet)) return { ok: false, reason: "no wallet connected" };
  if (lc(message.swapper) !== lc(expect.wallet)) return { ok: false, reason: "order swapper is not your wallet" };
  if (lc(message.recipient) !== lc(expect.wallet)) return { ok: false, reason: "order would send the output to another address" };
  if (lc(message.fromToken) !== lc(expect.fromToken)) return { ok: false, reason: "order spends a different token than this trade" };
  if (lc(message.toToken) !== lc(expect.toToken)) return { ok: false, reason: "order buys a different token than this trade" };
  const amt = big(message.fromAmount);
  if (amt == null || amt === 0n) return { ok: false, reason: "order amount missing" };
  if (typeof expect.maxFromAmount !== "bigint" || amt > expect.maxFromAmount) return { ok: false, reason: "order spends more than you entered" };
  const now = expect.nowS ?? Math.floor(Date.now() / 1000);
  const dl = Number(message.deadline);
  if (!Number.isFinite(dl) || dl <= now || dl > now + MAX_DEADLINE_S) return { ok: false, reason: "order deadline is out of range" };
  return { ok: true, fromAmount: amt, typed };
}

// One decoded setup tx { to, data, value }. It must be a zero-ETH approve of `fromToken` to the
// pinned Flash contract. Returns { ok, reason?, amount?:bigint }. The caller does NOT forward it —
// it sends encodeApprove(FLASH_ALLOWANCE, fromAmount) instead (zero-amount resets are fine as-is).
export function checkFlashSetupTx(tx, { fromToken }) {
  if (!tx || !isAddr(tx.to)) return { ok: false, reason: "setup transaction has no target" };
  if (tx.value != null && BigInt(tx.value) > 0n) return { ok: false, reason: "setup transaction tries to send ETH" };
  if (lc(tx.to) !== lc(fromToken)) return { ok: false, reason: "setup transaction targets a different token" };
  const data = lc(tx.data);
  if (!data.startsWith(APPROVE_SELECTOR) || data.length !== 2 + 8 + 64 * 2) return { ok: false, reason: "setup transaction is not a token approval" };
  const spender = "0x" + data.slice(10 + 24, 10 + 64);
  if (spender !== FLASH_ALLOWANCE) return { ok: false, reason: "approval names an unknown spender" };
  return { ok: true, amount: BigInt("0x" + data.slice(10 + 64)) };
}

// approve(spender, amount) calldata, hand-encoded (checked against viem in the tests).
export function encodeApprove(spender, amount) {
  if (!isAddr(spender)) throw new Error("bad spender");
  const a = BigInt(amount);
  if (a < 0n) throw new Error("bad amount");
  return APPROVE_SELECTOR + lc(spender).slice(2).padStart(64, "0") + a.toString(16).padStart(64, "0");
}

// The attached SL/TP bracket's order (a RESTING sell of what was just bought). Same pins as the
// entry — FlashOrder, this chain, the Flash contract, swapper AND recipient = the wallet, and it
// must sell the bought token for the contra token — but no amount/deadline bound: a resting
// order lives until triggered and sizes to the fill. Unknown shapes are refused (market-only).
export function checkFlashBracket(typedIn, { chainId, wallet, boughtToken, contraToken }) {
  let typed = typedIn;
  if (typeof typed === "string") { try { typed = JSON.parse(typed); } catch { return { ok: false, reason: "bracket is not valid typed data" }; } }
  if (!typed || typeof typed !== "object") return { ok: false, reason: "no bracket to sign" };
  const { domain = {}, message = {}, primaryType } = typed;
  if (primaryType !== "FlashOrder") return { ok: false, reason: `unexpected bracket type (${primaryType || "none"})` };
  if (Number(domain.chainId) !== Number(chainId)) return { ok: false, reason: "bracket is for another chain" };
  if (lc(domain.verifyingContract) !== FLASH_ALLOWANCE) return { ok: false, reason: "bracket names an unknown Flash contract" };
  if (!isAddr(wallet) || lc(message.swapper) !== lc(wallet) || lc(message.recipient) !== lc(wallet)) return { ok: false, reason: "bracket is not bound to your wallet" };
  if (lc(message.fromToken) !== lc(boughtToken) || lc(message.toToken) !== lc(contraToken)) return { ok: false, reason: "bracket trades different tokens" };
  return { ok: true, typed };
}
