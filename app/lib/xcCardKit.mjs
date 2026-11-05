// Cross-chain card polish (CrossChainCard.tsx), pure and tested: the live estimate, Max, the progress
// timeline, plain-words quote errors, and the recent-transfers list. Nothing here moves money.

import { verifyQuoteSignature, fromUnits } from "./nearIntents.mjs";

// ── 1. Live estimate (a DRY quote while typing) ────────────────────────────────────────
// A dry quote is signed like a real one, so the preview is checked the same way: 1Click's signature,
// dry, and the exact assets + amount we asked about. It never yields a deposit address; the real
// quote at Review still runs the full checkQuote.
export function checkPreview(response, { originAsset, destinationAsset, amount }) {
  const qr = response?.quoteRequest, q = response?.quote;
  if (!qr || !q) return { ok: false, reason: "no quote" };
  if (!verifyQuoteSignature(response)) return { ok: false, reason: "signature" };
  if (qr.dry !== true) return { ok: false, reason: "not a preview" };
  if (qr.originAsset !== originAsset || qr.destinationAsset !== destinationAsset) return { ok: false, reason: "assets" };
  if (String(qr.amount) !== String(amount) || String(q.amountIn) !== String(amount)) return { ok: false, reason: "amount" };
  if (!/^\d+$/.test(String(q.amountOut ?? "")) || !/^\d+$/.test(String(q.minAmountOut ?? ""))) return { ok: false, reason: "no amounts" };
  return { ok: true, amountOut: String(q.amountOut), minAmountOut: String(q.minAmountOut), timeEstimate: Number(q.timeEstimate) || null };
}

// ── 4. 1Click's quote errors, in plain words ───────────────────────────────────────────
// Seen live (2026-11-05, HTTP 400): "Amount is too low for bridge, try at least 90534" (base units of
// the asset SENT), "No liquidity available" (too small or too large for the route), "recipient is not
// valid". Anything else passes through, trimmed. `from` = { sym, decimals } of the asset sent.
export function quoteErrorText(message, from = {}) {
  const m = String(message || "").trim();
  const min = m.match(/too low[^\d]*try at least\s+(\d+)/i);
  if (min) {
    const amt = Number.isInteger(from.decimals) ? fromUnits(min[1], from.decimals, 6) : min[1];
    return `Too small for this route. Send at least ${amt}${from.sym ? ` ${from.sym}` : ""}.`;
  }
  if (/no liquidity/i.test(m)) return "No route for this amount right now. Try a different amount or destination.";
  if (/recipient is not valid/i.test(m)) return "That destination address isn’t valid for this chain.";
  if (/refund.*not valid/i.test(m)) return "Your refund address isn’t valid for the sending chain.";
  if (!m) return "No quote right now. Try again.";
  return m.length > 140 ? `${m.slice(0, 137)}…` : m;
}

// ── 2. Max: the whole balance of a token; native coin keeps a gas reserve ───────────────
// Reserve covers the deposit transfer's fee (and, on Solana, a new account's rent) with room to spare.
export const GAS_RESERVE = {
  arb: 300_000_000_000_000n,     // 0.0003 ETH
  base: 300_000_000_000_000n,    // 0.0003 ETH
  eth: 3_000_000_000_000_000n,   // 0.003 ETH
  sol: 10_000_000n,              // 0.01 SOL
};
export function maxSendable({ balance, native, chain }) {
  let b;
  try { b = BigInt(balance); } catch { return 0n; }
  if (b <= 0n) return 0n;
  if (!native) return b;
  const r = GAS_RESERVE[chain] ?? 0n;
  return b > r ? b - r : 0n;
}

// ── 3. Progress timeline ───────────────────────────────────────────────────────────────
// track = the card's saved transfer ({ status, hash, check?, timedOut? }). Each step is done /
// active / todo / failed. The last step is the on-chain proof, never 1Click's word alone.
const SEEN = new Set(["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "REFUNDED", "INCOMPLETE_DEPOSIT", "FAILED"]);
const CHAIN_LABEL = { arb: "Arbitrum", base: "Base", eth: "Ethereum", sol: "Solana", btc: "Bitcoin" };
export function xcSteps(track) {
  if (!track) return [];
  const st = track.status, v = track.check?.verdict;
  const on = CHAIN_LABEL[track.check?.chain] ? ` on ${CHAIN_LABEL[track.check.chain]}` : "";
  const refund = st === "REFUNDED" || st === "INCOMPLETE_DEPOSIT";
  const s = (label, state) => ({ label, state });
  const sent = s("Sent", track.hash ? "done" : "active");
  const seen = s("Deposit seen", SEEN.has(st) ? "done" : track.hash ? "active" : "todo");
  if (st === "FAILED") return [sent, seen, s("Failed at 1Click", "failed")];
  if (refund) {
    const back = st === "REFUNDED" ? "done" : "active";
    const proof = v === "REFUNDED" ? "done" : v === "REFUND_SHORT" ? "failed" : back === "done" ? "active" : "todo";
    return [sent, seen, s(st === "INCOMPLETE_DEPOSIT" ? "Short deposit · refunding" : "Refunded", back), s(`Refund confirmed${on}`, proof)];
  }
  const swapping = s("Swapping", st === "SUCCESS" ? "done" : st === "PROCESSING" ? "active" : "todo");
  const delivered = s("Delivered", st === "SUCCESS" ? "done" : "todo");
  const bad = v === "SHORT" || v === "MISMATCH" || v === "MALFORMED";
  const proof = st !== "SUCCESS" ? "todo" : v === "DELIVERED" ? "done" : bad ? "failed" : "active";
  return [sent, seen, swapping, delivered, s(`Confirmed${on}`, proof)];
}

// ── 5. Recent transfers (this device only) ─────────────────────────────────────────────
// Newest first, one row per deposit address, at most `max`. Rows are what the card already keeps.
export const HISTORY_MAX = 5;
export function pushHistory(list, entry, max = HISTORY_MAX) {
  if (!entry || typeof entry.depositAddress !== "string") return Array.isArray(list) ? list.slice(0, max) : [];
  const rest = (Array.isArray(list) ? list : []).filter((x) => x && x.depositAddress !== entry.depositAddress);
  return [entry, ...rest].slice(0, max);
}
