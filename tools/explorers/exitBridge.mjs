// READ-ONLY bridge from a registered read's R grade to its graded exit as traded
// (docs/research/level-reclaim-exit-gap.md, signed 2026-10-31). It walks one change at a time on
// the SAME trades: which events (H4) → R to bps weighting (H2) → untouched trades closed at the
// market (H3) → anything else (S3b, expected 0) → fees (H1). Every step is in bps; an R value is
// put on the bps scale by T's mean stop width, so the steps add up exactly.
//
// It imports the deployed grader (scoreEvents, tradeableExitTrades, gradeEventR, GRADED_EXIT_SPEC)
// and copies none of it. It changes nothing served, writes nothing, and places no order.
//
// Usage: node tools/explorers/exitBridge.mjs <dir> [--axis=level_reclaim] [--fetch]
//   <dir> holds oi_<COIN>.json ({points}) and c_<COIN>.json ({candles}) from the public routes
//   /agent/oi-history/PERP_<COIN>_USDC and /agent/candle-history/PERP_<COIN>_USDC, and optionally
//   axisbt.json (GET /intel/axis-backtest) to reconcile against what the scoreboard serves.
//   --fetch downloads all of them into <dir> first (set NODE_USE_ENV_PROXY=1 in cloud sessions).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  AXES, scoreEvents, tradeableExitTrades, gradeEventR, GRADED_EXIT_SPEC,
  candlesByHour, priceSeries, btcRegimeByHour,
} from "../../workers/nexus-lab-api/axisbt.mjs";
import { DEFAULT_FEE_BPS } from "../../workers/nexus-lab-api/backtest.mjs";
import { priceByHour, hourBucket } from "../../app/lib/basisStack.mjs";
import { fundingByHour } from "../../app/lib/funding.mjs";
import { registrationFor, registeredMs, PIPELINE_RULES } from "../../app/lib/readPipeline.mjs";
import { HOLDOUT_COINS, isHoldoutCoin } from "../../app/lib/recordedUniverse.mjs";

// The scoreboard's main card (index.js /intel/axis-backtest); its out-of-sample grade leaves the
// holdout coins out (`oosExclude`), so SUI is dropped here the same way.
export const MAIN_COINS = Object.freeze(["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "SUI", "WLD"].filter((c) => !isHoldoutCoin(c)));
export const FEE_PER_TRADE_BPS = DEFAULT_FEE_BPS * 2; // round trip, the graded exit's own fee

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

/** The gen's out-of-sample events, built the way scoreEvents builds them (same maps, same ctx). */
export function oosEvents(coinSets, gen, fromMs) {
  const btcCs = (coinSets || []).find((c) => String(c.coin || "").toUpperCase() === "BTC");
  const btcSeries = btcCs ? priceSeries(btcCs) : [];
  const ctx = btcCs ? { btcMap: btcRegimeByHour(btcSeries), btcPrice: priceByHour(btcSeries), btcCandles: candlesByHour(btcCs.candleHist) } : {};
  const out = [];
  for (const cs of coinSets || []) {
    const pmap = priceByHour(cs.oiHist);
    if (pmap.size < 2) continue;
    const cbh = candlesByHour(cs.candleHist), fmap = fundingByHour(cs.oiHist);
    for (const e of gen(cs, pmap, ctx) || []) {
      if (!e || (e.side !== "LONG" && e.side !== "SHORT") || !(e.t >= fromMs)) continue;
      out.push({ t: e.t, side: e.side, coin: cs.coin, pmap, cbh, fmap });
    }
  }
  return out;
}

/**
 * Per-trade rows for T (the exact trades the graded-exit line counts) + the R of every event.
 * Each T row carries its own R-grade outcome on the same entry, so the two grades can be bridged.
 */
export function bridgeRows(events) {
  const eventR = [];
  for (const e of events) {
    const h = hourBucket(e.t);
    const r = gradeEventR(e.cbh, h, e.side, e.pmap.get(h));
    if (r != null) eventR.push({ side: e.side, r });
  }
  const trades = [];
  const byCoin = new Map();
  for (const e of events) { if (!byCoin.has(e.coin)) byCoin.set(e.coin, []); byCoin.get(e.coin).push(e); }
  for (const [coin, evs] of byCoin) {
    // Per coin: tradeableExitTrades groups by market anyway, so this is the same set it returns
    // pooled, with the coin kept on each row.
    for (const g of tradeableExitTrades(evs, GRADED_EXIT_SPEC, GRADED_EXIT_SPEC.maxHoldHours)) {
      const e = evs.find((x) => x.t === g.t && x.side === g.side);
      const h = hourBucket(g.t);
      const r = e ? gradeEventR(e.cbh, h, e.side, e.pmap.get(h)) : null;
      const stopBps = Number(g.slPercent) * 100;
      const grossBps = Number(g.pnlPct) * 100;
      trades.push({
        coin, t: g.t, side: g.side, reason: g.reason, holdH: g.holdH, stopBps, r, grossBps,
        netBps: grossBps - FEE_PER_TRADE_BPS, fundingBps: g.fundingBps ?? null,
      });
    }
  }
  trades.sort((a, b) => a.t - b.t);
  return { eventR, trades };
}

/**
 * The bridge S0 → S4 (bps). `eventR` = every out-of-sample event's R; `trades` = T.
 * Deltas are each step's change; they sum to S4 − S0. `alone` = H2/H3/H1 applied directly to S1.
 */
export function bridge(eventR, trades, { feeBps = FEE_PER_TRADE_BPS } = {}) {
  const n = trades.length;
  if (!n || !eventR.length) return { n, events: eventR.length, empty: true };
  const sBar = mean(trades.map((x) => x.stopBps));
  const R0 = mean(eventR.map((x) => x.r));
  const rOf = (x) => (x.r == null ? 0 : x.r); // a trade with no R grade: counted 0 here, its gap lands in S3b
  const R1 = mean(trades.map(rOf));
  const S0 = R0 * sBar, S1 = R1 * sBar;
  const S2 = mean(trades.map((x) => rOf(x) * x.stopBps));
  const untouched = (x) => x.r === 0;
  const S3a = mean(trades.map((x) => (untouched(x) ? x.grossBps : rOf(x) * x.stopBps)));
  const S3b = mean(trades.map((x) => x.grossBps));
  const S4 = S3b - feeBps;
  const steps = { H4: S1 - S0, H2: S2 - S1, H3: S3a - S2, S3b: S3b - S3a, H1: S4 - S3b };
  const alone = {
    H2: S2 - S1,
    H3: mean(trades.map((x) => (untouched(x) ? (x.grossBps / x.stopBps) * sBar : rOf(x) * sBar))) - S1,
    H1: -feeBps,
  };
  return {
    n, events: eventR.length, meanStopBps: sBar, R0, R1,
    S: { S0, S1, S2, S3a, S3b, S4 }, steps, alone, move: S4 - S0,
    rMissing: trades.filter((x) => x.r == null).length, untouched: trades.filter(untouched).length,
  };
}

/**
 * The page's cause rule, applied only at ≥ exitMinTrades (the first pull names nothing):
 * a step is a cause if |delta| ≥ |move|/3, same sign as the move, and it keeps that sign with the
 * single largest-|net bps| trade dropped. S3b is never a cause: a nonzero S3b is a measurement bug.
 */
export function causes(eventR, trades, b, { minTrades = PIPELINE_RULES.exitMinTrades } = {}) {
  if (b.empty || trades.length < minTrades) return { named: false, why: `${trades.length} trades < ${minTrades}: descriptive only` };
  let drop = 0;
  trades.forEach((x, i) => { if (Math.abs(x.netBps) > Math.abs(trades[drop].netBps)) drop = i; });
  const b2 = bridge(eventR, trades.filter((_, i) => i !== drop));
  const sign = Math.sign(b.move);
  const out = [];
  for (const k of ["H4", "H2", "H3", "H1"]) {
    const d = b.steps[k];
    if (Math.abs(d) >= Math.abs(b.move) / 3 && Math.sign(d) === sign && Math.sign(b2.steps[k]) === sign) out.push(k);
  }
  return { named: true, causes: out, droppedTrade: trades[drop] };
}

/** What the scoreboard's own code says for the same population (local reconciliation). */
export function servedEquivalent(coinSets, gen, fromMs) {
  const s = scoreEvents(coinSets, (cs, pmap, ctx) => (gen(cs, pmap, ctx) || []).filter((e) => e && e.t >= fromMs), { minSamples: 20, gradedExit: fromMs });
  return { events: s.r.samples, meanR: s.r.meanR, exitTrades: s.exitGraded?.samples ?? 0, exitNetBps: s.exitGraded?.netBps ?? null, exits: s.exitGraded?.exits, funding: s.exitGraded?.funding, horizons: s.horizons.map((h) => ({ h: h.h, samples: h.samples, meanBps: h.meanBps })) };
}

/** Side panels: exit mix, stop-width halves, hold, per side. Descriptive only. */
export function panels(trades) {
  const grp = (rows) => ({ n: rows.length, meanNetBps: r1(mean(rows.map((x) => x.netBps))) });
  const mix = Object.fromEntries(["TP", "SL", "TIMEOUT"].map((k) => [k, grp(trades.filter((x) => x.reason === k))]));
  const sorted = trades.slice().sort((a, b) => a.stopBps - b.stopBps);
  const half = (rows) => ({
    n: rows.length, meanStopBps: r1(mean(rows.map((x) => x.stopBps))), meanR: r3(mean(rows.map((x) => x.r ?? 0))),
    meanNetBps: r1(mean(rows.map((x) => x.netBps))), meanCostR: r3(mean(rows.map((x) => FEE_PER_TRADE_BPS / x.stopBps))),
  });
  const mid = Math.floor(sorted.length / 2);
  const holdOf = (rows) => ({ n: rows.length, avgHoldH: r1(mean(rows.map((x) => x.holdH))) });
  return {
    exits: mix,
    stopWidth: { narrow: half(sorted.slice(0, mid)), wide: half(sorted.slice(mid)) },
    hold: { winners: holdOf(trades.filter((x) => x.netBps > 0)), losers: holdOf(trades.filter((x) => x.netBps <= 0 && x.reason !== "TIMEOUT")), timeouts: holdOf(trades.filter((x) => x.reason === "TIMEOUT")) },
  };
}

/** Everything for one line (main card or holdout). */
export function runLine(coinSets, axis) {
  const reg = registrationFor(axis);
  const gen = AXES.find((a) => a.name === axis)?.gen;
  if (!reg || !gen) throw new Error(`${axis} is not a registered read with a scoreboard axis`);
  const fromMs = registeredMs(reg);
  const events = oosEvents(coinSets, gen, fromMs);
  const { eventR, trades } = bridgeRows(events);
  const b = bridge(eventR, trades);
  const bySide = Object.fromEntries(["LONG", "SHORT"].map((s) => [s, bridge(eventR.filter((x) => x.side === s), trades.filter((x) => x.side === s))]));
  const served = servedEquivalent(coinSets, gen, fromMs);
  const rec = b.empty ? null : { s4VsServedBps: r1(b.S.S4 - served.exitNetBps), tradesMatch: served.exitTrades === trades.length, eventsMatch: served.events === eventR.length };
  return { axis, since: reg.registeredAt, bridge: b, bySide, panels: panels(trades), causes: causes(eventR, trades, b), served, reconcile: rec, trades };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const API = "https://og.nexustradinglabs.com";
async function fetchAll(dir, coins) {
  mkdirSync(dir, { recursive: true });
  for (const coin of coins) {
    for (const [route, file] of [["oi-history", `oi_${coin}.json`], ["candle-history", `c_${coin}.json`]]) {
      const res = await fetch(`${API}/agent/${route}/PERP_${coin}_USDC`);
      if (!res.ok) throw new Error(`${route} ${coin}: HTTP ${res.status}`);
      writeFileSync(join(dir, file), await res.text());
    }
  }
  const sc = await fetch(`${API}/intel/axis-backtest`);
  if (sc.ok) writeFileSync(join(dir, "axisbt.json"), await sc.text());
}

function printLine(label, L) {
  const b = L.bridge, f = (x) => (x == null ? "—" : r1(x).toFixed(1));
  console.log(`\n── ${label} · ${L.axis} · out of sample from ${L.since}`);
  if (b.empty) { console.log(`  no trades or no events yet (${b.events} events, ${b.n} trades)`); return; }
  console.log(`  events ${b.events} · mean R ${r3(b.R0)} | T = ${b.n} trades · mean R ${r3(b.R1)} · mean stop ${f(b.meanStopBps)} bps`);
  console.log(`  S0 ${f(b.S.S0)}  →H4 ${f(b.steps.H4)}  S1 ${f(b.S.S1)}  →H2 ${f(b.steps.H2)}  S2 ${f(b.S.S2)}  →H3 ${f(b.steps.H3)}  S3a ${f(b.S.S3a)}  →S3b ${f(b.steps.S3b)}  S3b ${f(b.S.S3b)}  →H1 ${f(b.steps.H1)}  S4 ${f(b.S.S4)} bps`);
  console.log(`  move S0→S4 ${f(b.move)} bps · alone on S1: H2 ${f(b.alone.H2)} · H3 ${f(b.alone.H3)} · H1 ${f(b.alone.H1)} · untouched ${b.untouched} · no R grade ${b.rMissing}`);
  for (const s of ["LONG", "SHORT"]) {
    const x = L.bySide[s];
    console.log(x.empty ? `  ${s}: ${x.events} events, ${x.n} trades` : `  ${s}: T ${x.n} · S0 ${f(x.S.S0)} · H4 ${f(x.steps.H4)} · H2 ${f(x.steps.H2)} · H3 ${f(x.steps.H3)} · S3b ${f(x.steps.S3b)} · S4 ${f(x.S.S4)}`);
  }
  const p = L.panels;
  console.log(`  exits: ${["TP", "SL", "TIMEOUT"].map((k) => `${k} ${p.exits[k].n} (${f(p.exits[k].meanNetBps)})`).join(" · ")}`);
  console.log(`  stop width: narrow ${JSON.stringify(p.stopWidth.narrow)} · wide ${JSON.stringify(p.stopWidth.wide)}`);
  console.log(`  hold h: winners ${p.hold.winners.avgHoldH} (n${p.hold.winners.n}) · losers ${p.hold.losers.avgHoldH} (n${p.hold.losers.n}) · timeouts ${p.hold.timeouts.avgHoldH} (n${p.hold.timeouts.n})`);
  console.log(`  decay (gross bps, out of sample): ${L.served.horizons.map((h) => `${h.h}h ${h.meanBps} (n${h.samples})`).join(" · ")} · as traded 168h ${f(b.S.S3b)} gross`);
  const fu = L.served.funding;
  if (fu) console.log(`  funding (informational): ${fu.samples} covered · fees-net ${fu.feesNetBps} · fees+funding net ${fu.netBps} · cost ${fu.costBps} bps · missing ${fu.missing}`);
  console.log(`  reconcile (local scoreboard code): S4 − netBps ${L.reconcile.s4VsServedBps} bps · trades ${L.reconcile.tradesMatch ? "match" : "DIFFER"} · events ${L.reconcile.eventsMatch ? "match" : "DIFFER"}`);
  console.log(`  causes: ${L.causes.named ? (L.causes.causes.length ? L.causes.causes.join(", ") : "no single cause at this n") : L.causes.why}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const axis = (args.find((a) => a.startsWith("--axis=")) || "--axis=level_reclaim").slice(7);
  if (!dir) { console.error("usage: node tools/explorers/exitBridge.mjs <dir> [--axis=level_reclaim] [--fetch]"); process.exit(2); }
  if (args.includes("--fetch")) await fetchAll(dir, [...MAIN_COINS, ...HOLDOUT_COINS]);
  const load = (f, k) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8"))[k] || [] : []);
  const set = (coin) => ({ coin, oiHist: load(`oi_${coin}.json`, "points"), candleHist: load(`c_${coin}.json`, "candles") });
  const main = runLine(MAIN_COINS.map(set), axis);
  const hold = runLine(HOLDOUT_COINS.map(set), axis);
  printLine("main card", main);
  printLine("holdout", hold);
  const scPath = join(dir, "axisbt.json");
  if (existsSync(scPath)) {
    const sc = JSON.parse(readFileSync(scPath, "utf8"));
    const nums = sc.pipeline?.reads?.find((r) => r.axis === axis)?.numbers;
    if (nums) {
      const ok = !main.bridge.empty && Math.abs(main.bridge.S.S4 - nums.exitNetBps) <= 1 && nums.exitTrades === main.bridge.n;
      console.log(`\nserved (${sc.asOf}): ${nums.events} events · ${nums.meanR}R · exit ${nums.exitTrades} trades · ${nums.exitNetBps} bps → ${ok ? "RECONCILES (≤1 bps)" : "DOES NOT RECONCILE: a measurement issue, stop here (the page's rule)"}`);
    }
  }
}
