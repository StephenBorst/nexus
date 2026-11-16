// COUNT-ONLY check for the trend-gate draft (docs/research/trend-gate-prereg.md): how many of each read's events would
// land WITH / AGAINST BTC's 4h trend over the last N days. Never reads a price after an event, never computes an R.
// Usage: node tools/explorers/trendGateCount.mjs <dir> [days=60]   (<dir> as powerCheck.mjs: oi_<COIN>.json, c_<COIN>.json)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXPLORER_GENS } from "../../workers/nexus-lab-api/explorerReads.mjs";
import { btcTrendByHour, labelCounts } from "../../workers/nexus-lab-api/trendGate.mjs";
import { btcCtx } from "./powerCheck.mjs";
import { RECORDED_COINS } from "../../app/lib/recordedUniverse.mjs";

const dir = process.argv[2], days = Number(process.argv[3] || 60);
const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
const coins = [...new Set(["BTC", ...RECORDED_COINS])];
const sets = coins.map((coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") }));
const now = Math.max(...sets.flatMap((s) => s.candleHist.map((c) => Number(c.t) + 3600000)));
const from = now - days * 86400000;
const trend = btcTrendByHour(sets.find((s) => s.coin === "BTC").candleHist);
const ctx = btcCtx(sets);
console.log(`main card ${RECORDED_COINS.length} coins, last ${days} days to ${new Date(now).toISOString()}`);
for (const [name, gen] of Object.entries(EXPLORER_GENS)) {
  const evs = sets.filter((s) => RECORDED_COINS.includes(s.coin)).flatMap((cs) => (gen(cs, null, ctx) || []).filter((e) => e.t >= from && e.t <= now));
  const c = labelCounts(evs, trend);
  console.log(`${name.padEnd(26)} events ${String(c.events).padStart(4)} · WITH ${String(c.WITH).padStart(4)} · AGAINST ${String(c.AGAINST).padStart(4)} · UNLABELLED ${c.UNLABELLED}`);
}
