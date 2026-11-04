// ── Our fee on Solana swaps (Jupiter Swap API v1 "Metis") ───────────────────────────────────────
// Jupiter v1 takes an integrator fee with two parameters (docs: swap/v1/add-fees-to-swap, openapi
// swap/v1): `platformFeeBps` on /quote and `feeAccount` on /swap: an INITIALIZED token account we own
// whose mint is the swap's input or output mint. No Referral Program, and Jupiter takes no cut on v1.
// If platformFeeBps is on the quote, feeAccount must be on the swap.
//
// We hold two accounts: USDC and wrapped SOL (wSOL). Every in-app Solana trade touches one of them:
// sells end in USDC, USDC buys start in USDC, SOL buys start in wSOL. Fee mint per trade: USDC if
// either side is USDC, else wSOL if either side is SOL, else no fee.
//
// Set server-side only (a browser value is always dropped), from wrangler vars:
//   JUP_FEE_BPS (1..100), JUP_FEE_ACCOUNT_USDC, JUP_FEE_ACCOUNT_WSOL (token-account addresses).
//   JUP_FEE_LIVE = "true" charges every trade. Anything else = STAGED: the fee applies only to a quote
//   tagged feetest=1 (the app never sends it), so a dry run can prove the fee path before users pay it.
// Unset / invalid / an account that isn't an initialized token account of the right mint ⇒ that fee is
// OFF and swaps go out exactly as before (checked over RPC, cached 10 min). A closed account turns the
// fee off on its own instead of breaking every swap.

export const JUP_FEE_MAX_BPS = 100;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function jupFeeConfig(env) {
  const n = Number(env?.JUP_FEE_BPS);
  const bps = Number.isInteger(n) && n > 0 && n <= JUP_FEE_MAX_BPS ? n : 0;
  const acct = (v) => { const s = String(v || "").trim(); return B58.test(s) ? s : ""; };
  return { bps, usdc: acct(env?.JUP_FEE_ACCOUNT_USDC), wsol: acct(env?.JUP_FEE_ACCOUNT_WSOL), live: env?.JUP_FEE_LIVE === "true" };
}

/** The fee account for a pair, or "" (no fee). `valid` = which configured accounts checked out. */
export function feeAccountFor(inputMint, outputMint, cfg, valid) {
  if (!cfg?.bps) return "";
  const has = (m) => inputMint === m || outputMint === m;
  if (has(USDC_MINT) && cfg.usdc && valid?.usdc) return cfg.usdc;
  if (has(WSOL_MINT) && cfg.wsol && valid?.wsol) return cfg.wsol;
  return "";
}

const QUOTE_PARAMS = ["inputMint", "outputMint", "amount", "slippageBps", "swapMode", "onlyDirectRoutes", "restrictIntermediateTokens", "maxAccounts"];

/**
 * The query we send to Jupiter's /quote: the whitelisted params, plus our platformFeeBps when this
 * pair has a fee account. `nofee=1` (a price read, not a trade) leaves the fee off.
 */
export function jupQuoteParams(searchParams, cfg, valid) {
  const p = new URLSearchParams();
  for (const k of QUOTE_PARAMS) {
    const v = searchParams.get(k);
    if (v != null && v !== "") p.set(k, v);
  }
  const exactIn = (p.get("swapMode") || "ExactIn") === "ExactIn";
  const wanted = cfg?.live || searchParams.get("feetest") === "1"; // staged = test quotes only
  const acct = !wanted || searchParams.get("nofee") === "1" || !exactIn ? "" : feeAccountFor(p.get("inputMint"), p.get("outputMint"), cfg, valid);
  if (acct) p.set("platformFeeBps", String(cfg.bps));
  return p;
}

/**
 * The /swap body we send: the browser's body with any feeAccount dropped, and OUR feeAccount added
 * when the quote carries our fee. A quote whose fee isn't ours (another rate) is refused.
 * @returns {{ body: string } | { error: string, status: number }}
 */
export function withJupSwapFee(bodyText, cfg, valid) {
  let b;
  try { b = JSON.parse(bodyText); } catch { return { body: bodyText }; } // Jupiter rejects it anyway
  if (!b || typeof b !== "object" || Array.isArray(b)) return { body: bodyText };
  delete b.feeAccount;
  const q = b.quoteResponse || {};
  const feeBps = Number(q?.platformFee?.feeBps || 0);
  if (!feeBps) return { body: JSON.stringify(b) };
  if (feeBps !== cfg?.bps) return { error: "fee_mismatch", status: 400 };
  const acct = feeAccountFor(q.inputMint, q.outputMint, cfg, valid);
  if (!acct) return { error: "fee_account_unavailable", status: 409 };
  b.feeAccount = acct;
  return { body: JSON.stringify(b) };
}

// Swap API V2 Router: GET /swap/v2/build = quote + raw instructions in one call (v1's successor;
// docs swap/migration/metis-to-build). ExactIn only, `taker` required. The fee is the same pair of
// params, both on this one call: platformFeeBps + feeAccount. Only these params pass; anything that
// redirects funds or payment (payer, destinationTokenAccount, nativeDestinationAccount, tipAmount,
// feeAccount from the browser, transactionVersion) is never forwarded.
const BUILD_PARAMS = ["inputMint", "outputMint", "amount", "taker", "slippageBps", "maxAccounts"];

/** The query we send to Jupiter's /build, with our fee when this pair has a fee account. */
export function jupBuildParams(searchParams, cfg, valid) {
  const p = new URLSearchParams();
  for (const k of BUILD_PARAMS) {
    const v = searchParams.get(k);
    if (v != null && v !== "") p.set(k, v);
  }
  const wanted = cfg?.live || searchParams.get("feetest") === "1";
  const acct = !wanted || searchParams.get("nofee") === "1" ? "" : feeAccountFor(p.get("inputMint"), p.get("outputMint"), cfg, valid);
  if (acct) { p.set("platformFeeBps", String(cfg.bps)); p.set("feeAccount", acct); }
  return p;
}

/** Is `info` (getAccountInfo jsonParsed `value`) an initialized token account for `mint`? */
export function isTokenAccountFor(info, mint) {
  const parsed = info?.data?.parsed;
  return !!parsed && parsed.type === "account" && parsed.info?.mint === mint && parsed.info?.state === "initialized";
}

let cache = { key: "", at: 0, valid: { usdc: false, wsol: false } };
const TTL_MS = 10 * 60 * 1000;

/**
 * Which configured fee accounts are usable, checked over RPC, cached 10 min per config.
 * @param {(method: string, params: unknown[]) => Promise<any>} rpc
 */
export async function validFeeAccounts(cfg, rpc, now = Date.now()) {
  if (!cfg?.bps || (!cfg.usdc && !cfg.wsol)) return { usdc: false, wsol: false };
  const key = `${cfg.usdc}|${cfg.wsol}`;
  if (cache.key === key && now - cache.at < TTL_MS) return cache.valid;
  const check = async (addr, mint) => {
    if (!addr) return false;
    try { return isTokenAccountFor((await rpc("getAccountInfo", [addr, { encoding: "jsonParsed" }]))?.value, mint); }
    catch { return null; } // unreadable: keep the last answer
  };
  const [u, w] = await Promise.all([check(cfg.usdc, USDC_MINT), check(cfg.wsol, WSOL_MINT)]);
  const prev = cache.key === key ? cache.valid : { usdc: false, wsol: false };
  const valid = { usdc: u ?? prev.usdc, wsol: w ?? prev.wsol };
  if ((cfg.usdc && u === false) || (cfg.wsol && w === false)) console.log(`[jupfee] fee account not usable · usdc=${u} wsol=${w}`);
  cache = { key, at: now, valid };
  return valid;
}

export function _resetJupFeeCache() { cache = { key: "", at: 0, valid: { usdc: false, wsol: false } }; }
