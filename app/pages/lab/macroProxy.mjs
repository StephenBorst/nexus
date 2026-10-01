// The macro-proxy chart's series: BTC over the last 30 days as 4H closes. Orderly serves no 4H
// candles (resolution 240 = "no_data", so the chart used to never render); the bars are built
// from 1H candles in two 20-day pages by the shared fourHourBars module. Kept out of the .tsx so
// macroProxy.test.mjs runs the chart's exact fetch path against a fake /tv/history.
import { fetchFourHourBars } from "../../lib/fourHourBars.mjs";

export const MACRO_PROXY_SYMBOL = "PERP_BTC_USDC";
export const MACRO_PROXY_DAYS = 30;

/** @returns {Promise<{ t: number, c: number }[]>}  t in ms; throws if a page fails */
export async function loadMacroProxySeries({ getJson, nowSec = Math.floor(Date.now() / 1000) }) {
  const { bars } = await fetchFourHourBars(MACRO_PROXY_SYMBOL, nowSec - MACRO_PROXY_DAYS * 86400, nowSec, { getJson });
  return bars.filter((b) => b.c > 0).map((b) => ({ t: b.t, c: b.c }));
}
