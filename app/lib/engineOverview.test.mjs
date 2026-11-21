import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overviewReads, chartRows, tideOf, btcRegime, strongSides, paperCard, sideWords, chartPct, CHART } from "./engineOverview.mjs";

// The engine overview on /proof (borst 2026-11-17, pipeline-if-then.md "Engine overview").
const side = (events, meanR, pctBeaten, randomMedianR) => ({ s: { events, r: { meanR } }, rb: { pctBeaten, randomMedianR } });
const oos = (L, S) => ({ sides: { LONG: L && { events: L.s.events, r: L.s.r }, SHORT: S && { events: S.s.events, r: S.s.r } }, random: { bySide: { LONG: L?.rb, SHORT: S?.rb } } });
const board = {
  tide: { from: "2026-08-07T16:00:00Z", to: "2026-11-16T07:00:00Z", markets: 12, LONG: { meanR: -0.18 }, SHORT: { meanR: 0.2 } },
  regimeWindow: { regime: { counts: { UP: 0, DOWN: 7, FLAT: 13 }, days: [{ day: "2026-10-27", retPct: -4.27, state: "FLAT" }, { day: "2026-11-15", retPct: -19.83, state: "DOWN" }] } },
  axes: [
    { name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", oos: oos(side(48, -0.04, 100, -0.51), side(42, 0.52, 23.7, 0.68)) },
    { name: "spot_absorb", label: "Spot absorbs", oos: oos(null, null) },
  ],
  holdout: { axes: [{ name: "oi_div_reversal_4h", oos: oos(side(25, -0.1, 98.8, -0.6), side(17, 0.41, 22.3, 0.62)) }] },
  pipeline: { reads: [
    { axis: "oi_div_reversal_4h", stage: "REGISTERED", next: "mean R > 0 with both halves agreeing", numbers: { events: 90, meanR: 0.22, holdoutEvents: 42, holdoutMeanR: 0.11 } },
    { axis: "spot_absorb", stage: "REGISTERED", numbers: { events: 0, meanR: 0 } },
  ] },
};

test("the market: the tide, BTC's 30 days, the regime days; unread is null, never 0", () => {
  assert.deepEqual(tideOf(board), { long: -0.18, short: 0.2, from: board.tide.from, to: board.tide.to, markets: 12 });
  assert.deepEqual(btcRegime(board), { day: "2026-11-15", ret30: -19.83, state: "DOWN", counts: { UP: 0, DOWN: 7, FLAT: 13 }, since: "2026-10-27" });
  assert.equal(tideOf({ tide: { LONG: { meanR: null }, SHORT: { meanR: 0.2 } } }), null);
  assert.equal(btcRegime({}), null);
});

test("reads: new data per side vs random, main and holdout, words by rule", () => {
  const main = overviewReads(board);
  const oi = main[0];
  assert.deepEqual(oi.sides.SHORT, { n: 42, meanR: 0.52, randomR: 0.68, pct: 23.7 });
  assert.deepEqual(oi.words, ["Longs beat random longs (100% of replays), and still lost money.", "Shorts made money but trailed random shorts (24%): the market did the work."]);
  assert.deepEqual(main[1].words, ["30 more new events before it is graded."]);
  assert.equal(main[1].meanR, null, "no events = no mean, never 0.00R");
  const hold = overviewReads(board, { line: "holdout" });
  assert.equal(hold[0].events, 42);
  assert.equal(hold[0].sides.LONG.pct, 98.8);
  assert.deepEqual(strongSides(board), [{ axis: "oi_div_reversal_4h", side: "LONG" }]);
  assert.deepEqual(chartRows(main, "LONG").map((r) => r.axis), ["oi_div_reversal_4h"]);
  assert.equal(sideWords("SHORT", { n: 4, meanR: 1.5, pct: 90 }), "Shorts: 4 events, too few to compare.");
  assert.equal(chartPct(CHART.min), 0); assert.equal(chartPct(CHART.max), 100); assert.equal(chartPct(9), 100, "clamped to the ruler");
});

test("paper cards: counts and each trade's outcome, never R sums or dollars", () => {
  const run = { count: 3, target: 30, startedAt: "2026-11-13T19:35:47Z", tally: { win: 0, loss: 3 }, trades: [{ coin: "SOL", side: "LONG", outcome: "LOSS", reason: "SL", r: -1.03, movePct: -3.07, entry: 77.6, exit: 75.2 }], open: { coin: "SOL", side: "SHORT", entry: 71.8, openedAt: "2026-11-15T03:01:41Z" }, tape: { line: "7 of 7 on the tape" } };
  const c = paperCard("oi_div_reversal_4h", run, { verdict: "ACCRUING" });
  assert.deepEqual(c.trades, [{ coin: "SOL", side: "LONG", outcome: "LOSS", reason: "SL" }]);
  assert.doesNotMatch(JSON.stringify(c), /"r"|movePct|pnl|usd/i, "no R, move or dollars leave the card");
  assert.equal(c.stops, 3);
  assert.deepEqual(paperCard("x", null, null), { axis: "x", unread: true });
});

test("the signed section is on the rules page; the panel uses the shared rules and claims nothing", () => {
  const page = readFileSync(new URL("../../docs/research/pipeline-if-then.md", import.meta.url), "utf8");
  assert.match(page, /\*\*Engine overview\*\* \(added 2026-11-17, borst/);
  assert.match(page, /No sum or average of R and no dollar figure before the 30-trade judgment/);
  const ui = readFileSync(new URL("../pages/proof/EngineOverview.tsx", import.meta.url), "utf8");
  assert.match(ui, /from "@\/lib\/engineOverview\.mjs"/);
  assert.doesNotMatch(ui, /\bproven\b|has an edge|\+EV/i);
  assert.doesNotMatch(ui, /\.r\b|sumR|meanR\)\s*\*|toLocaleString\("en-US", \{ style: "currency"/, "no paper R math, no dollars");
  const proof = readFileSync(new URL("../pages/proof/index.tsx", import.meta.url), "utf8");
  // Placed in pieces since the visual pass (2026-11-21): the chart and the paper cards on the page, the market folded.
  assert.match(proof, /<SideChart scorecard=\{scorecard\} \/>/);
  assert.match(proof, /<PaperWallets isMobile=\{isMobile\} \/>/);
  assert.match(proof, /<MarketStats scorecard=\{scorecard\} \/>/);
  const review = readFileSync(new URL("../../tools/review/engineReview.mjs", import.meta.url), "utf8");
  assert.match(review, /import \{ sideWords \} from "\.\.\/\.\.\/app\/lib\/engineOverview\.mjs"/, "one copy of the sentence rule");
});
