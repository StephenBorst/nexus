// Forecast Divergence, said in one plain read (2026-11-14, borst: "make our tools mean something").
// 2026-11-23: the read compares the crowd with the coin's OWN history (app/lib/forecastOdds.mjs). It used to say
// "The two disagree" from a fold (YES < 50% on an up strike = "leans down"), which called a low price on a far
// strike bearish. Now: the crowd's odds, how often the coin itself made that move in that time, the gap in points,
// and only then which way funding leans. With no history read there is no comparison, and the read says so.
// Tested; ForecastDivergence and the coin drawer (marketRead.mjs) render it.
import { historyLine, gapLine } from "./forecastOdds.mjs";

const money = (n) => {
  if (n == null || !Number.isFinite(n)) return null;
  const dp = n >= 100 ? 0 : n >= 1 ? 2 : 4;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

/**
 * The card's one chip: where this market stands. `watch` = the only amber state (the crowd leans against its own
 * history AND funding leans the other way). Direction words, never green/red.
 * @returns {{ word: string, watch: boolean }}
 */
export function forecastChip(m) {
  const g = Number(m?.crowdGapPts);
  if (m?.divergence) return { word: "Crowd vs funding", watch: true };
  if (!m?.history) return { word: m?.target ? "No history read" : "Not a price target", watch: false };
  if (m?.forecastLean && Number.isFinite(g)) return { word: `Crowd ${g > 0 ? "+" : "−"}${Math.round(Math.abs(g))} pts vs history`, watch: false };
  return { word: "Close to history", watch: false };
}

/** A strike within this % of the price is "close": markets price it high on distance alone. */
export const CLOSE_STRIKE_PCT = 5;

/**
 * @param {{coin:string, yesPct:number, target:number|null, targetDirection:"UP"|"DOWN"|null,
 *          distancePct:number|null, forecastLean:"UP"|"DOWN"|null, fundingLean:"UP"|"DOWN"|null,
 *          divergence:boolean, ends:string|null, history?:object|null, crowdGapPts?:number|null}} m
 * @returns {{ read: string, caveat: string|null }}
 */
export function forecastRead(m) {
  const yes = Math.round(Number(m?.yesPct));
  const t = money(m?.target);
  const verb = m?.targetDirection === "DOWN" ? "dips to" : m?.targetDirection === "UP" ? "reaches" : "hits";
  const by = m?.ends ? ` by ${m.ends}` : "";
  const coin = m?.coin || "this market";
  const odds = Number.isFinite(yes) && t
    ? `Forecasters give ${yes}% that ${coin} ${verb} ${t}${by}.`
    : Number.isFinite(yes) ? `Forecasters give ${yes}% on this question.` : `No forecast read on ${coin}.`;
  const hist = t && m?.history ? historyLine(coin, m.distancePct, m.history) : null;
  const gap = hist ? gapLine(coin, m.crowdGapPts) : null;
  const fund = m?.fundingLean === "UP" ? " Funding leans up: longs are paying to hold."
    : m?.fundingLean === "DOWN" ? " Funding leans down: shorts are paying to hold." : "";
  // Same / opposite only once the crowd has a lean against its own history (forecastLean, set by the board).
  const verdict = m?.forecastLean && m?.fundingLean
    ? (m.forecastLean === m.fundingLean ? " The crowd and funding lean the same way." : " The crowd and funding lean opposite ways.")
    : "";
  const caveat = t && !hist
    ? `${coin}’s own history couldn’t be read, so there’s no comparison: a low number on a far strike is just distance.`
    : null;
  return { read: `${odds}${hist ? ` ${hist}` : ""}${gap ? ` ${gap}` : ""}${fund}${verdict}`, caveat };
}
