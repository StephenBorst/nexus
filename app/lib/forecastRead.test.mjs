// Forecast Divergence's plain read (app/lib/forecastRead.mjs). Run: node --test app/lib/forecastRead.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forecastRead, CLOSE_STRIKE_PCT } from "./forecastRead.mjs";

const btc = { coin: "BTC", yesPct: 82.4, target: 65000, targetDirection: "DOWN", distancePct: -3.03, forecastLean: "DOWN", fundingLean: "UP", divergence: true, ends: "Dec 31" };

test("the sentence: odds, who pays funding, agree or not", () => {
  const r = forecastRead(btc);
  assert.equal(r.read, "Forecasters give 82% that BTC dips to $65,000 by Dec 31. Funding leans up: longs are paying to hold. The two disagree.");
});

test("a close strike priced high is named as distance, not conviction", () => {
  assert.equal(forecastRead(btc).caveat, "The strike is only 3.0% away, and strikes that close price high on distance alone.");
  assert.equal(forecastRead({ ...btc, distancePct: -12 }).caveat, null);
  assert.equal(CLOSE_STRIKE_PCT, 5);
});

test("near 50% is a coin flip", () => {
  assert.equal(forecastRead({ ...btc, yesPct: 52, distancePct: -15 }).caveat, "Near 50%: a coin flip, not a lean.");
});

test("missing pieces degrade to a shorter true sentence, never 'undefined'", () => {
  const r = forecastRead({ coin: "ETH", yesPct: NaN, target: null, targetDirection: null, distancePct: null, forecastLean: "UP", fundingLean: null, divergence: false, ends: null });
  assert.equal(r.read, "Forecasters lean up on ETH.");
  assert.doesNotMatch(JSON.stringify(forecastRead({})), /undefined|NaN/);
  assert.equal(forecastRead({ ...btc, targetDirection: "UP", target: 0.1234, divergence: false }).read,
    "Forecasters give 82% that BTC reaches $0.1234 by Dec 31. Funding leans up: longs are paying to hold. The two agree.");
});

test("the card renders the read", () => {
  const src = readFileSync(new URL("../pages/lab/ForecastDivergence.tsx", import.meta.url), "utf8");
  assert.match(src, /forecastRead\(/);
});
