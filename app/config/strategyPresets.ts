// Deployable agent-strategy presets — the "Strategy Library", but executable.
// Each preset is a Partial<AgentConfig> a user can one-click load into the agent,
// review, and save. Presets set strategy + risk params only — they do NOT set
// `mode`, so loading preserves the user's current mode (PAPER / ASSISTED /
// AUTONOMOUS). PRO presets use advanced signal modes and are gated by useSubscription.
import type { AgentConfig } from "@/pages/lab/types";

export interface StrategyPreset {
  id: string;
  name: string;
  tag: string;       // risk/style label
  accent: string;
  blurb: string;
  pro?: boolean;
  config: Partial<AgentConfig>;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "basis-extreme-fade",
    name: "Basis Extreme Fade",
    tag: "EXPERIMENTAL · PAPER",
    accent: "#e0a458",
    blurb: "Trades the one read our signal scoreboard grades PREDICTIVE (n=203, stable) — while it grades our own funding-fade flagship NOISE. A perp far above spot is froth (fade it short); far below is capitulation (fade it long). Extreme is measured against this market's own trailing week, never a fixed number, and it is the SAME rule the scoreboard grades — not a combo stack, not basis×CVD. ⚠️ PREDICTIVE rates the READ, not a strategy: the exits, sizing and fees here are unvalidated, and it is NOT walk-forward robust. Runs on a 12h hold because that is a graded horizon. PAPER only, on its own wallet, until it has a record of its own.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"],
      signalMode: "BASIS_FADE",
      mode: "PAPER",
      leverage: 5, capitalPerTrade: 50,
      tpPercent: 2.5, slPercent: 2, maxHoldHours: 12,
      // Hard stops: at most 3 entries a day, and the day ends after ~2 full losers.
      maxTradesPerDay: 3, maxDailyLossUsdc: 10,
    },
  },
  {
    id: "basis-cvd-stack",
    name: "Basis × CVD Stack",
    tag: "EXPERIMENTAL · PAPER",
    accent: "#e0a458",
    blurb: "The stack method, traded: take the basis-extreme fade ONLY when aggressor flow in the same hour diverges the same way (price up on net selling → short; down on net buying → long). This is exactly the intersection the scoreboard grades as \"Basis extreme × CVD divergence\" — one shared rule, graded and traded, with a parity test pinning them together. Rarer than the plain basis fade by design; it sits out more than it trades. ⚠️ The scoreboard grades the READ, not this strategy — exits, sizing and fees are unvalidated. PAPER only until it has a record of its own.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"],
      signalMode: "BASIS_FADE", basisConfirm: "CVD",
      mode: "PAPER",
      leverage: 5, capitalPerTrade: 50,
      tpPercent: 2.5, slPercent: 2, maxHoldHours: 12,
      maxTradesPerDay: 3, maxDailyLossUsdc: 10,
    },
  },
  {
    id: "regime-gated-invert",
    name: "Regime-Gated Invert",
    tag: "LEAD · NOT YET ROBUST",
    accent: "#e0a458",
    blurb: "Fades the confluence signal (funding + OI agree), and only where fading has paid: high volatility (ATR% ≥ 0.7), US/Europe sessions, fresh signals only. It beats raw confluence on the same window — smaller loss, higher win rate — but both are still net negative, and the cross-market walk-forward comes back NOT ROBUST (net-positive on 1 of 4 markets). A lead worth papering, not an edge. PAPER only until it has a graded record.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC", "PERP_HYPE_USDC"],
      signalMode: "CONFLUENCE", invertSignal: true,
      fundingThreshold: 0.01, oiChangeThreshold: 1,
      minVolAtrPct: 0.7, tradeSessions: ["US", "EUROPE"],
      leverage: 5, capitalPerTrade: 50, tpPercent: 2, slPercent: 1, maxHoldHours: 4,
      maxTradesPerDay: 4, maxDailyLossUsdc: 5,
      // This edge reverts fast (hunt6) — only enter on a FRESH signal (≤3min), never a
      // stale one, so live execution latency doesn't turn a right call into a late one.
      maxSignalAgeSec: 180,
    },
  },
  {
    id: "proven-edge",
    name: "BTC Funding Fade",
    tag: "EXPERIMENTAL",
    accent: "#71717a",
    blurb: "Selective funding-fade on BTC: enters only when funding is a top-5% extreme, with a breakeven risk-free stop. Marginal in single-window tests but it does NOT hold up under our cross-market walk-forward — so we won't call it proven. Treat it as an experiment, PAPER only. We label what's validated and what isn't.",
    config: {
      symbols: ["PERP_BTC_USDC"], signalMode: "FUNDING_ONLY", leverage: 5, capitalPerTrade: 50,
      tpPercent: 1.5, slPercent: 0.75, maxHoldHours: 4, maxTradesPerDay: 4, maxDailyLossUsdc: 5,
      fundingThreshold: 0.01, fundingPercentileMin: 95,
      // Breakeven at a LATE trigger (1.0% ≈ 0.66× the TP distance) — backtest showed
      // it lifts BTC net +3.5→+6.6 / PF 1.1→1.21 vs the flat exit and never hurt
      // in-sample (early triggers choke the fade like trailing does — 1.0 is the floor).
      breakevenTriggerPct: 1.0,
    },
  },
  {
    id: "funding-harvester",
    name: "Funding Harvester",
    tag: "CONSERVATIVE",
    accent: "#71717a",
    blurb: "Fade funding + OI extremes on BTC only. Low leverage, tight caps — the slow-and-steady default.",
    config: {
      symbols: ["PERP_BTC_USDC"], signalMode: "CONFLUENCE", leverage: 3, capitalPerTrade: 30,
      tpPercent: 1.2, slPercent: 0.6, maxHoldHours: 6, maxTradesPerDay: 6, maxDailyLossUsdc: 10,
      fundingThreshold: 0.015, oiChangeThreshold: 0,
    },
  },
  {
    id: "blue-chip-confluence",
    name: "Blue-Chip Confluence",
    tag: "BALANCED",
    accent: "#71717a",
    blurb: "Confluence across BTC + ETH. Both funding and OI must agree — fewer, higher-quality entries.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], signalMode: "CONFLUENCE", leverage: 5, capitalPerTrade: 40,
      tpPercent: 1.5, slPercent: 0.75, maxHoldHours: 4, maxTradesPerDay: 8, maxDailyLossUsdc: 12,
      fundingThreshold: 0.01,
    },
  },
  {
    id: "oi-divergence-hunter",
    name: "OI Divergence Hunter",
    tag: "BALANCED",
    accent: "#71717a",
    blurb: "Trade open-interest divergence alone on BTC + ETH. Catches positioning unwinds funding misses.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], signalMode: "OI_ONLY", leverage: 5, capitalPerTrade: 40,
      tpPercent: 1.5, slPercent: 0.8, maxHoldHours: 4, maxTradesPerDay: 8, maxDailyLossUsdc: 12,
      oiChangeThreshold: 0.5,
    },
  },
  {
    id: "funding-scalper",
    name: "Funding Scalper",
    tag: "AGGRESSIVE",
    accent: "#71717a",
    blurb: "Fast funding-only entries across BTC/ETH/SOL. Higher leverage, tight TP/SL, more trades/day.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"], signalMode: "FUNDING_ONLY", leverage: 8,
      capitalPerTrade: 30, tpPercent: 0.8, slPercent: 0.5, maxHoldHours: 2, maxTradesPerDay: 14,
      maxDailyLossUsdc: 12, fundingThreshold: 0.008,
    },
  },
  {
    id: "momentum-rider",
    name: "Momentum Rider",
    tag: "PRO · TREND",
    accent: "#3ecf8e",
    pro: true,
    blurb: "Trade WITH a price move above threshold across majors. Rides strength — noisy, test in paper.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"], signalMode: "MOMENTUM", leverage: 8,
      capitalPerTrade: 40, tpPercent: 2, slPercent: 1, maxHoldHours: 4, maxTradesPerDay: 10,
      maxDailyLossUsdc: 15, priceChangeThreshold: 0.6,
    },
  },
  {
    id: "mean-reversion-fade",
    name: "Mean Reversion Fade",
    tag: "PRO · FADE",
    accent: "#3ecf8e",
    pro: true,
    blurb: "Fade sharp moves on BTC + ETH — buy the dip, sell the rip above your price threshold.",
    config: {
      symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], signalMode: "MEAN_REVERSION", leverage: 6, capitalPerTrade: 30,
      tpPercent: 1.5, slPercent: 1, maxHoldHours: 3, maxTradesPerDay: 10, maxDailyLossUsdc: 12,
      priceChangeThreshold: 0.7,
    },
  },
];

// Scoreboard read (axisbt axis `name`) → the preset that trades THAT SAME rule. Only reads
// whose live signal is literally the graded rule belong here (shared module + parity test);
// a read without an agent mode stays research-only rather than borrowing a look-alike.
export const AXIS_PRESET: Record<string, string> = {
  basis_extreme: "basis-extreme-fade",   // app/lib/basisFade.mjs
  basis_x_cvd: "basis-cvd-stack",        // app/lib/basisStack.mjs
};
// Reads whose preset is PAUSED: the scoreboard keeps grading them (the exit grade still feeds the
// Oct-15 re-validation), but /proof stops offering the one-tap Load. Reversible — delete the line.
export const AXIS_PAUSED: Record<string, string> = {
  basis_extreme: "preset paused Sept 25 — its 12h exit grades NOISE (−10 bps, n148); 24h only PROMISING. Still graded.",
};
export const presetById = (id: string) => STRATEGY_PRESETS.find((p) => p.id === id);
