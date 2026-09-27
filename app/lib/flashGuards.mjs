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
//
// Resting orders (2026-09-27, live quotes for every type): limit / TWAP / stop / stop-loss sign
// the SAME FlashOrder struct as a market order. The price condition is NOT in the signature —
// Flash's engine enforces it off-chain (their docs say so plainly). What the signature binds is
// the spend cap, the recipient and the deadline, so those are what we check. Only the deadline
// rule changes per type: GTC = Flash's 2^48−1 sentinel, GTT = the expiry we asked for, TWAP =
// start + duration + Flash's 60 s buffer.
//
// Approvals for resting orders: one allowance to FLASH_ALLOWANCE is shared by EVERY open order
// that spends the token, so approving only this order's amount would starve the older ones.
// We ask Flash for the cumulative amount (forceMinimalAllowance) and cap it ourselves at this
// order + what the wallet's OPEN orders still need (openSpend, from Flash's order list) — never
// unlimited, never more than we can account for (approvalPlan).

// Flash's allowance/settlement contract (domain.verifyingContract of FlashOrder AND the approve
// spender, identical on the live quote). Pinned: a quote naming any other contract is refused.
export const FLASH_ALLOWANCE = "0x5d00000873b6bf41539e6f5365b0ff7d3c368f78";
export const APPROVE_SELECTOR = "0x095ea7b3";
export const MAX_DEADLINE_S = 3600; // a market order signed now has no business living longer
export const GTC_DEADLINE = 281474976710655; // 2^48 − 1: Flash's good-til-cancelled sentinel
export const ORDER_TYPES = ["market", "limit", "twap", "stop", "stop-loss", "take-profit"];
const RESTING = new Set(["limit", "stop", "stop-loss", "take-profit"]);
const EXPIRY_SLACK_S = 120;          // a GTT deadline must match the expiry we asked for, ± this
const TWAP_BUFFER_S = 60;            // Flash signs start + duration + a 60 s execution buffer
const TWAP_SLACK_S = 300;            // quote latency / rounding headroom on top of that
export const TWAP_MIN_S = 300;       // Flash's minimum duration
export const TWAP_MAX_S = 7 * 86400; // ours: nothing in the ticket offers longer

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
  if (!deadlineOk(message.deadline, { ...expect, nowS: now })) return { ok: false, reason: "order deadline is out of range" };
  return { ok: true, fromAmount: amt, typed };
}

// The signed deadline must be what THIS order type should carry. expect = { orderType (default
// "market"), nowS, expireAtS (GTT; null/undefined = GTC), durationS + startAtS (TWAP) }.
// Unknown types are refused: a new Flash order type gets its own rule before we sign it.
export function deadlineOk(deadline, { orderType = "market", nowS, expireAtS = null, durationS, startAtS = null } = {}) {
  const dl = Number(deadline);
  const now = Number(nowS);
  if (!Number.isFinite(dl) || !Number.isFinite(now) || dl <= now) return false;
  if (orderType === "market") return dl <= now + MAX_DEADLINE_S;
  if (RESTING.has(orderType)) {
    if (expireAtS == null) return dl === GTC_DEADLINE;
    const exp = Number(expireAtS);
    return Number.isFinite(exp) && exp > now && Math.abs(dl - exp) <= EXPIRY_SLACK_S;
  }
  if (orderType === "twap") {
    const dur = Number(durationS);
    if (!Number.isInteger(dur) || dur < TWAP_MIN_S || dur > TWAP_MAX_S) return false;
    const start = startAtS == null ? now : Number(startAtS);
    if (!Number.isFinite(start) || start < now - TWAP_SLACK_S) return false;
    return dl <= start + dur + TWAP_BUFFER_S + TWAP_SLACK_S;
  }
  return false;
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
// must sell the bought token for the contra token. No deadline bound (the pair is GTC by design).
// Amount: the pair may sell up to its signed max, and it pulls from the WALLET — so a max far
// above what this trade buys would let a stop sell tokens the user already held. maxFromAmount
// (the caller passes ~1.2× the quoted output; live headroom is ~5%) caps it. Unknown shapes are
// refused (market-only).
export function checkFlashBracket(typedIn, { chainId, wallet, boughtToken, contraToken, maxFromAmount }) {
  let typed = typedIn;
  if (typeof typed === "string") { try { typed = JSON.parse(typed); } catch { return { ok: false, reason: "bracket is not valid typed data" }; } }
  if (!typed || typeof typed !== "object") return { ok: false, reason: "no bracket to sign" };
  const { domain = {}, message = {}, primaryType } = typed;
  if (primaryType !== "FlashOrder") return { ok: false, reason: `unexpected bracket type (${primaryType || "none"})` };
  if (Number(domain.chainId) !== Number(chainId)) return { ok: false, reason: "bracket is for another chain" };
  if (lc(domain.verifyingContract) !== FLASH_ALLOWANCE) return { ok: false, reason: "bracket names an unknown Flash contract" };
  if (!isAddr(wallet) || lc(message.swapper) !== lc(wallet) || lc(message.recipient) !== lc(wallet)) return { ok: false, reason: "bracket is not bound to your wallet" };
  if (lc(message.fromToken) !== lc(boughtToken) || lc(message.toToken) !== lc(contraToken)) return { ok: false, reason: "bracket trades different tokens" };
  const amt = big(message.fromAmount);
  if (amt == null || amt === 0n) return { ok: false, reason: "bracket amount missing" };
  if (typeof maxFromAmount !== "bigint" || amt > maxFromAmount) return { ok: false, reason: "bracket could sell more than this trade buys" };
  return { ok: true, typed, fromAmount: amt };
}

// ── approvals shared by resting orders ─────────────────────────────────────────
export const OPEN_STATUSES = new Set(["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"]);

// How much of `token` the wallet's OPEN Flash orders can still pull (base units). `orders` =
// the `orders` array of GET /v1/orders. A buy spends its contra asset, a sell (bracket pairs
// included) its target asset; remaining = qty − filled. An entry whose attached SL/TP pair is
// still pending_activation also counts the pair's signed maximum against the RECEIVED token,
// since that pair will pull it once it goes live. Chain names are compared when both sides
// carry one; otherwise the row counts (over-counting only lets the approval reach what Flash
// itself asks for — approvalPlan still caps at Flash's number). Any row we can't read → null,
// and the caller refuses to size an approval blind.
export function openSpend(orders, { chain, token, decimals }) {
  if (!Array.isArray(orders)) return null;
  const want = lc(token);
  const sameChain = (asset) => {
    const c = asset?.chain;
    const names = [c?.id, c?.name].filter(Boolean).map((x) => lc(x));
    return !chain || names.length === 0 || names.includes(lc(chain));
  };
  let total = 0n;
  for (const o of orders) {
    if (!o || typeof o !== "object") return null;
    if (!OPEN_STATUSES.has(o.status)) continue;
    const buy = o.side === "buy";
    if (!buy && o.side !== "sell") return null;
    const spent = buy ? o.contraAsset : o.targetAsset;
    if (lc(spent?.address) === want && sameChain(spent)) {
      const qty = toBaseUnits(o.qty, decimals);
      if (qty == null) return null;
      const filledRaw = buy ? o.filled?.contraAmount : o.filled?.targetAmount;
      const filled = filledRaw == null || filledRaw === "" ? 0n : toBaseUnits(filledRaw, decimals);
      if (filled == null) return null;
      if (qty > filled) total += qty - filled;
    }
    const ab = o.attachedBracket;
    const received = buy ? o.targetAsset : o.contraAsset;
    if (ab && ab.status === "pending_activation" && lc(received?.address) === want && sameChain(received)) {
      const cap = toBaseUnits(ab.signedMaxFromAmount, decimals);
      if (cap == null) return null;
      total += cap;
    }
  }
  return total;
}

// What we actually approve. flashAmount = the amount in Flash's approve (null = none needed),
// fromAmount = this order's signed spend, openAmount = openSpend(...) for the same token.
// Never more than this order + the open ones; never less than this order; a 0 reset passes.
export function approvalPlan({ flashAmount, fromAmount, openAmount }) {
  if (flashAmount == null) return { ok: true, amount: null };
  if (typeof flashAmount !== "bigint" || typeof fromAmount !== "bigint" || typeof openAmount !== "bigint" || fromAmount <= 0n || openAmount < 0n)
    return { ok: false, reason: "approval amounts unreadable" };
  if (flashAmount === 0n) return { ok: true, amount: 0n };
  if (flashAmount < fromAmount) return { ok: false, reason: "approval is smaller than this order" };
  const bound = fromAmount + openAmount;
  return flashAmount > bound ? { ok: true, amount: bound, capped: true } : { ok: true, amount: flashAmount, capped: false };
}

// ── cancel ──────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isOrderId = (id) => UUID.test(String(id || ""));

// The exact plaintext Flash verifies byte-for-byte (em dash U+2014, one \n, the id as returned).
export function flashCancelMessage(orderId) {
  if (!isOrderId(orderId)) throw new Error("bad order id");
  return `Definitive Flash v1 \u2014 Cancel Order\nOrder: ${orderId}`;
}

// personal_sign wants the message as 0x-hex of its UTF-8 bytes (the em dash is 3 bytes).
export function utf8Hex(str) {
  return "0x" + Array.from(new TextEncoder().encode(String(str)), (b) => b.toString(16).padStart(2, "0")).join("");
}

