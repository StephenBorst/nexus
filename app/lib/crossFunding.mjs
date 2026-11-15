// Funding across venues (2026-11-15, borst: "what's missing for traders? data, intel"). The same coin's perp funding on
// Orderly, Hyperliquid and OKX, each annualized the same way, side by side, with the gap between Orderly and the
// others. Where the crowd pays more to hold the same side is real, public information no Orderly front end shows.
// An input, never a trade signal: the gap is not a free trade (fees on two venues, funding resets every period,
// the price legs move). Pure, tested; the worker reads the venues (lab-api routes-venues.mjs).

const HOURS_PER_YEAR = 24 * 365;
const num = (v) => { const x = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(x) ? x : null; };
const pct2 = (v) => Math.round(v * 100) / 100;

/** A per-period rate → annual %, given the period in hours. */
export function annualize(rate, periodHours) {
  const r = num(rate), h = num(periodHours);
  if (r == null || h == null || h <= 0) return null;
  return pct2(r * (HOURS_PER_YEAR / h) * 100);
}

/** Hyperliquid metaAndAssetCtxs → { COIN: annual% }. HL funding is an hourly rate. */
export function hlFunding(reply) {
  const out = {};
  const uni = reply?.[0]?.universe, ctx = reply?.[1];
  if (!Array.isArray(uni) || !Array.isArray(ctx)) return out;
  uni.forEach((u, i) => {
    const name = String(u?.name ?? "").toUpperCase();
    if (!name || u?.isDelisted) return;
    const a = annualize(ctx[i]?.funding, 1);
    if (a != null) out[name] = a;
  });
  return out;
}

/** One OKX funding-rate reply → annual%, from its own settlement interval (8h by default). */
export function okxFunding(reply) {
  const row = reply?.code === "0" ? reply?.data?.[0] : null;
  if (!row) return null;
  const t0 = num(row.fundingTime), t1 = num(row.nextFundingTime);
  const h = t0 && t1 && t1 > t0 ? (t1 - t0) / 3.6e6 : 8;
  return annualize(row.fundingRate, h >= 1 && h <= 24 ? h : 8);
}

/**
 * Rows for the coins Orderly lists, from each venue's annual %. `gap` = Orderly minus the average of the venues read
 * (positive = longs pay more on Orderly). Sorted by the size of the gap; a coin no other venue lists has no gap.
 * @param {{ orderly: Record<string, number>, hyperliquid?: Record<string, number>, okx?: Record<string, number> }} v
 */
export function venueRows({ orderly = {}, hyperliquid = {}, okx = {} } = {}) {
  const rows = [];
  for (const [coin, o] of Object.entries(orderly)) {
    if (num(o) == null) continue;
    const hl = num(hyperliquid[coin]), ok = num(okx[coin]);
    const others = [hl, ok].filter((x) => x != null);
    const gap = others.length ? pct2(o - others.reduce((a, b) => a + b, 0) / others.length) : null;
    rows.push({ coin, orderly: o, hyperliquid: hl, okx: ok, gap });
  }
  const key = (r) => (r.gap == null ? -1 : Math.abs(r.gap));
  return rows.sort((a, b) => key(b) - key(a) || a.coin.localeCompare(b.coin));
}

const who = (a) => (a > 0 ? "longs pay" : a < 0 ? "shorts pay" : "flat");

/** The plain line for one coin: "Orderly longs pay 11.0%/yr · Hyperliquid 8.8% · OKX 9.6%. Longs pay 1.8 pts more here." */
export function venueLine(row) {
  if (!row) return null;
  const parts = [`Orderly ${who(row.orderly)} ${Math.abs(row.orderly).toFixed(1)}%/yr`];
  if (row.hyperliquid != null) parts.push(`Hyperliquid ${row.hyperliquid.toFixed(1)}%`);
  if (row.okx != null) parts.push(`OKX ${row.okx.toFixed(1)}%`);
  let tail = "";
  if (row.gap != null && Math.abs(row.gap) >= 0.5) {
    tail = row.gap > 0 ? ` Longs pay ${row.gap.toFixed(1)} pts/yr more here than elsewhere.` : ` Longs pay ${Math.abs(row.gap).toFixed(1)} pts/yr less here than elsewhere.`;
  } else if (row.gap != null) tail = " In line with the other venues.";
  return `${parts.join(" · ")}.${tail}`;
}

export const VENUE_NOTE = "Funding annualized the same way on every venue. A gap is not a free trade: fees on two venues, funding resets every period, and the price legs move.";
