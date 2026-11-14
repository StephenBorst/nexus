// Market alerts on change (app/lib/marketAlerts.mjs). Run: node --test app/lib/marketAlerts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { marketSnapshot, marketTransitions, marketAlertMessage, marketAlertUrl, normCoins, FORECAST_SWING_PT, MARKET_WATCH_COINS_MAX } from "./marketAlerts.mjs";

const boards = (o = {}) => ({
  mispriced: { markets: [{ coin: "ETH", fundingAnnualPct: o.fund ?? 10.9, stretched: o.stretched ?? false }] },
  smart: { consensus: { ETH: { long: o.L ?? 7, short: o.S ?? 10 } } },
  forecasts: { markets: [{ id: o.fcId ?? "m1", coin: "ETH", question: "Will ETH dip to $1,750?", forecastProbPct: o.yes ?? 50, volumeUsd: 1e6 }] },
});
const step = (prev, b) => marketTransitions("ETH", prev, marketSnapshot("ETH", b));

test("the first look is a baseline: nothing fires", () => {
  const r = step(null, boards({ stretched: true, L: 1, S: 12, yes: 90 }));
  assert.deepEqual(r.events, []);
  assert.equal(r.seen.fcBase, 90);
});

test("funding breaking out of its range fires once, not while it stays stretched", () => {
  const a = step(null, boards()).seen;
  const b = step(a, boards({ stretched: true, fund: 21.01 }));
  assert.deepEqual(b.events.map((e) => e.kind), ["FUNDING_STRETCH"]);
  assert.equal(marketAlertMessage(b.events[0]), "ETH: funding stretched past its own range (longs pay 21.0%/yr). The fade is a mechanical rule, not graded.");
  assert.deepEqual(step(b.seen, boards({ stretched: true, fund: 22 })).events, []);
});

test("consensus forming, flipping, and a near split that isn't one", () => {
  const split = step(null, boards({ L: 7, S: 10 })).seen;
  assert.equal(split.smartSide, "NONE");
  const formed = step(split, boards({ L: 2, S: 12 }));
  assert.deepEqual(formed.events.map((e) => e.kind), ["CONSENSUS_FORMED"]);
  assert.equal(marketAlertMessage(formed.events[0]), "ETH: tracked traders now agree short (12 short · 2 long). Context, not a graded read.");
  const flipped = step(formed.seen, boards({ L: 12, S: 3 }));
  assert.deepEqual(flipped.events.map((e) => e.kind), ["CONSENSUS_FLIPPED"]);
  assert.deepEqual(step(flipped.seen, boards({ L: 7, S: 10 })).events, [], "dissolving into a split is quiet");
});

test(`a forecast swing of ${FORECAST_SWING_PT}+ pts fires, then re-bases; a new market re-bases quietly`, () => {
  const a = step(null, boards({ yes: 50 })).seen;
  assert.deepEqual(step(a, boards({ yes: 64 })).events, []);
  const s = step(a, boards({ yes: 66 }));
  assert.deepEqual(s.events.map((e) => [e.kind, e.from, e.to]), [["FORECAST_SWING", 50, 66]]);
  assert.equal(marketAlertMessage(s.events[0]), 'ETH: forecast up 16 pts to 66% YES. "Will ETH dip to $1,750?"');
  assert.deepEqual(step(s.seen, boards({ yes: 70 })).events, [], "measured from the last alert, not the first look");
  const moved = step(s.seen, boards({ fcId: "m2", yes: 10 }));
  assert.deepEqual(moved.events, []);
  assert.equal(moved.seen.fcBase, 10);
});

test("an unread board keeps the last values and fires nothing", () => {
  const a = step(null, boards({ L: 2, S: 12, stretched: true })).seen;
  const r = marketTransitions("ETH", a, marketSnapshot("ETH", {}));
  assert.deepEqual(r.events, []);
  assert.equal(r.seen.smartSide, "SHORT");
  assert.equal(r.seen.stretched, true);
});

test("coins are cleaned and capped; the alert opens the coin's drawer", () => {
  assert.deepEqual(normCoins(["eth", "PERP_BTC_USDC", "ETH", "<x>", null]), ["ETH", "BTC"]);
  assert.equal(normCoins(Array.from({ length: 20 }, (_, i) => `C${i}`)).length, MARKET_WATCH_COINS_MAX);
  assert.equal(marketAlertUrl("eth"), "/lab?tab=intel&market=ETH");
  for (const kind of ["FUNDING_STRETCH", "CONSENSUS_FORMED", "FORECAST_SWING"]) {
    assert.doesNotMatch(marketAlertMessage({ kind, coin: "ETH", from: 1, to: 30, side: "LONG" }), /edge|proven|buy now|sell now/i);
  }
});
