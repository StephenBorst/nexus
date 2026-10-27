// ── Solana swap guards (pure) ───────────────────────────────────────────────────────────────────
// The checks app/pages/token/solSwapExec.ts runs on Jupiter's swap transaction before the wallet
// is asked to sign, kept here so they're tested without a wallet or an RPC. Same checklist as the
// EVM signer (swapExec.ts): spend exactly what was typed, the output lands in the user's wallet,
// slippage stays capped, a failed tx reads as failed. Amounts are token BASE UNITS as BigInt
// (u64 on-chain; a Number loses precision past 2^53).

/** u64 `amount` of an SPL / Token-2022 token account (bytes 64..72, little-endian) from base64 data. */
export function tokenAccountAmount(b64) {
  if (typeof b64 !== "string" || !b64) return null;
  let bytes;
  try {
    const bin = atob(b64);
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
  if (bytes.length < 72) return null;
  let v = 0n;
  for (let i = 71; i >= 64; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

const big = (v) => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
};

/**
 * The quote's floor must respect the slippage we asked for: minOut ≥ outAmount × (1 − bps/10,000),
 * rounded down. A floor set lower than that (a widened or tampered quote) is refused.
 * @returns {string | null} null = ok, else the refusal
 */
export function checkMinOut({ outAmount, minOut, slippageBps }) {
  const out = big(outAmount), min = big(minOut);
  if (out == null || min == null || out <= 0n) return "The quote has no minimum received — refused.";
  if (!(slippageBps > 0 && slippageBps <= 10_000)) return "Slippage out of range.";
  const floor = (out * BigInt(10_000 - Math.round(slippageBps))) / 10_000n;
  if (min < floor) return "The quote's minimum is below your slippage limit — refused.";
  if (min > out) return "The quote's minimum is above its own estimate — refused.";
  return null;
}

/**
 * Sum token balances across the user's accounts for one mint, before and after the simulation.
 * @param {Array<{ pre: bigint|string|number|null, post: bigint|string|number|null }>} accounts
 *   pre = before (null when the account doesn't exist yet = 0); post = the simulated balance
 *   (null when unreadable → the whole read is unreadable).
 */
function totals(accounts) {
  let pre = 0n, post = 0n;
  for (const a of accounts || []) {
    const p = a.pre == null ? 0n : big(a.pre);
    const q = big(a.post);
    if (p == null || q == null) return null;
    pre += p; post += q;
  }
  return { pre, post };
}

/**
 * The input token may drop by AT MOST the amount typed (exact, no tolerance). Fail closed: an
 * unreadable balance refuses.
 */
export function checkSpend({ accounts, inAmount }) {
  const amt = big(inAmount);
  if (amt == null || amt <= 0n) return "Bad amount — refused.";
  if (!accounts || !accounts.length) return "Couldn't find the account this spends from — not signing.";
  const t = totals(accounts);
  if (!t) return "Couldn't verify what this spends — not signing.";
  if (t.pre - t.post > amt) return "Transaction would spend more than you typed — refused.";
  return null;
}

/**
 * The user's own accounts for the output mint must gain at least minOut (1% tolerance for
 * simulation drift). Fail closed: unreadable or short refuses. Output sent anywhere else
 * shows up here as no gain.
 */
export function checkReceive({ accounts, minOut }) {
  const min = big(minOut);
  if (min == null || min <= 0n) return "The quote has no minimum received — refused.";
  if (!accounts || !accounts.length) return "Couldn't find where you'd receive this — not signing.";
  const t = totals(accounts);
  if (!t) return "Couldn't verify what you'd receive — not signing.";
  if ((t.post - t.pre) * 100n < min * 99n) return "Simulation doesn't deliver the minimum to your wallet — refused.";
  return null;
}

/** How the result screen reads: only an on-chain confirmation is a success. */
export function swapOutcome(confirmed) {
  return confirmed
    ? { ok: true, title: "Swap confirmed", note: "Confirmed on Solana." }
    : { ok: false, title: "Submitted, not confirmed yet", note: "Check Solscan before trying again: it may still land." };
}
