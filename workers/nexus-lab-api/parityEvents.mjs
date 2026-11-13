// ── The graded events a paper config's parity is checked against ────────────────────────────────────
// One copy for GET /agent/:a/parity and the 30-trade judge (paperJudge.mjs): the same KV series the scoreboard
// reads, the same axis generator (axisbt AXES), per coin in the config. Read-only.
import { AXES, priceByHour } from "./axisbt.mjs";

const coinOf = (s) => String(s).toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/** @returns {Promise<Array<{coin:string, t:number, side:string}>>} */
export async function parityEvents(kv, config, axis) {
  const gen = AXES.find((a) => a.name === axis)?.gen;
  if (!gen) return [];
  const readJson = async (key) => { try { const r = await kv.get(key); return r ? JSON.parse(r) : []; } catch { return []; } };
  const coins = [...new Set((config?.symbols || []).map(coinOf))];
  const events = [];
  for (const coin of coins) {
    const [oiHist, basisHist, cvdHist, smHist, liqHist, candleHist] = await Promise.all([
      readJson(`oi:hist:PERP_${coin}_USDC`),
      axis === "level_reclaim" || axis === "oi_div_reversal_4h" ? [] : readJson(`basis:hist:${coin}`), // oi_div reads oi:hist only
      axis === "basis_x_cvd" ? readJson(`cvd:hist:${coin}`) : [],
      axis === "basis_x_smart" ? readJson(`sm:hist:${coin}`) : [],
      axis === "basis_x_liqflush" ? readJson(`liq:hist:${coin}`) : [],
      axis === "level_reclaim" ? readJson(`candle:hist:PERP_${coin}_USDC`) : [],
    ]);
    const cs = { coin, oiHist, basisHist, cvdHist, smHist, liqHist, candleHist };
    for (const e of gen(cs, priceByHour(oiHist), {}) || []) events.push({ coin, t: e.t, side: e.side });
  }
  return events;
}
