// ── The v2 badge check: 300 matched random replays of a judged paper run (docs/research/badge-bar-v2.md, signed) ─────
// Run ONCE, when a 30-trade PASS is recorded (paperJudge.mjs runPaperJudge), and stored with the verdict.
//   1. Replays: mulberry32(20261120), 300 of them; in each, the judged trades in trade-number order are redrawn: same
//      coin, same side, an entry hour uniform over the hours from the paper record's start to the 30th trade's exit.
//   2. Each replay trade walks the SAME graded exit (stop 1.2× H4 ATR-14, target 1.5×, 168h) on candle:hist with the
//      scoreboard's fill rules (backtest.mjs exitLevelsAt / openPosition / stepExit), enters at the drawn hour's close,
//      pays 2.5 bps taker each side, no funding (the judged side drops its funding for this comparison too).
//   3. A replay trade with no exit inside the recorded tape (or no ATR to size its stop) is drawn again, at most 10
//      times; then that replay is left out. < 250 usable replays = UNREAD.
// Pure (candles in, numbers out), deterministic: a re-run from the stored inputs gives the same answer.
import { mulberry32, exitLevelsAt, openPosition, stepExit, closedPnlPct } from "./backtest.mjs";
import { LEVEL_RECLAIM_PAPER_CONFIG } from "../../app/lib/levelReclaim.mjs";
import { BADGE_BAR, randomVerdict } from "../../app/lib/badgeBar.mjs";

const H = 3600_000;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/** candle:hist rows (t in ms) → the backtest's bars (t in seconds), one per hour, ascending. */
export function barsFromCandleHist(rows) {
  const byHour = new Map();
  for (const c of rows || []) {
    const t = Number(c?.t), o = Number(c?.o), h = Number(c?.h), l = Number(c?.l), cl = Number(c?.c);
    if (![t, h, l, cl].every(Number.isFinite) || !(cl > 0)) continue;
    const hour = Math.floor(t / H) * H;
    byHour.set(hour, { t: hour / 1000, o: Number.isFinite(o) && o > 0 ? o : cl, h, l, c: cl });
  }
  return [...byHour.values()].sort((a, b) => a.t - b.t);
}

/** One replay trade from bar i, or null (no ATR, or no exit before the tape ends). Net in bps, fees taken. */
export function replayTrade(bars, i, side, config = LEVEL_RECLAIM_PAPER_CONFIG, feeBps = BADGE_BAR.feeBps) {
  const c = bars[i];
  if (!c) return null;
  const { skip, lvl } = exitLevelsAt(bars, i, config);
  if (skip) return null;
  const pos = openPosition(config, side, c.c, c.t, lvl);
  for (let k = i + 1; k < bars.length; k++) {
    const hit = stepExit(pos, bars[k], (bars[k].t - c.t) * 1000, config);
    if (hit) {
      const pnlPct = closedPnlPct(pos, hit.px);
      const ratio = side === "LONG" ? 1 + pnlPct / 100 : 1 - pnlPct / 100; // exit ÷ entry
      return pnlPct * 100 - feeBps * (1 + ratio);
    }
  }
  return null;
}

/**
 * @param {{ trades: Array<{n:number, symbol:string, side:"LONG"|"SHORT", exactPriceNetBps:number}>,
 *   candlesByCoin: Record<string, object[]>, since: number, until: number, config?: object, bar?: object }} input
 *   since = the paper record's start (ms), until = the 30th trade's exit (ms)
 * @returns the stored check: { verdict, pctBeaten, usable, judgedMeanBps, means, seed, runs, window, ... }
 */
export function randomEntryCheck({ trades, candlesByCoin, since, until, config = LEVEL_RECLAIM_PAPER_CONFIG, bar = BADGE_BAR }) {
  const judged = [...(trades || [])].sort((a, b) => a.n - b.n);
  const judgedMean = judged.reduce((a, t) => a + Number(t.exactPriceNetBps), 0) / (judged.length || 1);
  const fromHour = Math.ceil(since / H) * H, toHour = Math.floor(until / H) * H;
  const hours = toHour >= fromHour ? Math.floor((toHour - fromHour) / H) + 1 : 0;
  const tapes = new Map();
  const tapeFor = (sym) => {
    const coin = bare(sym);
    if (!tapes.has(coin)) {
      const bars = barsFromCandleHist(candlesByCoin?.[coin]);
      tapes.set(coin, { bars, at: new Map(bars.map((b, i) => [b.t * 1000, i])) });
    }
    return tapes.get(coin);
  };
  const rnd = mulberry32(bar.seed);
  const means = [];
  let leftOut = 0;
  for (let r = 0; r < bar.runs; r++) {
    let sum = 0, ok = hours > 0 && judged.length > 0;
    for (const t of judged) {
      if (!ok) break; // a replay left out stops drawing; the sequence stays the same for the same inputs
      const tape = tapeFor(t.symbol);
      let net = null;
      for (let draw = 0; draw <= bar.maxRedraws && net == null; draw++) {
        const hour = fromHour + Math.floor(rnd() * hours) * H;
        const i = tape.at.get(hour);
        if (i != null) net = replayTrade(tape.bars, i, t.side, config, bar.feeBps);
      }
      if (net == null) ok = false; else sum += net;
    }
    if (ok) means.push(r4(sum / judged.length)); else { means.push(null); leftOut++; }
  }
  const usableMeans = means.filter((m) => m != null);
  const v = randomVerdict(r4(judgedMean), usableMeans, bar);
  return {
    v: 1, doc: bar.doc, seed: bar.seed, runs: bar.runs, beatPct: bar.beatPct, feeBps: bar.feeBps,
    window: { from: new Date(fromHour).toISOString(), to: new Date(toHour).toISOString(), hours },
    trades: judged.length, judgedMeanBps: r4(judgedMean), leftOut, means,
    verdict: v.verdict, pctBeaten: v.pctBeaten, usable: v.usable,
  };
}
