// The risk desk's one read of the account (app/lib/riskDesk.mjs): the SDK's position stream, collateral, the
// estimated funding rates and each market's funding period. All in the browser; nothing about the book leaves it.
import { useMemo } from "react";
import { usePositionStream, useCollateral, useFundingRatesStore, useSymbolsInfoStore } from "@orderly.network/hooks";
import { riskDesk } from "@/lib/riskDesk.mjs";

export type RiskStop = { kind: "full" | "partial" | "none"; price?: number; pastLiq?: boolean; lockedIn?: boolean; distPct?: number; loss?: number };
export type RiskPosition = {
  coin: string; symbol: string; side: "LONG" | "SHORT"; size: number; mark: number; notional: number;
  liq: number | null; liqDistPct: number | null; lossToLiq: number | null; stop: RiskStop; fundingPerDay: number | null;
  shareOfEquity: number | null; stopShareOfEquity: number | null;
};
export type RiskDesk = {
  positions: RiskPosition[]; equity: number | null; gross: number; net: number; leverage: number | null;
  atStops: number; atStopsPct: number | null; unstopped: string[]; fundingPerDay: number | null;
  flags: Array<{ level: "warn" | "watch"; text: string }>;
};

export function useRiskDesk(): { desk: RiskDesk; loading: boolean } {
  const [{ rows }, , { isLoading }] = usePositionStream();
  const { totalCollateral } = useCollateral();
  const rates = useFundingRatesStore();
  const symbols = useSymbolsInfoStore();
  const desk = useMemo(() => {
    const funding: Record<string, number> = {};
    const periods: Record<string, number> = {};
    for (const r of (rows ?? []) as Array<{ symbol: string }>) {
      const f = Number(rates?.[r.symbol]?.est_funding_rate);
      if (Number.isFinite(f)) funding[r.symbol] = f;
      const p = Number(symbols?.[r.symbol]?.funding_period);
      if (Number.isFinite(p) && p > 0) periods[r.symbol] = p;
    }
    return riskDesk(rows as object[], { equity: Number(totalCollateral) || null, funding, periods }) as unknown as RiskDesk;
  }, [rows, totalCollateral, rates, symbols]);
  return { desk, loading: isLoading };
}
