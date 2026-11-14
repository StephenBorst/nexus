// Smart Money consensus: which coins tracked traders actually agree on (moved out of SmartMoneyView 2026-11-14, so
// it is tested). borst: hide near splits. "ETH · 10 short · 8 long" was listed as consensus; it is close to a coin
// flip. A coin is listed only when its leading side has at least CONSENSUS_RATIO × the other side's traders; a
// near split is returned apart, so the card can name it in one quiet line instead of dropping it silently.

export const CONSENSUS_RATIO = 2;
export const CONSENSUS_MIN = 2; // traders on the leading side
export const CONSENSUS_LIMIT = 6;

/**
 * @param {{address:string, positions:{sym:string|null, tradeable:boolean, side:"LONG"|"SHORT", szUsd:number, entry:number}[]}[]} board
 * @returns {{ rows: {sym,side,count,against,netUsd,refPrice,tracked}[], splits: {sym,long,short}[] }}
 */
export function consensusFromBoard(board, { ratio = CONSENSUS_RATIO, min = CONSENSUS_MIN, limit = CONSENSUS_LIMIT } = {}) {
  const traders = Array.isArray(board) ? board : [];
  const map = new Map();
  for (const t of traders) {
    for (const p of t?.positions ?? []) {
      if (!p?.tradeable || !p.sym || (p.side !== "LONG" && p.side !== "SHORT")) continue;
      const key = `${p.sym}|${p.side}`;
      const e = map.get(key) || { sym: p.sym, side: p.side, traders: new Set(), netUsd: 0, refPrice: 0, maxSz: 0 };
      e.traders.add(t.address);
      const sz = Number(p.szUsd) || 0;
      e.netUsd += sz;
      if (sz > e.maxSz && p.entry > 0) { e.maxSz = sz; e.refPrice = p.entry; } // ref = the biggest holder's entry
      map.set(key, e);
    }
  }
  const syms = new Set([...map.values()].map((e) => e.sym));
  const rows = [], splits = [];
  for (const sym of syms) {
    const L = map.get(`${sym}|LONG`), S = map.get(`${sym}|SHORT`);
    const nL = L?.traders.size ?? 0, nS = S?.traders.size ?? 0;
    const lead = nL >= nS ? L : S;
    const n = Math.max(nL, nS), against = Math.min(nL, nS);
    if (n < min) continue;
    if (n >= ratio * against && n > against) {
      rows.push({ sym, side: lead.side, count: n, against, netUsd: lead.netUsd, refPrice: lead.refPrice, tracked: traders.length });
    } else {
      splits.push({ sym, long: nL, short: nS });
    }
  }
  rows.sort((a, b) => b.count - a.count || b.netUsd - a.netUsd);
  splits.sort((a, b) => (b.long + b.short) - (a.long + a.short));
  return { rows: rows.slice(0, limit), splits };
}
