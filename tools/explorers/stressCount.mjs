// COUNT-ONLY check for the registered stress-hour study (workers/nexus-lab-api/stressHours.mjs,
// docs/research/stress-hours-prereg.md). It counts stress hours, episodes, and how each registered
// read's events label (STRESS / CALM / UNJUDGED). It never reads a price after an event and never
// computes a return, a hit rate or an R: the judging code is its own PR.
//
// Usage: node tools/explorers/stressCount.mjs <dir> [days=60]
//   <dir> holds oi_<COIN>.json ({points}) and c_<COIN>.json ({candles}) from the public routes
//   /agent/oi-history/PERP_<COIN>_USDC and /agent/candle-history/PERP_<COIN>_USDC.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STRESS_RULE, STRESS_STUDY, stressPanel, stressHours, stressEpisodes, judgedHourSet, stressLabel } from "../../workers/nexus-lab-api/stressHours.mjs";
import { EXPLORER_GENS } from "../../workers/nexus-lab-api/explorerReads.mjs";
import { rsiResetDeepEvents } from "../../workers/nexus-lab-api/axisbt.mjs";
import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";

const MAIN = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "WLD"]; // main card (powerCheck.mjs, SUI is holdout-only)
export const STRESS_READS = Object.freeze(Object.fromEntries(
  STRESS_STUDY.reads.map((n) => [n, n === "rsi_reset_deep" ? rsiResetDeepEvents : EXPLORER_GENS[n]]),
));

/** Counts only: judged hours, stress hours, episodes, hours covered, and each read's events by label. */
export function stressCount(panelSets, readSets, { days = 60, now = Date.now(), reads = STRESS_READS } = {}) {
  const p = STRESS_RULE;
  const from = now - days * 86400000;
  const hours = stressHours(panelSets, p).filter((t) => t <= now);
  const judged = judgedHourSet(panelSets, p);
  const inWin = hours.filter((t) => t >= from);
  const judgedHours = stressPanel(panelSets, p).filter((r) => r.t >= from && r.t <= now && r.moveRank != null).length;
  const covered = new Set();
  for (const t of inWin) for (let k = 0; k < p.afterH; k++) covered.add(Math.floor(t / 3600000) + k); // by hour
  const perRead = {};
  for (const [name, gen] of Object.entries(reads)) {
    const row = { events: 0, STRESS: 0, CALM: 0, UNJUDGED: 0 };
    for (const cs of readSets) {
      for (const e of gen(cs, null, {}) || []) {
        if (e.t < from || e.t > now) continue;
        row.events++;
        row[stressLabel(e.t, hours, judged, p)]++;
      }
    }
    perRead[name] = row;
  }
  return { judgedHours, stressHours: inWin.length, episodes: stressEpisodes(inWin, p).length, hoursCovered: covered.size, perRead };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, daysArg] = process.argv.slice(2);
  const days = Number(daysArg || 60);
  const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
  const set = (coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") });
  const panelSets = RECORDED_COINS.map(set);
  const readSets = MAIN.filter((c) => !HOLDOUT_COINS.includes(c)).map(set);
  const now = Math.max(...panelSets.flatMap((s) => s.candleHist.map((c) => Number(c.t) + 3600000)));
  const r = stressCount(panelSets, readSets, { days, now });
  console.log(`window: last ${days} days to ${new Date(now).toISOString()} · panel ${RECORDED_COINS.join(" ")}`);
  console.log(`${r.stressHours} stress hours in ${r.episodes} episodes · ${r.hoursCovered} hours inside a 24h window (of ${r.judgedHours} judged)`);
  for (const [n, v] of Object.entries(r.perRead)) console.log(`  ${n}: ${v.events} events · STRESS ${v.STRESS} · CALM ${v.CALM} · UNJUDGED ${v.UNJUDGED}`);
}
