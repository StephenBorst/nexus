// docs/research/pipeline-bars-freeze.md: DRAFTED 2026-11-28 for borst to sign. Until it is signed it binds nothing, so
// this test only keeps the draft honest: every number it states is the number the code uses today, and it says it is a
// draft. The signing PR replaces the draft checks with a sha256 pin of the text above Results and pins the constants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PIPELINE_RULES as R, PAPER_MIN_TRADES } from "./readPipeline.mjs";
import { BADGE_BAR } from "./badgeBar.mjs";
import { LOCK_RULE } from "./promotionLock.mjs";

const doc = readFileSync(new URL("../../docs/research/pipeline-bars-freeze.md", import.meta.url), "utf8");
const above = doc.slice(0, doc.indexOf("## Results"));

test("the draft says it is a draft and binds nothing until signed", () => {
  assert.match(above, /\*\*DRAFT\. Not signed\. It binds nothing until borst signs it\.\*\*/);
  assert.match(above, /## Sign-off\n\nSignature: pending\./);
  assert.ok(doc.includes("## Results"));
});

test("every number on the draft is the number the code uses today", () => {
  const flat = above.replace(/\s+/g, " "); // the page wraps lines; numbers are matched on the text, not the layout
  const has = (re, what) => assert.match(flat, re, what);
  has(new RegExp(`${R.minEvents} out-of-sample events; mean R above 0`), "Lead: minEvents");
  has(new RegExp(`At least ${R.edgePct}% of 300 random entries`), "Edge: edgePct");
  has(new RegExp(`each side with ${R.sideMinEvents} or more events also has at least ${R.sidePct}%`), "Edge: per side");
  has(new RegExp(`Fresh coins: ${R.holdoutMinEvents} events, mean R above 0, and at least ${R.holdoutPct}%`), "Edge: holdout");
  has(new RegExp(`graded-exit line with ${R.exitMinTrades} trades, net above 0 bps`), "Tradeable: exitMinTrades");
  has(new RegExp(`The first ${PAPER_MIN_TRADES} closed paper trades`), "CLEARED: paper trades");
  has(new RegExp(`${BADGE_BAR.feeBps} bps taker each side`), "CLEARED: fees");
  has(new RegExp(`at or above ${BADGE_BAR.beatPct}% of ${BADGE_BAR.runs} matched random entries`), "CLEARED: badge bar");
  has(new RegExp(`fewer than ${BADGE_BAR.minUsable} usable replays`), "CLEARED: usable replays");
  has(new RegExp(`At ${R.failEvents} or more out-of-sample events`), "failing label");
  has(new RegExp(`${LOCK_RULE.passes} clean daily watcher reads at the lost stage or higher, at least ${LOCK_RULE.minDaysApart} days apart, plus ${LOCK_RULE.newEvents} new`), "promotion lock");
});
