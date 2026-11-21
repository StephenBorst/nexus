// trendStudy.mjs: the trend gate wired to the scoreboard. Run: node --test workers/nexus-lab-api/trendStudy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runTrendStudy, studyEventsFor, TREND_DOC } from "./trendStudy.mjs";
import { TREND_GATE_STUDY } from "./trendGate.mjs";
import { STRESS_STUDY } from "./stressHours.mjs";
import { runStressStudy } from "./stressStudy.mjs";

const H = 3600000;
const START = Date.parse(TREND_GATE_STUDY.from);
const btc = Array.from({ length: 24 * 40 }, (_, i) => { const c = 100 + i * 0.05; return { t: START - 20 * 24 * H + i * H, o: c, h: c + 0.1, l: c - 0.1, c, v: 1 }; });
const REG = Object.fromEntries(TREND_GATE_STUDY.reads.map((n) => [n, "2026-10-17T00:00:00Z"]));
const empty = Object.fromEntries(TREND_GATE_STUDY.reads.map((n) => [n, { main: [], holdout: [] }]));

test("served shape: every study read present, ISO times, nothing judged on an empty board", () => {
  const ev = { ...empty, level_reclaim: { main: [{ t: START + 30 * H, side: "LONG", r: 1 }, { t: START + 40 * H, side: "SHORT", r: null }], holdout: [] } };
  const out = runTrendStudy({ btcCandles: btc, events: ev, registeredAt: REG, now: START + 48 * H });
  assert.equal(out.name, "trend_gate");
  assert.equal(out.doc, TREND_DOC);
  assert.equal(out.from, TREND_GATE_STUDY.from);
  assert.equal(out.limit, TREND_GATE_STUDY.limit);
  assert.deepEqual(Object.keys(out.reads).sort(), [...TREND_GATE_STUDY.reads].sort());
  const lr = out.reads.level_reclaim;
  assert.equal(lr.status, "ACCRUING");
  assert.equal(lr.counts.WITH, 1, "BTC trending up: a long is WITH");
  assert.equal(lr.counts.pending, 1);
  assert.equal(Date.parse(lr.from), Date.parse(TREND_GATE_STUDY.from), "out-of-sample from the study start (after the read's registration)");
  assert.equal(lr.verdict, null);
  for (const r of Object.values(out.reads)) assert.equal(r.licensesBlock ?? false, false);
  assert.match(out.note, /Measurement only/);
  assert.match(out.note, /never trading against the trend/);
});

test("refuses rather than serving a blank study: no BTC tape, or a read's events missing", () => {
  assert.throws(() => runTrendStudy({ btcCandles: [], events: empty, registeredAt: REG }), /BTC tape unread/);
  const { smart_consensus_2x, ...rest } = empty;
  assert.throws(() => runTrendStudy({ btcCandles: btc, events: rest, registeredAt: REG }), /events missing for smart_consensus_2x/);
  assert.throws(() => studyEventsFor(["not_a_read"], { mainSets: [], holdoutSets: [] }), /not on the scoreboard/);
});

test("the stress study takes the shared events unchanged (only t and r) and refuses a missing read", () => {
  const ev = Object.fromEntries(STRESS_STUDY.reads.map((n) => [n, { main: [{ t: START, coin: "ETH", side: "LONG", r: 0.5 }], holdout: [] }]));
  const out = runStressStudy({ panelSets: [], mainSets: [], holdoutSets: [], now: START, events: ev });
  assert.deepEqual(Object.keys(out.reads).sort(), [...STRESS_STUDY.reads].sort());
  const { level_reclaim, ...rest } = ev;
  assert.throws(() => runStressStudy({ panelSets: [], mainSets: [], holdoutSets: [], now: START, events: rest }), /events missing for level_reclaim/);
});

test("index.js builds the study events once for both studies and serves trendGate; the cache key moved", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.equal((src.match(/studyEventsFor\(/g) || []).length, 1, "one build of the events per rebuild");
  assert.match(src, /\[\.\.\.new Set\(\[\.\.\.STRESS_STUDY\.reads, \.\.\.TREND_GATE_STUDY\.reads\]\)\]/);
  assert.match(src, /runStressStudy\(\{[\s\S]{0,300}events: studyEv,/);
  assert.match(src, /runTrendStudy\(\{[\s\S]{0,300}events: studyEv,/);
  assert.match(src, / {4}stressStudy,\n {4}trendGate,\n/);
  assert.match(src, /const axisbtCacheKey = \(min\) => `axisbt:v3[0-9]:min\$\{min\}`;/, "moved to v30 or later");
});
