// The graveyard (app/lib/graveyard.mjs). Run: node --test app/lib/graveyard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { graveyard, graveDate, graveyardHeadline, DROPPED_DRAFTS, GRAVEYARD_LINE } from "./graveyard.mjs";
import { FAILING_SEEDS } from "./pipelineWatch.mjs";

const sc = {
  axes: [
    { name: "level_reclaim", label: "Level reclaim", verdict: "NOISE", r: { meanR: -0.1, samples: 129 } },
    { name: "session_fade", label: "Session fade", verdict: "NOISE", r: { meanR: -0.2, samples: 104 } },
    { name: "btc_lead_lag", label: "BTC lead-lag", verdict: "PREDICTIVE", r: { meanR: 0.7, samples: 25 } },
    { name: "liq_flush", label: "Liquidation flush", verdict: "NOISE", r: { meanR: -0.08, samples: 8729 }, random: { pooled: { verdict: "BELOW_RANDOM", pctBeaten: 0 } } },
    { name: "smart_follow", label: "Smart follow", verdict: "PREDICTIVE", r: { meanR: 0.21, samples: 15290 } },
    { name: "basis_extreme", label: "Basis extreme", verdict: "NOISE", r: { meanR: -0.24, samples: 1474 }, random: { pooled: { verdict: "NOT_DISTINGUISHABLE", pctBeaten: 51.2 } } },
  ],
  pipeline: { reads: [
    { axis: "level_reclaim", stage: "REGISTERED", paperWallet: "0x95e26E980e300C34360933b849457F42c6Bd7622", failing: ["main card: 129 events, mean R -0.1"] },
    { axis: "session_fade", stage: "REGISTERED", failing: ["main card: 104 events, mean R -0.2, worse than random"] },
    { axis: "btc_lead_lag", stage: "TRADEABLE" },
  ] },
};
const locks = { level_reclaim: { lostStage: "PAPER", demotedAt: "2026-11-15T13:53:54.714Z", eventsAtDemotion: 99, cleanPasses: 0 } };

test("every section from records that exist, each row dated and with the number that broke it", () => {
  const g = graveyard({ scorecard: sc, failingReads: { session_fade: { since: "2026-11-27T13:53:00Z", reasons: [] } }, seeds: FAILING_SEEDS, locks, judgments: {
    btc_lead_lag: { recorded: true, verdict: "PASS", random: "DIDNT_BEAT", randomPct: 71 },
    oi_div_reversal: { recorded: true, verdict: "PASS", random: "BEAT", randomPct: 95 },
  } });
  assert.equal(g.unread, false);
  assert.deepEqual(g.failing.map((r) => [r.axis, r.since, r.sinceSource]), [
    ["level_reclaim", FAILING_SEEDS.level_reclaim, "git"],
    ["session_fade", "2026-11-27T13:53:00Z", "watcher"],
  ]);
  assert.deepEqual(g.failing[1].reasons, ["main card: 104 events, mean R -0.2, worse than random"], "reasons come from the served board");
  assert.deepEqual(g.fellBack.map((r) => [r.axis, r.lostStage, r.nowStage, r.eventsAtDemotion, r.backAtStage]), [["level_reclaim", "PAPER", "REGISTERED", 99, false]]);
  assert.deepEqual(g.failing.map((r) => r.paperRun), [true, true], "a run link only where a paper run exists");
  assert.deepEqual(g.paper.map((r) => [r.axis, r.verdict, r.random]), [["btc_lead_lag", "PASS", "DIDNT_BEAT"]], "a PASS that beat random isn't buried");
  assert.deepEqual(g.history.map((r) => r.axis), ["basis_extreme", "liq_flush"], "unregistered, mean R ≤ 0, worst first; registered reads never listed here");
  assert.equal(g.history[1].randomVerdict, "BELOW_RANDOM");
  assert.deepEqual(g.retired.map((r) => [r.axis, r.on]), [["basis_x_cvd", "2026-10-26"]]);
  assert.equal(g.dropped.length, DROPPED_DRAFTS.length);
  assert.deepEqual(g.cleared, []);
  assert.match(graveyardHeadline(g), /^0 cleared\. \d+ on this page: 2 failing, 1 fell back, 2 lost on recorded history, 1 retired, 4 dropped before testing, 1 failed on paper\.$/);
});

test("unread board = no partial graveyard; dates in words; undated says so", () => {
  const g = graveyard({ scorecard: null });
  assert.equal(g.unread, true);
  assert.match(graveyardHeadline(g), /unread/);
  assert.equal(graveDate("2026-11-20T13:53:51.022Z"), "Nov 20, 2026");
  assert.equal(graveDate("2026-10-16"), "Oct 16, 2026");
  assert.equal(graveDate(null), "not dated yet");
});

test("the dropped drafts point at their own pages, which say they were dropped", () => {
  for (const d of DROPPED_DRAFTS) {
    const page = readFileSync(new URL(`../../${d.doc}`, import.meta.url), "utf8");
    assert.match(page, new RegExp(`${d.name}[\\s\\S]{0,200}dropped|dropped[\\s\\S]{0,200}${d.name}`, "i"), d.name);
    assert.match(d.on, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("words: no score, no ranking of the dead, never 'proven'; the page never colours a read green or red", () => {
  const src = readFileSync(new URL("./graveyard.mjs", import.meta.url), "utf8") + readFileSync(new URL("../pages/proof/Graveyard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bproven\b|\bscore\s*[:=]|C\.pos|C\.neg|POS\b|NEG\b/);
  assert.match(GRAVEYARD_LINE, /can recover/);
});
