// COUNT-ONLY check for the stress-hour draft (workers/nexus-lab-api/stressDraft.mjs,
// docs/research/stress-hours-draft.md). It counts how often the market was in stress and how many of
// each registered read's events landed in the 24h after a stress hour. It never reads a price after an
// event and never computes a return, a hit rate or an R.
//
// Usage: node tools/explorers/stressCount.mjs <dir> [days=60]
//   <dir> holds oi_<COIN>.json ({points}) and c_<COIN>.json ({candles}) from the public routes
//   /agent/oi-history/PERP_<COIN>_USDC and /agent/candle-history/PERP_<COIN>_USDC.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STRESS_DRAFT, stressPanel, stressHours, deleverHours, shockHours, stressEpisodes, inStress } from "../../workers/nexus-lab-api/stressDraft.mjs";
import { EXPLORER_GENS } from "../../workers/nexus-lab-api/explorerReads.mjs";
import { rsiResetDeepEvents } from "../../workers/nexus-lab-api/axisbt.mjs";
import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";

const MAIN = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "WLD"]; // main card (powerCheck.mjs, SUI is holdout-only)
export const STRESS_READS = Object.freeze({ rsi_reset_deep: rsiResetDeepEvents, ...EXPLORER_GENS });

// The variants counted for review. "proposed" is the draft; the rest show how the count moves.
export const VARIANTS = Object.freeze({
  proposed: { rule: "both" },
  "oi -3%": { rule: "both", oiDrop: 0.03 },
  "move p95": { rule: "both", movePct: 0.95 },
  "breadth 7/9": { rule: "both", breadth: 7 },
  "delever only": { rule: "delever" },
  "BTC shock 3x only": { rule: "shock" },
});

/** Counts only: judged hours, stress hours, episodes, hours covered, and read events in / out of stress. */
export function stressCount(panelSets, readSets, { days = 60, now = Date.now(), variant = {}, reads = STRESS_READS } = {}) {
  const p = { ...STRESS_DRAFT, ...variant };
  const from = now - days * 86400000;
  const btc = panelSets.find((s) => s.coin === "BTC");
  const all = variant.rule === "delever" ? deleverHours(panelSets, p)
    : variant.rule === "shock" ? shockHours(btc?.candleHist || [], p)
      : stressHours(panelSets, p);
  const hours = all.filter((t) => t <= now);
  const inWin = hours.filter((t) => t >= from);
  const judged = stressPanel(panelSets, p).filter((r) => r.t >= from && r.t <= now && (variant.rule === "delever" || r.moveRank != null)).length;
  const covered = new Set();
  for (const t of inWin) for (let k = 0; k < p.afterH; k++) covered.add(Math.floor(t / 3600000) + k); // by hour
  const perRead = {};
  for (const [name, gen] of Object.entries(reads)) {
    let events = 0, inS = 0;
    for (const cs of readSets) {
      for (const e of gen(cs, null, {}) || []) {
        if (e.t < from || e.t > now) continue;
        events++;
        if (inStress(e.t, hours, p)) inS++;
      }
    }
    perRead[name] = { events, inStress: inS };
  }
  return { judgedHours: judged, stressHours: inWin.length, episodes: stressEpisodes(inWin, p).length, hoursCovered: covered.size, perRead };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, daysArg] = process.argv.slice(2);
  const days = Number(daysArg || 60);
  const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
  const set = (coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") });
  const panelSets = RECORDED_COINS.map(set);
  const readSets = MAIN.filter((c) => !HOLDOUT_COINS.includes(c)).map(set);
  const now = Math.max(...panelSets.flatMap((s) => s.candleHist.map((c) => Number(c.t) + 3600000)));
  console.log(`window: last ${days} days to ${new Date(now).toISOString()} · panel ${RECORDED_COINS.join(" ")}`);
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const r = stressCount(panelSets, readSets, { days, now, variant });
    console.log(`\n${name}: ${r.stressHours} stress hours in ${r.episodes} episodes · ${r.hoursCovered} hours inside a 24h window (of ${r.judgedHours} judged)`);
    console.log("  " + Object.entries(r.perRead).map(([n, v]) => `${n} ${v.inStress}/${v.events}`).join(" · "));
  }
}
