// Forecast Divergence's plain read (app/lib/forecastRead.mjs). Run: node --test app/lib/forecastRead.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forecastRead, forecastChip, CLOSE_STRIKE_PCT } from "./forecastRead.mjs";

// The 2026-11-22 screenshot: 12% that BTC reaches $70,000 (+14.4%) by Nov 30, funding positive.
const btc = { coin: "BTC", yesPct: 12, target: 70000, targetDirection: "UP", distancePct: 14.42, fundingLean: "UP", ends: "Nov 30",
  history: { pct: 9.3, days: 7, kind: "touch", lookbackDays: 365, windows: 358 }, crowdGapPts: 2.7, forecastLean: null, divergence: false };

test("the screenshot case reads as distance, not a bearish crowd", () => {
  const r = forecastRead(btc);
  assert.equal(r.read, "Forecasters give 12% that BTC reaches $70,000 by Nov 30. In BTC’s last 365 days, a 14.4% rise within 7 days happened from 9% of start days. The crowd’s odds are close to BTC’s own history. Funding leans up: longs are paying to hold.");
  assert.doesNotMatch(r.read, /disagree|opposite/);
  assert.equal(r.caveat, null);
});

test("a real gap names its size, then funding; same / opposite only with a lean", () => {
  const r = forecastRead({ ...btc, yesPct: 40, crowdGapPts: 30.7, forecastLean: "UP", fundingLean: "DOWN", divergence: true });
  assert.match(r.read, /The crowd rates it 31 points more likely than BTC’s own history does\. Funding leans down: shorts are paying to hold\. The crowd and funding lean opposite ways\.$/);
  assert.match(forecastRead({ ...btc, yesPct: 40, crowdGapPts: 30.7, forecastLean: "UP" }).read, /lean the same way\.$/);
});

test("no history = no comparison, said plainly", () => {
  const r = forecastRead({ ...btc, history: null, crowdGapPts: null });
  assert.equal(r.read, "Forecasters give 12% that BTC reaches $70,000 by Nov 30. Funding leans up: longs are paying to hold.");
  assert.match(r.caveat, /couldn’t be read, so there’s no comparison/);
  assert.equal(CLOSE_STRIKE_PCT, 5);
});

test("missing pieces degrade to a shorter true sentence, never 'undefined'", () => {
  assert.equal(forecastRead({ coin: "SOL", yesPct: 80, target: null }).read, "Forecasters give 80% on this question.");
  assert.doesNotMatch(JSON.stringify(forecastRead({})), /undefined|NaN/);
});

test("the card renders the read", () => {
  const src = readFileSync(new URL("../pages/lab/ForecastDivergence.tsx", import.meta.url), "utf8");
  assert.match(src, /forecastRead\(/);
});

test("the chip: amber only for crowd-vs-funding; every other state in words", () => {
  assert.deepEqual(forecastChip(btc), { word: "Close to history", watch: false });
  assert.deepEqual(forecastChip({ ...btc, forecastLean: "UP", crowdGapPts: 21.4 }), { word: "Crowd +21 pts vs history", watch: false });
  assert.deepEqual(forecastChip({ ...btc, forecastLean: "DOWN", crowdGapPts: -15 }), { word: "Crowd −15 pts vs history", watch: false });
  assert.deepEqual(forecastChip({ ...btc, forecastLean: "UP", crowdGapPts: 21.4, divergence: true }), { word: "Crowd vs funding", watch: true });
  assert.equal(forecastChip({ ...btc, history: null }).word, "No history read");
  assert.equal(forecastChip({ coin: "SOL", target: null }).word, "Not a price target");
});

test("the tab: direction in ink (never green/red), the trader picks the side, history shown beside the crowd", () => {
  const src = readFileSync(new URL("../pages/lab/ForecastDivergence.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /C\.pos|C\.neg|\bPOS\b|\bNEG\b/, "no money colours on a lean");
  assert.doesNotMatch(src, /direction: dir\b/, "no side picked for the trader");
  assert.match(src, /handOffCall\(/);
  assert.match(src, /"forecast-divergence"/);
  assert.match(src, /<OddsTrack/);
  assert.match(src, /showLean=\{false\}/, "no third, ungraded lean inside this card");
  assert.match(src, /forecastChip\(/);
});
