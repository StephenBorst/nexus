// ── One-wallet live lift of the graded exit — BUILT DISARMED ──────────────────────────────────────
// Build #3 of docs/research/live-plan-level-reclaim.md (borst's go 2026-11-07: "let one wallet use the graded
// exit (paper-only for now)"). The graded exit (gradedExit.mjs), fixed-risk sizing (riskSizing.mjs) and the
// level_reclaim agent mode (levelReclaim.mjs) each refuse every non-PAPER config. This file is the ONE place that
// can lift those three refusals, for ONE wallet trading ONE read, and only when the config is the live plan's.
//
// Disarmed: the worker var GRADED_EXIT_LIVE_LIFT is EMPTY in all three wrangler.toml files (lab-api, exec, brain),
// pinned by liveLift.test.mjs. deploy.yml re-applies wrangler.toml on every push, so a value set only in the
// dashboard is wiped by the next deploy: arming takes a committed change, which the test refuses. Arming = borst, in
// person, in a PR that records the date, the wallet, his sign-off on the plan, and changes the test with it.
//
// Why no stop cap is needed (the reason gradedExitRefusal refused live in the first place, borst 2026-10-15: "the
// uncapped stop never reaches live money without its own review"). The graded stop is 1.2× the coin's H4 ATR and has
// no % cap: measured 1.1% (BTC) to 6.6% (WLD) at level_reclaim's events. Under margin sizing a wide stop is a bigger
// loss. Under fixed-risk sizing (riskPerTradeUsd) the notional is risk ÷ the stop %, so a wide stop is a SMALLER
// position and every stop-out loses the same dollars. So the lift REQUIRES fixed-risk sizing. Two more bounds sit
// under it: capitalPerTrade caps the margin (a tight stop can't ask for a huge notional), and every live position
// rests an exchange-side backstop at 1.5× its stop (nexus-agent-exec/backstop.mjs, #268) for a stalled worker.
//
// The lift also holds the config to the plan's numbers (LIVE_PLAN_LIMITS, pinned to the plan doc by test). A bigger
// size or another read is a new dated plan and a new PR, never a config edit.
//
// Pure: no fetch, no KV. Var format: "0xWALLET@SIGNALMODE" entries, comma-separated (today the only liftable mode is
// LEVEL_RECLAIM). Bad entries are dropped, never guessed.
import { usesGradedExit } from "./gradedExit.mjs";
import { LEVEL_RECLAIM_MAIN_SYMBOLS } from "./levelReclaim.mjs";

export const LIVE_LIFT_VAR = "GRADED_EXIT_LIVE_LIFT";
export const LIFTABLE_MODES = Object.freeze(["LEVEL_RECLAIM"]);

// The live plan's numbers (live-plan-level-reclaim.md §3). Each is a ceiling the config may not exceed.
export const LIVE_PLAN_LIMITS = Object.freeze({
  riskPerTradeUsd: 10,     // 1R = $10 = 1% of the $1,000 account
  leverage: 3,
  maxDailyLossUsdc: 30,    // 3 stops
  maxTradesPerDay: 4,
  capitalPerTrade: 300,    // the margin ceiling: the largest notional the plan sizes (~$900 at 3x)
  maxHoldHours: 168,       // the graded exit's own hold, exactly
});

const num = (x) => (x === undefined || x === null || x === "" ? null : Number(x));
const lc = (a) => String(a || "").trim().toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(a);

/** "0xA@LEVEL_RECLAIM,0xB@…" → Map(lowercased wallet → Set(mode)). Bad entries dropped. */
export function parseLiveLift(value) {
  const out = new Map();
  for (const item of String(value || "").split(",")) {
    const [w, m] = item.split("@").map((x) => String(x || "").trim());
    const wallet = lc(w), mode = String(m || "").toUpperCase();
    if (!isAddr(wallet) || !LIFTABLE_MODES.includes(mode)) continue;
    if (!out.has(wallet)) out.set(wallet, new Set());
    out.get(wallet).add(mode);
  }
  return out;
}

/** Why this config on this wallet is NOT the plan's live config, or null when it is (the plan's numbers only). */
export function livePlanRefusal(config) {
  const c = config || {};
  if (!LIFTABLE_MODES.includes(c.signalMode)) return `only ${LIFTABLE_MODES.join(", ")} can trade live on the graded exit`;
  if (!usesGradedExit(c)) return "the live lift is for the graded exit only";
  const risk = num(c.riskPerTradeUsd);
  if (!(risk > 0)) return "live needs fixed-risk sizing (riskPerTradeUsd): a wide graded stop must be a smaller position, never a bigger loss";
  if (risk > LIVE_PLAN_LIMITS.riskPerTradeUsd) return `riskPerTradeUsd is capped at $${LIVE_PLAN_LIMITS.riskPerTradeUsd} by the live plan`;
  const lev = num(c.leverage);
  if (!(lev > 0) || lev > LIVE_PLAN_LIMITS.leverage) return `leverage is capped at ${LIVE_PLAN_LIMITS.leverage}x by the live plan`;
  const cap = num(c.capitalPerTrade);
  if (!(cap > 0) || cap > LIVE_PLAN_LIMITS.capitalPerTrade) return `capitalPerTrade (the margin ceiling) is capped at $${LIVE_PLAN_LIMITS.capitalPerTrade} by the live plan`;
  const dl = num(c.maxDailyLossUsdc);
  if (!(dl > 0) || dl > LIVE_PLAN_LIMITS.maxDailyLossUsdc) return `maxDailyLossUsdc must be set, at most $${LIVE_PLAN_LIMITS.maxDailyLossUsdc}`;
  const td = num(c.maxTradesPerDay);
  if (!(td > 0) || td > LIVE_PLAN_LIMITS.maxTradesPerDay) return `maxTradesPerDay must be set, at most ${LIVE_PLAN_LIMITS.maxTradesPerDay}`;
  if (num(c.maxHoldHours) !== LIVE_PLAN_LIMITS.maxHoldHours) return `the graded exit holds ${LIVE_PLAN_LIMITS.maxHoldHours}h`;
  const syms = Array.isArray(c.symbols) ? c.symbols : [];
  if (!syms.length || syms.some((s) => !LEVEL_RECLAIM_MAIN_SYMBOLS.includes(s))) return "symbols must be the graded main-card coins only";
  // nothing the grader doesn't simulate, nothing that changes the traded rule
  if (c.invertSignal) return "an inverted rule is a different read";
  if (c.respectRegime || c.respectSmartMoney || num(c.maxSignalAgeSec) > 0) return "no ungraded gates on the live config";
  if (num(c.volTargetPct) > 0 || c.dcaEnabled) return "fixed-risk sizing only: no vol-targeting, no DCA";
  if (c.autocopy?.enabled) return "no autocopy on the live-plan wallet: it trades its read only";
  return null;
}

/**
 * On a lifted (live-plan) entry, the trade itself must be the plan's: the brain's own read on one of the plan's
 * coins. The config check alone can't see this. exec also opens webhook intents (source "WEBHOOK"), the owner's
 * directives (source "DIRECTIVE", which carry their OWN leverage and capital and skip fixed-risk sizing) and
 * autocopy picks (source "COPY"), on any market they name. On the plan wallet each would be a non-plan trade on
 * the plan's record, at a size the plan never set. Brain signals carry no `source`. Refused, never re-sized.
 * @returns {string|null} why this signal can't open a lifted position, or null
 */
export function liftedSignalRefusal(signal, config) {
  if (!signal || typeof signal !== "object") return "no signal";
  if (signal.directive || signal.source) return `the live-plan wallet opens only its read; a ${String(signal.source || "DIRECTIVE").toLowerCase()} entry isn't the plan`;
  const syms = Array.isArray(config?.symbols) ? config.symbols : [];
  if (!syms.includes(signal.symbol) || !LEVEL_RECLAIM_MAIN_SYMBOLS.includes(signal.symbol)) return `${signal.symbol} isn't one of the plan's coins`;
  return null;
}

/**
 * Is this (wallet, config) lifted for live? Only a non-PAPER config, on a wallet listed for its signal mode in the
 * var, that is exactly the live plan's config. Anything else → false (the paper-only refusals stand).
 */
export function liveLifted(config, wallet, lifts) {
  if (!config || config.mode === "PAPER") return false;
  const map = lifts instanceof Map ? lifts : parseLiveLift(lifts);
  const modes = map.get(lc(wallet));
  if (!modes || !modes.has(config.signalMode)) return false;
  return livePlanRefusal(config) === null;
}

/** For a refusal message: why a listed wallet's live config still isn't lifted (null if not listed or lifted). */
export function liveLiftNote(config, wallet, lifts) {
  if (!config || config.mode === "PAPER") return null;
  const map = lifts instanceof Map ? lifts : parseLiveLift(lifts);
  if (!map.get(lc(wallet))?.has(config.signalMode)) return null;
  return livePlanRefusal(config);
}
