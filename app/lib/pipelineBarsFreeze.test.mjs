// docs/research/pipeline-bars-freeze.md: SIGNED by borst in session 2026-11-28 ("sign the freeze page"). The text above
// Results is pinned by its sha256, and the code's constants are pinned to the numbers on the page. A change to any bar =
// a new dated page, signed on its own, and this test pointed at it; never an edit to the signed page or to these pins.
import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PIPELINE_RULES as R, PAPER_MIN_TRADES } from "./readPipeline.mjs";
import { BADGE_BAR } from "./badgeBar.mjs";
import { LOCK_RULE } from "./promotionLock.mjs";

const doc = readFileSync(new URL("../../docs/research/pipeline-bars-freeze.md", import.meta.url), "utf8");
const above = doc.slice(0, doc.indexOf("## Results"));

export const PIPELINE_BARS_FREEZE_SHA256 = "b2ce0bdf15cd0add3cdedcb951ea9a521d0d5cfd4b026af7a06d83b296c6367f";

test("the signed page is unchanged above Results", () => {
  assert.ok(doc.includes("## Results"));
  assert.match(above, /\*\*Signed by borst in session 2026-11-28 \("sign the freeze page"\)\.\*\*/);
  assert.match(above, /## Sign-off\n\nSigned by borst in session 2026-11-28: "sign the freeze page"\./);
  assert.equal(createHash("sha256").update(above).digest("hex"), PIPELINE_BARS_FREEZE_SHA256,
    "the signed freeze page changed above Results: a new bar is a new dated page, signed on its own");
});

test("the code's bars are the frozen numbers", () => {
  assert.deepEqual({ ...R }, { minEvents: 30, edgePct: 95, holdoutMinEvents: 30, holdoutPct: 80, exitMinTrades: 30,
    failEvents: 100, sideMinEvents: 20, sidePct: 50 }, "PIPELINE_RULES moved off the signed freeze page");
  assert.equal(PAPER_MIN_TRADES, 30, "PAPER_MIN_TRADES moved off the signed freeze page");
  assert.equal(BADGE_BAR.runs, 300);
  assert.equal(BADGE_BAR.beatPct, 90);
  assert.equal(BADGE_BAR.minUsable, 250);
  assert.equal(BADGE_BAR.feeBps, 2.5);
  assert.deepEqual({ ...LOCK_RULE }, { passes: 2, minDaysApart: 7, newEvents: 15 }, "LOCK_RULE moved off the signed freeze page");
});

test("every number on the page is the number the code uses", () => {
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
