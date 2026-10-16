// ── The recorded universe: which coins the basis × CVD read is recorded and graded on ────────
// ONE list, read by every recorder and grader, so they can't drift:
//   lab-api snapshotFlow (basis:hist + cvd:hist, OKX) · the brain (oi:hist + candle:hist, Orderly)
//   · /intel/axis-backtest (the main card and the holdout line) · /intel/evidence · /signals/basis.
//
// RECORDED_COINS = the nine the read was picked on (recorded since September).
// HOLDOUT_COINS  = eight coins the read was never looked at on, signed off by borst 2026-10-16
//   (docs/research/holdout-universe-prereg.md). Picked on LIQUIDITY only (universe.mjs floors),
//   read twice. They are RECORD-AND-GRADE ONLY:
//   - graded on their own `holdout` line, never pooled into the main card or /intel/evidence;
//   - never sold (/signals/basis leaves them out);
//   - no agent, preset or paper-wallet config changes (a user may still pick one in the Lab).
// A change to either list = a reviewed edit here (recordedUniverse.test.mjs pins both).

export const RECORDED_COINS = Object.freeze(["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "DOGE", "AVAX", "HYPE"]);

export const HOLDOUT_COINS = Object.freeze(["ZEC", "NEAR", "SUI", "PUMP", "ENA", "ONDO", "INJ", "ZRO"]);

// Recording starts when the change deploys; nothing older exists for these coins' basis/CVD.
export const HOLDOUT_SIGNED_OFF = "2026-10-16";

// The reads the holdout line grades: the live read and the basis read under it.
export const HOLDOUT_AXES = Object.freeze(["basis_x_cvd", "basis_extreme"]);

const bare = (c) => String(c || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");
const HOLDOUT_SET = new Set(HOLDOUT_COINS);

export const isHoldoutCoin = (coinOrSymbol) => HOLDOUT_SET.has(bare(coinOrSymbol));
export const perpOf = (coin) => `PERP_${bare(coin)}_USDC`;

// Every coin the flow recorder (basis + CVD) reads each hour.
export const FLOW_COINS = Object.freeze([...RECORDED_COINS, ...HOLDOUT_COINS]);
// Orderly symbols the brain records oi:hist + candle:hist for, on behalf of the holdout.
export const HOLDOUT_PERPS = Object.freeze(HOLDOUT_COINS.map(perpOf));
