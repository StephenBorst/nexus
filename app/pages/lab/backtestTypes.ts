// Response shapes of the PRO backtest routes (nexus-lab-api index.js: /agent/backtest,
// /agent/backtest/sweep, /agent/validate) — only the fields the Lab reads. The worker
// builds them in backtest.mjs + strategies.mjs; if a field is renamed there, tsc now says so.

/** Per-symbol recorded-history coverage (OI or basis). */
export type CoverageRow = { symbol: string; days: number; samples: number; mature: boolean };
/** Backtest/validate send the per-symbol rows; the sweep sends the OI gate object instead. */
export type OiCoverage = CoverageRow[] | { minDays?: number };

type Coverage = { oiCoverage?: OiCoverage; basisCoverage?: CoverageRow[]; excludedSymbols?: string[] };

/** randomEntryBaseline (backtest.mjs) — the ONE verdict ladder shared with the scoreboard. */
export type EntryBaseline = {
  verdict: "BEATS_RANDOM" | "LEANS_ABOVE" | "NOT_DISTINGUISHABLE" | "BELOW_RANDOM" | "TOO_FEW_TRADES";
  trades?: number; minTrades?: number; runs?: number; seed?: number;
  pctBeaten?: number; randomMedianUsd?: number; randomP5Usd?: number; randomP95Usd?: number;
  moreTradesNeeded?: number | null;
};

type Stats = { trades: number; winRate: number; netUsd: number; profitFactor?: number | string };

export type BacktestResult = Coverage & {
  days?: number; basisWindowDays?: number;
  untestable?: boolean; note?: string; strategyLabel?: string; gatesSkipped?: string[];
  combined: Stats;
  perSymbol: (Stats & { symbol: string })[];
  portfolio?: Stats & {
    blocked?: { busy?: number; otherMarket?: number; dailyCap?: number; cooldown?: number };
    baseline?: EntryBaseline;
  };
};

type ValidationBase = Coverage & {
  days: number; folds: number; totalSymbols: number; note?: string; strategyLabel?: string;
};
/** Walk-forward. An untestable run (not enough recorded history) omits the verdict fields. */
export type ValidationResult =
  | (ValidationBase & { untestable: true; verdict?: undefined })
  | (ValidationBase & {
      untestable?: false;
      verdict: "ROBUST" | "FRAGILE" | "NOT_ROBUST";
      posSymbols: number; foldConsistency: number; totalNet: number;
      perSymbol: { symbol: string; net: number; foldsPositive: number; folds: number[] }[];
      portfolio?: {
        watchlist?: string[]; netUsd: number; trades: number; winRate: number;
        foldsPositive: number; folds?: number[]; foldTrades?: number[];
      };
    });

export type SweepRow = {
  name: string; config?: Record<string, unknown>;
  netUsd: number; winRate: number; trades: number;
  posSymbols?: number; totalSymbols?: number; indepNetUsd?: number; indepTrades?: number;
};
export type SweepResult = Coverage & {
  days: number; symbols: string[]; notional?: number; rankedBy?: string;
  results: SweepRow[]; note?: string; oiTested?: boolean; untestable?: boolean;
};
