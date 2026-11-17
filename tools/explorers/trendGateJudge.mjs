// Run the trend gate's judge (workers/nexus-lab-api/trendGrading.mjs, docs/research/trend-gate-prereg.md) on recorded
// series. Read-only: prints each study read's status, counts, d, p and verdict; writes nothing, records nothing.
// A verdict is recorded under the page's Results by its own PR; a block is borst's reviewed PR.
// Usage: node tools/explorers/trendGateJudge.mjs <dir> [at=ISO]   (<dir> as powerCheck.mjs: oi_<COIN>.json, c_<COIN>.json)
// Reads that need a series not in <dir> (basis, smart money, spot CVD) show no events here; the scoreboard has them.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AXES, eventsWithR } from "../../workers/nexus-lab-api/axisbt.mjs";
import { btcTrendByHour, TREND_GATE_STUDY } from "../../workers/nexus-lab-api/trendGate.mjs";
import { judgeTrendGate } from "../../workers/nexus-lab-api/trendGrading.mjs";
import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node tools/explorers/trendGateJudge.mjs <dir> [at=ISO]"); process.exit(2); }
const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
const set = (coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") });
const main = RECORDED_COINS.map(set), holdout = HOLDOUT_COINS.map(set);
const btc = main.find((s) => s.coin === "BTC") || set("BTC");
const lastBar = Math.max(...[...main, ...holdout].flatMap((s) => s.candleHist.map((c) => Number(c.t) + 3600000)));
const at = process.argv[3] ? Date.parse(process.argv[3]) : lastBar;

const events = {};
for (const name of TREND_GATE_STUDY.reads) {
  const gen = AXES.find((a) => a.name === name)?.gen;
  if (!gen) throw new Error(`${name} is not on the scoreboard`);
  events[name] = { main: eventsWithR(main, gen), holdout: eventsWithR(holdout, gen) };
}
const registeredAt = Object.fromEntries(REGISTERED_READS.map((r) => [r.axis, r.registeredAt]));
const j = judgeTrendGate({ trendByHour: btcTrendByHour(btc.candleHist), events, registeredAt, at });

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
console.log(`trend gate · judged at ${new Date(at).toISOString()} · family complete: ${j.familyComplete}`);
for (const [name, r] of Object.entries(j.reads)) {
  const c = r.counts || {};
  console.log(`${name.padEnd(22)} ${String(r.status).padEnd(18)} WITH ${String(c.WITH ?? 0).padStart(3)} · AGAINST ${String(c.AGAINST ?? 0).padStart(3)} · pending ${c.pending ?? 0}`
    + (r.status === "JUDGED" ? ` · d ${f(r.d)}R (with ${f(r.meanWith)} / against ${f(r.meanAgainst)}) · p ${f(r.p)} · ${r.verdict ?? r.pending}` : r.verdict ? ` · ${r.verdict}` : ""));
}
