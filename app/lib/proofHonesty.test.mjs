// /proof honesty pass (borst 2026-11-28): no ungraded scores, no agreement counts or advice, stages and paper as
// numbers and facts, and every bar the page states comes from the same rules the stage and the watcher use
// (readPipeline PIPELINE_RULES / the served gates, badgeBar BADGE_BAR). Run: node --test app/lib/proofHonesty.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PIPELINE_RULES, PAPER_MIN_TRADES } from "./readPipeline.mjs";
import { BADGE_BAR } from "./badgeBar.mjs";
import { PROOF_BAR_LINE, paperGateLine, CLEARED_LINE, ORDER_LINES, pipelineLine } from "./proofCopy.mjs";
import { gateLine, beatSentence, RANDOM_CUTOFFS } from "./proofLayout.mjs";
import { strongSides } from "./engineOverview.mjs";

const dir = new URL("../pages/proof/", import.meta.url);
const page = (f) => readFileSync(new URL(f, dir), "utf8");
// Code without its comments: the rules below are about what the page renders, not what its notes say.
const visible = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const pages = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

test("no composite score on the caller, agent or desk rows: the record's own numbers + what the order is", () => {
  const src = visible(page("index.tsx"));
  for (const v of ["c.score", "a.score", "d.score"]) assert.ok(!src.includes(`{${v}`), `${v} is a 0–100 blend, not a grade`);
  assert.match(src, /ORDER_LINES\.callers/);
  assert.match(src, /ORDER_LINES\.agents/);
  assert.match(src, /ORDER_LINES\.desks/);
  assert.match(ORDER_LINES.agents, /not a graded record/);
});

test("no filling bars on the board: a dot on a track, ticks at the cutoffs the words use", () => {
  const src = visible(page("SignalBoard.tsx"));
  assert.doesNotMatch(src, /width: `\$\{b\.pct\}%`/);
  assert.match(src, /function RandomTrack/);
  assert.match(src, /RANDOM_CUTOFFS\.worse/);
  assert.match(src, /RANDOM_CUTOFFS\.beats/);
  assert.doesNotMatch(src, /verdict === "BELOW_RANDOM" \? NEG/, "worse than random is a word, not money red");
});

test("one source for the bars: the page's numbers are the pipeline's and the badge bar's", () => {
  assert.ok(PROOF_BAR_LINE.includes(`${PIPELINE_RULES.minEvents}+ trades`));
  assert.ok(paperGateLine().includes(`${PAPER_MIN_TRADES} paper trades`));
  assert.ok(paperGateLine().includes(`${BADGE_BAR.beatPct}% of random`), "the live-plan line names the badge bar");
  assert.ok(CLEARED_LINE.includes(`${BADGE_BAR.beatPct}% of ${BADGE_BAR.runs}`));
  assert.ok(gateLine({ key: "paper_record" }).text.includes(`${BADGE_BAR.beatPct}%`));
  // Fallbacks (a gate served without its bar) are the pipeline's own numbers.
  assert.equal(gateLine({ key: "random" }).text, `Does better than ${PIPELINE_RULES.edgePct}% of random runs`);
  assert.equal(gateLine({ key: "holdout_random" }).text, `Does better than ${PIPELINE_RULES.holdoutPct}% of random runs on fresh coins`);
  assert.equal(gateLine({ key: "random_short" }).text, `Its shorts do better than ${PIPELINE_RULES.sidePct}% of random short runs`);
  for (const f of ["PaperRun.tsx", "Graveyard.tsx", "HowWeGrade.tsx"]) {
    const src = visible(page(f));
    assert.doesNotMatch(src, /90% of 300/, `${f}: the badge bar's numbers come from BADGE_BAR`);
    assert.doesNotMatch(src, /\?\? (30|95|80|100)\b/, `${f}: no literal fallback for a pipeline bar`);
  }
  assert.doesNotMatch(visible(page("SignalBoard.tsx")), /minEvents \?\? 30/);
});

test("the Lead line's holdout caveat follows the served gates", () => {
  const withHold = pipelineLine({ stage: "LEAD", numbers: { events: 40, holdoutEvents: 99, holdoutMeanR: 1, holdoutBeatsRandomPct: 99 }, gates: [{ key: "holdout_random", met: false }] });
  assert.match(withHold.sub, /Hasn't repeated/, "served gate says a holdout bar is in the way");
  const noHold = pipelineLine({ stage: "LEAD", numbers: { events: 40, holdoutEvents: 0 }, gates: [{ key: "random", met: false }] });
  assert.doesNotMatch(noHold.sub, /Hasn't repeated/);
});

test("'how we grade' names every stage up to CLEARED, with the side rule", () => {
  const src = visible(page("HowWeGrade.tsx"));
  assert.match(src, /\["Cleared",/);
  assert.match(src, /BADGE_BAR\.beatPct/);
  assert.match(src, /sideMinEvents/);
});

test("the strongest-sides line uses the served side bar, not its own", () => {
  const side = (n) => ({ events: n, r: { meanR: 0.3 } });
  const rb = (pct) => ({ pctBeaten: pct, randomMedianR: 0 });
  const mk = (n) => ({ sides: { LONG: side(n), SHORT: null }, random: { bySide: { LONG: rb(99), SHORT: null } } });
  const board = (rules) => ({
    axes: [{ name: "x", oos: mk(25) }], holdout: { axes: [{ name: "x", oos: mk(25) }] },
    pipeline: { rules, reads: [{ axis: "x", stage: "LEAD", numbers: { events: 25, holdoutEvents: 25 } }] },
  });
  assert.deepEqual(strongSides(board({ sideMinEvents: 20, edgePct: 95 })), [{ axis: "x", side: "LONG" }]);
  assert.deepEqual(strongSides(board({ sideMinEvents: 30, edgePct: 95 })), [], "25 events is under a served 30");
});

test("plain words: 'beat N%' is a share of random runs, not how often a trade won", () => {
  assert.equal(beatSentence(61), "Did better than 61% of random runs.");
  assert.deepEqual([RANDOM_CUTOFFS.beats, RANDOM_CUTOFFS.leans, RANDOM_CUTOFFS.worse], [95, 80, 5]);
  for (const f of pages) assert.doesNotMatch(visible(page(f)), /% of the time/, f);
});

test("no claim words on /proof: no proven / conviction / confluence / agree counts / luck", () => {
  for (const f of pages) {
    const src = visible(page(f));
    assert.doesNotMatch(src, /\bproven\b|\bprovably\b|\+EV|guarantee/i, f);
    assert.doesNotMatch(src, /conviction|confluen|\bagree(s|ment)?\b(?! *ing)|reads? confirm/i, f);
    assert.doesNotMatch(src, /\bit’s luck\b|price luck/i, f);
  }
  const carry = visible(page("CarrySleeve.tsx"));
  assert.doesNotMatch(carry, /real edge|the edge actually holds|most promising/i, "the carry sleeve isn't graded: no edge claim");
  assert.doesNotMatch(carry, /carrySharePct >= 55 \? POS/, "a ratio is ink, not money green");
});
