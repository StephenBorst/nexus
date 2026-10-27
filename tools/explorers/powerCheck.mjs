// COUNT-ONLY power check for the explorer reads (docs/research/read-pipeline.md: "Event counts may be
// looked at before registering. Outcomes may not."). For each read it counts how often the rule
// would have fired over the last N days, per coin, and how many of those land on an hour the
// scoreboard can grade (an oi:hist price at that hour — the grader's price spine). It never reads a
// price AFTER an event and never computes a return, a hit rate or an R.
//
// Usage: node tools/explorers/powerCheck.mjs <dir> [days=60] [--batch=b]
//   --batch=b counts the UNREGISTERED batch-2 drafts (explorerDraftsB.mjs) instead of the registered reads.
//   <dir> holds oi_<COIN>.json ({points}) and c_<COIN>.json ({candles}) from the public routes
//   /agent/oi-history/PERP_<COIN>_USDC and /agent/candle-history/PERP_<COIN>_USDC.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXPLORER_GENS } from "../../workers/nexus-lab-api/explorerReads.mjs";
import { DRAFT_GENS_B } from "../../workers/nexus-lab-api/explorerDraftsB.mjs";
import { hourBucket } from "../../app/lib/basisStack.mjs";
import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";

const MAIN = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "SUI", "WLD"];
// The reads to count. A new explorer is counted here BEFORE it is registered (add its generator
// to a list like this one; never to the scoreboard's AXES until its registration is signed).
const READS = { ...EXPLORER_GENS };

export function powerCheck(sets, { days = 60, now = Date.now(), reads = READS } = {}) {
  const from = now - days * 86400000;
  const out = {};
  for (const [name, gen] of Object.entries(reads)) {
    const per = {};
    for (const cs of sets) {
      const oiHours = new Set((cs.oiHist || []).map((p) => hourBucket(p.t)));
      const evs = (gen(cs, null, {}) || []).filter((e) => e.t >= from && e.t <= now);
      // the span this coin's inputs actually cover inside the window, in days (for a per-coin-day rate)
      const ts = [...(cs.candleHist || []), ...(cs.oiHist || [])].map((x) => Number(x.t)).filter((t) => t >= from && t <= now);
      per[cs.coin] = {
        events: evs.length,
        gradeable: evs.filter((e) => oiHours.has(hourBucket(e.t))).length,
        longs: evs.filter((e) => e.side === "LONG").length,
      };
      if (ts.length) per[cs.coin].coveredDays = Math.round((Math.max(...ts) - Math.min(...ts)) / 864e5);
    }
    out[name] = per;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const batchB = process.argv.includes("--batch=b");
  const dir = args[0];
  const days = Number(args[1] || 60);
  const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
  const coins = [...new Set([...MAIN, ...RECORDED_COINS, ...HOLDOUT_COINS])];
  const sets = coins.map((coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") }));
  const now = Math.max(...sets.flatMap((s) => s.candleHist.map((c) => Number(c.t) + 3600000)));
  const res = powerCheck(sets, { days, now, reads: batchB ? DRAFT_GENS_B : READS });
  const group = (names) => names.filter((c) => !HOLDOUT_COINS.includes(c)); // SUI is holdout-only now
  for (const [name, per] of Object.entries(res)) {
    const sum = (cs, k) => cs.reduce((s, c) => s + (per[c]?.[k] || 0), 0);
    const main = group(MAIN), hold = [...HOLDOUT_COINS];
    const rateMain = main.length ? sum(main, "events") / main.length : 0; // per coin over the window
    console.log(`\n${name}`);
    console.log(`  main ${main.length} · fired ${sum(main, "events")} (longs ${sum(main, "longs")}) · gradeable today ${sum(main, "gradeable")} · avg ${rateMain.toFixed(1)}/coin/${days}d`);
    console.log(`  holdout ${hold.length} · fired ${sum(hold, "events")} over recorded history (holdout counts only from registration)`);
    console.log(`  per coin: ${main.map((c) => `${c} ${per[c].events}/${per[c].gradeable}`).join(" · ")}`);
  }
}
