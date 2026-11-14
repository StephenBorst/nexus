// The trade page's one-line read (2026-11-14, borst: "trade page reads"): the coin on screen, three inputs in a few
// words each, from the market drawer's own answer (GET /intel/market/:coin → `facts`). Inputs only: no tally, no side
// picked, no grade claimed here; "Read ETH →" opens the drawer, where each lens carries its grade. Pure, tested.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct1 = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** [{ label, text, tone }] for the strip; empty when nothing was read. tone "watch" = a stretch worth a look. */
export function marketStrip(market) {
  const f = market?.facts;
  if (!f) return [];
  const out = [];
  const fa = num(f.fundAnnual);
  if (fa != null) {
    const who = fa > 0 ? "longs pay" : fa < 0 ? "shorts pay" : "flat";
    out.push({ label: "Funding", text: fa === 0 ? "flat" : `${who} ${Math.abs(fa).toFixed(1)}%/yr${f.stretched ? ", stretched" : ""}`, tone: f.stretched ? "watch" : "plain" });
  }
  const L = num(f.smartLong), S = num(f.smartShort);
  if (L != null || S != null) {
    const clear = f.smartClear === "LONG" || f.smartClear === "SHORT";
    out.push({ label: "Smart money", text: `${S ?? 0} short · ${L ?? 0} long${clear ? `, agree ${f.smartClear.toLowerCase()}` : ""}`, tone: "plain" });
  }
  const oi = num(f.oiChangePct);
  const ch = num(market?.change24hPct);
  if (ch != null || oi != null) {
    const parts = [];
    if (ch != null) parts.push(`${pct1(ch)} 24h`);
    if (oi != null) parts.push(Math.abs(oi) < 0.05 ? "OI flat" : `OI ${pct1(oi)}`);
    out.push({ label: "Tape", text: parts.join(" · "), tone: "plain" });
  }
  return out;
}

/** The title on the strip: what it is and isn't. */
export const STRIP_TITLE = "Inputs on this market, not a verdict. Open the read for each lens with its grade.";
