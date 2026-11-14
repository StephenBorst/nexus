// Forecast Divergence, said in one plain read (2026-11-14, borst: "make our tools mean something").
// The card showed chips ("DIVERGENT · YES 82% · lean DOWN · tape UP") and left the reader to assemble the sentence
// and to spot the catch. This builds the sentence, and names the two common catches: a strike so close that a
// high YES is just distance, and a YES near 50% (a coin flip, not a lean). Tested; ForecastDivergence renders it.

const money = (n) => {
  if (n == null || !Number.isFinite(n)) return null;
  const dp = n >= 100 ? 0 : n >= 1 ? 2 : 4;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

/** A strike within this % of the price is "close": markets price it high on distance alone. */
export const CLOSE_STRIKE_PCT = 5;

/**
 * @param {{coin:string, yesPct:number, target:number|null, targetDirection:"UP"|"DOWN"|null,
 *          distancePct:number|null, forecastLean:"UP"|"DOWN"|null, fundingLean:"UP"|"DOWN"|null,
 *          divergence:boolean, ends:string|null}} m
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
    : m?.forecastLean === "UP" || m?.forecastLean === "DOWN"
      ? `Forecasters lean ${m.forecastLean === "UP" ? "up" : "down"} on ${coin}.`
      : `No clear forecast lean on ${coin}.`;
  const fund = m?.fundingLean === "UP" ? " Funding leans up: longs are paying to hold."
    : m?.fundingLean === "DOWN" ? " Funding leans down: shorts are paying to hold." : "";
  const verdict = m?.divergence ? " The two disagree." : m?.forecastLean && m?.fundingLean ? " The two agree." : "";

  let caveat = null;
  const dist = m?.distancePct == null ? NaN : Math.abs(Number(m.distancePct));
  if (Number.isFinite(dist) && dist < CLOSE_STRIKE_PCT && Number.isFinite(yes) && yes >= 60) {
    caveat = `The strike is only ${dist.toFixed(1)}% away, and strikes that close price high on distance alone.`;
  } else if (Number.isFinite(yes) && yes >= 40 && yes <= 60) {
    caveat = "Near 50%: a coin flip, not a lean.";
  }
  return { read: `${odds}${fund}${verdict}`, caveat };
}
