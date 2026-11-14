// forecast:hist:{COIN} — the hourly recorder lens read B needs (docs/research/lens-reads-prereg.md B,
// forecast_divergence). RECORDING ONLY: nothing grades, trades or shows these rows. B can be registered only once
// this series has 14 days and a count-only power check, on its own signed page.
//
// Each hour, from the same board /intel/forecasts serves (read through the worker's own handler, so one Polymarket
// read serves both), one row per price-target market on a coin: the inputs B's rule reads (YES %, the strike, the
// strike's direction, its distance from the mark, the funding lean), plus the market id and volume so a later rule
// can pick "the liquid one" without guessing. A market with no strike (not a price target) is not recorded.

import { marketCoin } from "../../app/lib/marketRead.mjs";

export const FORECAST_HIST_PREFIX = "forecast:hist:";
export const FORECAST_HIST_MAX_ROWS = 6000; // ≈ 60 days at 4 markets a coin
export const FORECAST_HIST_PER_COIN = 6; // deepest markets per coin per hour
const HOURLY_GUARD_MS = 55 * 60 * 1000;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Board → { COIN: rows[] } for one hour. Pure. */
export function forecastHistRows(board, t) {
  const byCoin = {};
  for (const m of board?.markets ?? []) {
    const coin = marketCoin(m?.coin);
    const target = num(m?.target), yesPct = num(m?.forecastProbPct), distancePct = num(m?.distancePct);
    if (!coin || target == null || yesPct == null || distancePct == null) continue;
    if (m.targetDirection !== "UP" && m.targetDirection !== "DOWN") continue;
    (byCoin[coin] ??= []).push({
      t,
      id: m.id != null ? String(m.id) : null,
      yesPct,
      target,
      direction: m.targetDirection,
      distancePct,
      fundingLean: m.fundingLean === "UP" || m.fundingLean === "DOWN" ? m.fundingLean : null,
      volumeUsd: num(m.volumeUsd) ?? 0,
      endDate: typeof m.endDate === "string" ? m.endDate : null,
    });
  }
  for (const c of Object.keys(byCoin)) {
    byCoin[c] = byCoin[c].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, FORECAST_HIST_PER_COIN);
  }
  return byCoin;
}

/** Append one hour's rows to a coin's series: skipped if the last row is < 55 min old; capped. Pure. */
export function appendForecastHist(hist, rows, now) {
  const h = Array.isArray(hist) ? hist : [];
  const last = h[h.length - 1];
  if (!rows.length || (last && now - last.t < HOURLY_GUARD_MS)) return null;
  const out = h.concat(rows);
  if (out.length > FORECAST_HIST_MAX_ROWS) out.splice(0, out.length - FORECAST_HIST_MAX_ROWS);
  return out;
}

/**
 * The hourly job. `readBoard()` returns /intel/forecasts' JSON (or null). Writes only forecast:hist:{COIN}.
 * @returns {Promise<{coins: number, rows: number}>}
 */
export async function snapshotForecasts(kv, readBoard, now = Date.now()) {
  const board = await readBoard();
  if (!board || !Array.isArray(board.markets)) return { coins: 0, rows: 0 };
  const t = num(board.asOfMs) ?? now; // the board's own read time
  const byCoin = forecastHistRows(board, t);
  let coins = 0, rows = 0;
  for (const [coin, r] of Object.entries(byCoin)) {
    try {
      const key = FORECAST_HIST_PREFIX + coin;
      const raw = await kv.get(key);
      const next = appendForecastHist(raw ? JSON.parse(raw) : [], r, now);
      if (!next) continue;
      await kv.put(key, JSON.stringify(next));
      coins++; rows += r.length;
    } catch { /* per-coin best-effort */ }
  }
  return { coins, rows };
}
