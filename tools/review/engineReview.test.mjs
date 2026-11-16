import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewModel, renderReview, gatherReview, sideWords, fmtR } from "./engineReview.mjs";

// The weekly engine review (borst 2026-11-16): every sentence follows a rule from the numbers; the API is only read.
const side = (events, meanR, pctBeaten, randomMedianR) => ({ events, r: { meanR }, rb: { verdict: "X", n: events, pctBeaten, randomMedianR } });
const oos = (L, S) => ({ sides: { LONG: L && { events: L.events, r: L.r }, SHORT: S && { events: S.events, r: S.r } }, random: { bySide: { LONG: L?.rb, SHORT: S?.rb } } });
const board = {
  asOf: "2026-11-16T18:53:49.962Z",
  tide: { from: "2026-08-07T16:00:00Z", to: "2026-11-16T07:00:00Z", markets: 12, LONG: { meanR: -0.18 }, SHORT: { meanR: 0.2 } },
  axes: [
    { name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", oos: oos(side(48, -0.04, 100, -0.51), side(42, 0.52, 23.7, 0.68)) },
    { name: "confluence_follow", label: "Funding × OI confluence <b>", oos: oos(side(68, -0.33, 56, -0.35), side(26, 0.71, 70, 0.54)) },
  ],
  holdout: { axes: [{ name: "oi_div_reversal_4h", oos: oos(side(25, -0.1, 98.8, -0.6), side(17, 0.41, 22.3, 0.62)) }] },
  pipeline: {
    rules: { minEvents: 30, edgePct: 95, holdoutPct: 80, exitMinTrades: 30, killEvents: 100, sideMinEvents: 20, sidePct: 50 },
    reads: [
      { axis: "oi_div_reversal_4h", stage: "REGISTERED", next: "mean R > 0 with both halves agreeing", numbers: { events: 90, meanR: 0.22, holdoutEvents: 42, holdoutMeanR: 0.11 } },
      { axis: "confluence_follow", stage: "REGISTERED", next: "mean R > 0 with both halves agreeing", numbers: { events: 94, meanR: -0.04, holdoutEvents: 0, holdoutMeanR: 0 } },
    ],
  },
};

test("each side is judged against its random entry, never against zero", () => {
  assert.equal(sideWords("SHORT", { n: 42, meanR: 0.52, pct: 23.7 }), "Shorts made money but trailed random shorts (23.7%): the market did the work.");
  assert.equal(sideWords("LONG", { n: 48, meanR: -0.04, pct: 100 }), "Longs beat random longs (100% of replays), and still lost money.");
  assert.equal(sideWords("LONG", { n: 68, meanR: -0.33, pct: 56 }), "Longs lost less than random longs (56%), but lost.");
  assert.match(sideWords("SHORT", { n: 3, meanR: 1.5, pct: null }), /too few to compare/);
  assert.equal(fmtR(-0.04), "−0.04R");
});

test("the model: tide, sides, the retirement countdown, a side strong on both coin sets", () => {
  const m = reviewModel({ board, pulse: { headline: { title: "Nothing has proven itself yet." }, gradedWeek: 17, open: 2, recentGraded: [], engineRecords: [{ caller: "Ember", graded: 35, wins: 15, netR: -4.04, lastAt: 1794081600000 }] } });
  assert.deepEqual(m.tide, { since: "7 Aug", long: -0.18, short: 0.2, markets: 12 });
  assert.deepEqual(m.strong, [{ axis: "oi_div_reversal_4h", side: "LONG" }]);
  const cf = m.reads.find((r) => r.axis === "confluence_follow");
  assert.ok(cf.words.includes("6 events from the retirement check at mean −0.04R."));
  assert.equal(cf.holdout.meanR, null, "no holdout events = no number, never 0.00R");
  assert.equal(m.advanced.length, 0);
  assert.ok(reviewModel({ board: null }).error, "an unread board is said, never an empty page");
});

test("the page: escapes API text, claims nothing past the bar, the weekly note is plain text", () => {
  const m = reviewModel({ board, pulse: null });
  const html = renderReview(m, { thisWeek: "Longs <script>x</script> held.\n\nSecond point." });
  assert.match(html, /<title>Nexus Engine Review<\/title>/);
  assert.match(html, /Nothing has cleared its bar\./);
  assert.ok(!html.includes("<script>x</script>") && html.includes("&lt;script&gt;"), "the note is escaped");
  assert.equal((html.match(/<h2>This week<\/h2>/g) || []).length, 1);
  assert.doesNotMatch(html, /\bproven\b(?! itself yet)/i);
  assert.doesNotMatch(renderReview(m), /This week/, "no note, no section");
  assert.match(html, /Arming is borst’s call, in person\./);
});

test("it only reads: GETs to the public API, nothing else", async () => {
  const seen = [];
  await gatherReview(async (path) => { seen.push(path); return path === "/pipeline/paper-wallets" ? { reads: [{ axis: "level_reclaim", wallet: "0x95e2" }] } : null; });
  assert.deepEqual(seen, ["/intel/axis-backtest", "/calls/pulse", "/pipeline/paper-wallets", "/signals/paper-run/level_reclaim", "/signals/paper-judge/level_reclaim"]);
  const src = readFileSync(new URL("./engineReview.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /method:\s*"(POST|PUT|DELETE)"/);
  assert.doesNotMatch(src, /walletSig|labAuth|privateKey|signMessage/);
});
