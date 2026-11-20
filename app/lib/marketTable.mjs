// ── The market table: one row per coin, every input as its own column (borst 2026-11-20, terminal step 4) ───────────
// Columns are the inputs the terminal already serves: funding, open interest vs volume, the funding gap across venues,
// smart money, the forecast split, headlines naming the coin, and the registered reads holding a paper trade on it.
// No combined score, no rank of "best": the default order is open interest (size), and a reader sorts by any column.
// A cell past a STATED line (the Intel tape's lines, app/lib/intelTape.mjs) is marked; nothing adds cells up.
// A source that fails leaves its column unread (null + named), never 0. Rules pure and tested (marketTable.test.mjs);
// route workers/nexus-lab-api/routes-table.mjs, UI app/pages/lab/MarketTable.tsx.
import { FUNDING_LONGS_PCT, FUNDING_SHORTS_PCT, OI_CONC_X, MIN_SIGNAL_VOL } from "./intelTape.mjs";
import { CONSENSUS_RATIO } from "./smartConsensus.mjs";

export const TABLE_MIN_OI_USD = 30_000;   // the recorded universe's Orderly OI floor: thinner books are left out, and counted
export const TABLE_MAX = 40;
export const TABLE_NEWS_WINDOW_MS = 24 * 3600_000;

/** The columns, in order. `sort` reads the value a column sorts by (null = unread or none, always last). */
export const TABLE_COLUMNS = Object.freeze([
  { id: "coin", label: "Coin", help: "Orderly mark and 24h move." },
  { id: "funding", label: "Funding 8h", help: `Paid per 8h by the crowded side. Marked past +${FUNDING_LONGS_PCT}% / ${FUNDING_SHORTS_PCT}%.` },
  { id: "oiVol", label: "OI ÷ vol", help: `Open interest over 24h volume. Marked above ${OI_CONC_X}× on a market trading > $100k.` },
  { id: "gap", label: "Venue gap", help: "Orderly funding minus the average on Hyperliquid and OKX, annualized points." },
  { id: "smart", label: "Smart", help: `Tracked wallets short vs long. A side shows at ${CONSENSUS_RATIO}× the other with 2 or more.` },
  { id: "forecast", label: "Forecasts", help: "Price-target markets that lean against funding, of those listed." },
  { id: "news", label: "News 24h", help: "Headlines naming the coin in the last day." },
  { id: "reads", label: "Reads", help: "Registered reads holding a paper trade on it now." },
  { id: "oi", label: "OI", help: "Open interest on Orderly, USD." },
]);
export const DEFAULT_SORT = Object.freeze({ col: "oi", dir: "desc" });

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/** The 2× rule the drawer and alerts use: a side only when it leads with ≥ 2 and ≥ 2× the other. */
export function smartLean(c) {
  if (!c) return null;
  const L = n(c.long) ?? 0, S = n(c.short) ?? 0;
  const lead = Math.max(L, S), other = Math.min(L, S);
  const side = lead >= 2 && lead > other && lead >= CONSENSUS_RATIO * other ? (S > L ? "SHORT" : "LONG") : "NONE";
  return { long: L, short: S, side };
}

/**
 * @param {{ futures: object[]|null, venues?: object|null, smart?: object|null, forecasts?: object|null,
 *   news?: object|null, paperRuns?: Record<string, object>|null, now?: number }} input  any source may be null (unread)
 * @returns {{ rows: object[], leftOut: number, unread: string[] }}
 */
export function marketTable({ futures, venues = null, smart = null, forecasts = null, news = null, paperRuns = null, now = Date.now() } = {}) {
  const unread = [];
  if (!Array.isArray(futures)) return { rows: [], leftOut: 0, unread: ["markets"] };
  if (!venues) unread.push("venues");
  if (!smart) unread.push("smart");
  if (!forecasts) unread.push("forecasts");
  if (!news) unread.push("news");
  if (!paperRuns) unread.push("reads");

  const gapBy = new Map((venues?.rows ?? []).map((r) => [bare(r.coin), num(r.gap)]));
  const fcBy = new Map();
  for (const m of forecasts?.markets ?? []) {
    const c = bare(m?.coin ?? m?.symbol);
    const f = fcBy.get(c) ?? { divergent: 0, total: 0 };
    f.total++; if (m.divergence) f.divergent++;
    fcBy.set(c, f);
  }
  const newsBy = new Map();
  for (const s of news?.items ?? []) {
    const t = s.publishedAt ?? s.firstSeenAt;
    if (!Number.isFinite(t) || now - t > TABLE_NEWS_WINDOW_MS) continue;
    for (const c of s.coins ?? []) newsBy.set(c, (newsBy.get(c) || 0) + 1);
  }
  const readsBy = new Map();
  for (const [axis, run] of Object.entries(paperRuns ?? {})) {
    const o = run?.open;
    if (o && o.coin) { const c = bare(o.coin); readsBy.set(c, [...(readsBy.get(c) || []), { axis, side: o.side }]); }
  }

  const all = [];
  for (const r of futures) {
    const sym = String(r?.symbol || "");
    if (!/^PERP_[A-Z0-9]+_USDC$/.test(sym)) continue;
    const coin = bare(sym);
    const mark = n(r.mark_price);
    if (!(mark > 0)) continue;
    const oiUsd = (n(r.open_interest) ?? 0) * mark;
    const volUsd = n(r["24h_amount"]);
    const open24 = n(r["24h_open"]);
    const f = n(r.last_funding_rate);
    const funding8hPct = f == null ? null : Math.round(f * 100 * 1e5) / 1e5;
    const oiVol = volUsd && volUsd > 0 ? Math.round((oiUsd / volUsd) * 100) / 100 : null;
    all.push({
      coin, price: mark,
      change24hPct: open24 && open24 > 0 ? Math.round(((mark - open24) / open24) * 1e4) / 100 : null,
      oiUsd: Math.round(oiUsd), volUsd: volUsd == null ? null : Math.round(volUsd),
      funding8hPct,
      fundingPast: funding8hPct == null ? null : funding8hPct > FUNDING_LONGS_PCT ? "LONGS" : funding8hPct < FUNDING_SHORTS_PCT ? "SHORTS" : null,
      oiVol, oiVolPast: oiVol != null && (volUsd ?? 0) > MIN_SIGNAL_VOL && oiVol > OI_CONC_X,
      gap: venues ? (gapBy.get(coin) ?? null) : null,
      smart: smart ? smartLean(smart.consensus?.[coin]) : null,
      forecast: forecasts ? (fcBy.get(coin) ?? null) : null,
      news: news ? (newsBy.get(coin) || 0) : null,
      reads: paperRuns ? (readsBy.get(coin) || []) : null,
    });
  }
  const kept = all.filter((x) => x.oiUsd >= TABLE_MIN_OI_USD).sort((a, b) => b.oiUsd - a.oiUsd);
  return { rows: kept.slice(0, TABLE_MAX), leftOut: all.length - Math.min(kept.length, TABLE_MAX), unread };
}

/** The number a column sorts by. Funding and the gap sort by size either way; null = nothing to sort on. */
export function sortValue(row, col) {
  switch (col) {
    case "coin": return row.coin;
    case "funding": return row.funding8hPct == null ? null : Math.abs(row.funding8hPct);
    case "oiVol": return row.oiVol;
    case "gap": return row.gap == null ? null : Math.abs(row.gap);
    case "smart": return row.smart ? row.smart.long + row.smart.short : null;
    case "forecast": return row.forecast ? row.forecast.divergent : null;
    case "news": return row.news;
    case "reads": return row.reads ? row.reads.length : null;
    case "oi": return row.oiUsd;
    default: return null;
  }
}

/**
 * Rows sorted by a column; ties by open interest; nulls always last, whichever way.
 * @param {object[]} rows @param {string} [col] @param {string} [dir] "asc" | "desc"
 */
export function sortTable(rows, col = DEFAULT_SORT.col, dir = DEFAULT_SORT.dir) {
  const k = dir === "asc" ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const va = sortValue(a, col), vb = sortValue(b, col);
    if (va == null && vb == null) return b.oiUsd - a.oiUsd;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") return k * va.localeCompare(vb);
    return k * (va - vb) || b.oiUsd - a.oiUsd;
  });
}

/**
 * Tapping a header: a new column sorts biggest first (A→Z for the coin); the same column flips.
 * @param {{col: string, dir: string}} cur @param {string} col @returns {{col: string, dir: string}}
 */
export function nextSort(cur, col) {
  if (cur.col === col) return { col, dir: cur.dir === "desc" ? "asc" : "desc" };
  return { col, dir: col === "coin" ? "asc" : "desc" };
}

// ── Cell words ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const usdShort = (v) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
export const fundingCell = (r) => (r.funding8hPct == null ? "—" : `${r.funding8hPct > 0 ? "+" : r.funding8hPct < 0 ? "−" : ""}${Math.abs(r.funding8hPct).toFixed(4)}%`);
export const oiVolCell = (r) => (r.oiVol == null ? "—" : `${r.oiVol.toFixed(1)}×`);
export const gapCell = (r) => (r.gap == null ? "—" : `${r.gap > 0 ? "+" : r.gap < 0 ? "−" : ""}${Math.abs(r.gap).toFixed(0)} pts`);
export const smartCell = (r) => (!r.smart || r.smart.long + r.smart.short === 0 ? "—" : `${r.smart.short}S · ${r.smart.long}L`);
export const forecastCell = (r) => (!r.forecast ? "—" : `${r.forecast.divergent} of ${r.forecast.total}`);
export const newsCell = (r) => (r.news == null ? "unread" : r.news ? String(r.news) : "—");
export const readsCell = (r) => (r.reads == null ? "unread" : r.reads.length ? String(r.reads.length) : "—");
