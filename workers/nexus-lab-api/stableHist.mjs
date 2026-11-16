// stable:hist — total USD stablecoin supply, one row a day (borst 2026-11-16, the "liquidity pulse" step 3: "start logging
// the defillama daily series now so the sample size starts building in the background"). RECORDING ONLY: nothing grades,
// trades, gates or shows it (test-pinned: no grader, brain or exec imports this file). A read or a conditioner on it is
// its own signed page first, graded like everything else.
//
// Source: DefiLlama's public stablecoins API, `GET https://stablecoins.llama.fi/stablecoincharts/all` — the whole daily
// history, one entry per UTC day: { date: "<unix seconds>", totalCirculatingUSD: { peggedUSD, … }, … }. We keep the
// USD-pegged total (`totalCirculatingUSD.peggedUSD`, else `totalCirculating.peggedUSD`). Read at most once every 6 hours
// (the series moves once a day). A reply that doesn't have that shape records nothing and says so in the log: a broken
// read is never a zero.

export const STABLE_HIST_KEY = "stable:hist";
export const STABLE_SOURCE = "https://stablecoins.llama.fi/stablecoincharts/all";
export const STABLE_FROM_MS = Date.UTC(2021, 0, 1);   // keep from 2021: ~2,200 rows, ~70 KB
const READ_EVERY_MS = 6 * 3600000;
const DAY = 86400000;

/** DefiLlama's reply → [{ t: day ms (UTC midnight), usd }] ascending, from STABLE_FROM_MS. Pure; [] on any other shape. */
export function stableRows(reply) {
  if (!Array.isArray(reply)) return [];
  const out = [];
  for (const d of reply) {
    const sec = Number(d?.date);
    const usd = Number(d?.totalCirculatingUSD?.peggedUSD ?? d?.totalCirculating?.peggedUSD);
    if (!Number.isFinite(sec) || !(usd > 0)) continue;
    const t = Math.floor((sec * 1000) / DAY) * DAY;
    if (t < STABLE_FROM_MS) continue;
    out.push({ t, usd: Math.round(usd) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((r, i) => i === 0 || r.t !== out[i - 1].t);   // one row a day
}

/**
 * Read DefiLlama and store the series when it moved. Never shrinks a stored series to a shorter or broken reply.
 * @returns {Promise<{ stored: boolean, rows: number, last: number|null, reason?: string }>}
 */
export async function snapshotStable(kv, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  let stored = null;
  try { stored = JSON.parse((await kv.get(STABLE_HIST_KEY)) || "null"); } catch { stored = null; }
  if (stored?.readAt && now - stored.readAt < READ_EVERY_MS) return { stored: false, rows: stored.rows?.length ?? 0, last: stored.rows?.at(-1)?.t ?? null, reason: "read_recently" };
  const res = await fetchImpl(STABLE_SOURCE, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`defillama ${res.status}`);
  const rows = stableRows(await res.json());
  if (!rows.length) throw new Error("defillama reply had no USD stablecoin rows (shape changed?)");
  const prev = Array.isArray(stored?.rows) ? stored.rows : [];
  if (rows.length < prev.length || (prev.length && rows.at(-1).t < prev.at(-1).t)) {
    throw new Error(`defillama reply shorter than the stored series (${rows.length} < ${prev.length}): kept the stored one`);
  }
  await kv.put(STABLE_HIST_KEY, JSON.stringify({ source: STABLE_SOURCE, readAt: now, rows }));
  return { stored: true, rows: rows.length, last: rows.at(-1).t };
}
