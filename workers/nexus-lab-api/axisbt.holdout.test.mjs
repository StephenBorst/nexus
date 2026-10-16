// The holdout line (docs/research/holdout-universe-prereg.md): eight coins graded on their own,
// never pooled into the main card, /intel/evidence or the sold feed. Plus the recorder's budget
// with seventeen coins. Run: node --test workers/nexus-lab-api/axisbt.holdout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runScorecard, runHoldoutScorecard, withoutHoldoutFlow } from "./axisbt.mjs";
import { snapshotFlow, FLOW_BUDGET_MS } from "./flow.mjs";
import { BASIS_SIGNAL_COINS } from "./basisSignals.mjs";
import { HOLDOUT_COINS, HOLDOUT_AXES, FLOW_COINS, isHoldoutCoin } from "../../app/lib/recordedUniverse.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), "utf8");
const HR = 3600e3, T0 = Date.UTC(2026, 9, 1);

// A coin whose basis series fires basis_extreme events (a deep discount every 23h).
const coinSet = (coin, n = 400) => ({
  coin,
  oiHist: Array.from({ length: n }, (_, i) => ({ t: T0 + i * HR, price: 100 + Math.sin(i / 7) * 2 + i * 0.01, oi: 1, funding: 0 })),
  candleHist: Array.from({ length: n }, (_, i) => { const p = 100 + Math.sin(i / 7) * 2 + i * 0.01; return { t: T0 + i * HR, o: p, h: p * 1.004, l: p * 0.996, c: p, v: 1 }; }),
  basisHist: Array.from({ length: n }, (_, i) => ({ t: T0 + i * HR, basisPct: i % 23 === 0 ? -0.6 : -0.05 + (i % 5) * 0.002 })),
  cvdHist: Array.from({ length: n }, (_, i) => ({ t: T0 + i * HR, cvd: (i % 2 ? 1 : -1) * 10, buy: 10, sell: 10 })),
  smHist: [], liqHist: [],
});
const events = (sc, axis) => { const a = sc.axes.find((x) => x.name === axis); return a.sides.LONG.events + a.sides.SHORT.events; };
const CFG = { horizons: [4, 12, 24], minSamples: 5 };

test("main card: a holdout coin's basis + CVD never reach it; its other series stay", () => {
  const sui = coinSet("SUI"), btc = coinSet("BTC");
  const [b, s] = withoutHoldoutFlow([btc, sui], isHoldoutCoin);
  assert.equal(b, btc, "a recorded coin passes through untouched");
  assert.deepEqual(s.basisHist, []);
  assert.deepEqual(s.cvdHist, []);
  assert.equal(s.oiHist, sui.oiHist);
  assert.equal(s.candleHist, sui.candleHist);
  // pooled, SUI would add its basis events; stripped, the card counts BTC's alone
  const alone = events(runScorecard([btc], CFG), "basis_extreme");
  assert.ok(alone > 0);
  assert.equal(events(runScorecard(withoutHoldoutFlow([btc, sui], isHoldoutCoin), CFG), "basis_extreme"), alone);
  assert.ok(events(runScorecard([btc, sui], CFG), "basis_extreme") > alone, "the guard is what keeps them apart");
});

test("holdout line: the holdout coins alone, the basis reads only, same grader", () => {
  const h = runHoldoutScorecard([coinSet("ZEC"), coinSet("NEAR")], { ...CFG, axes: [...HOLDOUT_AXES] });
  assert.deepEqual(h.coins, ["ZEC", "NEAR"]);
  assert.deepEqual(h.axes.map((a) => a.name).sort(), [...HOLDOUT_AXES].sort());
  assert.ok(events(h, "basis_extreme") > 0);
  // same grader: the holdout line's basis_extreme == the full card's on the same coins
  const full = runScorecard([coinSet("ZEC"), coinSet("NEAR")], CFG).axes.find((a) => a.name === "basis_extreme");
  const line = h.axes.find((a) => a.name === "basis_extreme");
  assert.deepEqual(line.sides, full.sides);
  assert.equal(line.verdict, full.verdict);
});

test("the route wires both: main card stripped, holdout loaded from HOLDOUT_COINS, evidence excludes them", () => {
  const s = src("index.js");
  assert.match(s, /withoutHoldoutFlow\(await loadSets\(COINS\), isHoldoutCoin\)/);
  assert.match(s, /const holdoutSets = await loadSets\(HOLDOUT_COINS\)/);
  // the holdout prereg's reads + pipeline reads registered with a holdout line (never other reads)
  assert.match(s, /axes: \[\.\.\.HOLDOUT_AXES, \.\.\.holdoutRegs\.map\(\(x\) => x\.axis\)\]/);
  assert.match(s, /"WLD"\]\.filter\(\(c\) => !isHoldoutCoin\(c\)\);\n\s+const symbols = COINS/);
  assert.match(s, /snapshotFlow\(env, \[\.\.\.FLOW_COINS\]\)/);
});

test("never sold: the staged basis feed leaves every holdout coin out", () => {
  for (const c of HOLDOUT_COINS) assert.ok(!BASIS_SIGNAL_COINS.includes(c), c);
  assert.ok(BASIS_SIGNAL_COINS.includes("BTC"));
});

test("the brain records price/OI + candles for the holdout, and nothing in its signal path reads the list", () => {
  const b = readFileSync(join(HERE, "..", "nexus-agent-brain", "index.js"), "utf8");
  assert.match(b, /await recordOiForSymbols\(HOLDOUT_PERPS, env\);/);
  assert.match(b, /recordCandlesForSymbols\(\[\.\.\.HARNESS_SYMBOLS, \.\.\.HOLDOUT_PERPS/);
  assert.equal((b.match(/HOLDOUT_PERPS/g) || []).length, 3, "the import + the two recorders, nothing else");
});

// 1s per call, every call counted one after another (the two tickers really go out together):
// a pessimistic pass. The nine took ~1 call-second each before; real OKX latency is a few hundred ms.
test("seventeen coins fit the recorder's budget, even at 1s per OKX call", async () => {
  let clock = Date.UTC(2026, 9, 16, 2, 17);
  const store = new Map();
  const env = { NEXUS_AGENT: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  const resp = (body) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url) => {
    clock += 1000;
    if (url.includes("/market/trades")) return resp({ code: "0", data: [{ ts: String(clock - 1000), side: "buy", sz: "1", px: "1" }] });
    return resp({ code: "0", data: [{ last: url.includes("-SWAP") ? "99.95" : "100" }] });
  };
  const logs = [];
  const started = clock;
  const n = await snapshotFlow(env, [...FLOW_COINS], {
    fetchImpl, sleep: async (ms) => { clock += ms; }, random: () => 0, clock: () => clock,
    log: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
  });
  assert.equal(FLOW_COINS.length, 17);
  assert.equal(n, 17);
  assert.match(logs[0], /basis 17\/17 · cvd 17\/17/);
  assert.ok(clock - started < FLOW_BUDGET_MS * 0.6, `pass took ${(clock - started) / 1000}s of ${FLOW_BUDGET_MS / 1000}s`);
  for (const c of HOLDOUT_COINS) assert.ok(store.has(`basis:hist:${c}`) && store.has(`cvd:hist:${c}`), c);
});
