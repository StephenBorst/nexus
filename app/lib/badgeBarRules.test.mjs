// The v2 badge rules (app/lib/badgeBar.mjs). The page's text is pinned by badgeBar.test.mjs; this file pins the code to
// the page's numbers. Run: node --test app/lib/badgeBarRules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BADGE_BAR, pctBeaten, randomVerdict, beatsRandom, badgeLine } from "./badgeBar.mjs";

const page = readFileSync(new URL("../../docs/research/badge-bar-v2.md", import.meta.url), "utf8");

test("the code's numbers are the signed page's numbers", () => {
  assert.match(page, /300 seeded replays \(mulberry32, seed 20261120/);
  assert.equal(BADGE_BAR.seed, 20261120);
  assert.equal(BADGE_BAR.runs, 300);
  assert.match(page, /at least \*\*90%\*\* of the replay means/);
  assert.equal(BADGE_BAR.beatPct, 90);
  assert.match(page, /at most 10\s+times, then the replay is left out\)\. Fewer than 250 usable replays = UNREAD/);
  assert.equal(BADGE_BAR.maxRedraws, 10);
  assert.equal(BADGE_BAR.minUsable, 250);
  assert.match(page, /2\.5 bps taker on each side for every replay trade/);
  assert.equal(BADGE_BAR.feeBps, 2.5);
  assert.equal(BADGE_BAR.doc, "docs/research/badge-bar-v2.md");
});

test("share beaten: ties count half, one decimal", () => {
  assert.equal(pctBeaten(5, [1, 2, 3, 5, 9, 10]), 58.3);
  assert.equal(pctBeaten(100, [1, 2]), 100);
  assert.equal(pctBeaten(0, []), null);
});

test("verdict: ≥ 90% and above 0 = BEAT; under 90%, or ≤ 0, = DIDNT_BEAT; < 250 usable = UNREAD", () => {
  const means = Array.from({ length: 300 }, (_, i) => i - 150); // −150 … 149
  assert.equal(randomVerdict(121, means).verdict, "BEAT");          // beats 271.5 / 300 = 90.5%
  assert.equal(randomVerdict(118, means).verdict, "DIDNT_BEAT");    // 89.5%
  const allNeg = Array.from({ length: 300 }, (_, i) => -1000 + i);
  assert.equal(randomVerdict(-5, allNeg).verdict, "DIDNT_BEAT", "beating random entries that all lost is not enough: the mean must be > 0");
  const few = randomVerdict(500, means.slice(0, 249));
  assert.deepEqual(few, { verdict: "UNREAD", pctBeaten: null, usable: 249 });
});

test("the badge: only a PASS whose check BEAT (full record or the /proof hook's slim shape)", () => {
  assert.equal(beatsRandom({ verdict: "PASS", randomCheck: { verdict: "BEAT" } }), true);
  assert.equal(beatsRandom({ verdict: "PASS", random: "BEAT" }), true);
  assert.equal(beatsRandom({ verdict: "PASS", randomCheck: { verdict: "DIDNT_BEAT" } }), false);
  assert.equal(beatsRandom({ verdict: "PASS" }), false, "rule 9: every badge from the signing day needs the check");
  assert.equal(beatsRandom({ verdict: "FAIL", randomCheck: { verdict: "BEAT" } }), false);
  assert.equal(beatsRandom(null), false);
});

test("the lines say what happened, in the page's words (rule 7)", () => {
  assert.equal(badgeLine({ verdict: "PASS", target: 30, randomCheck: { verdict: "DIDNT_BEAT", pctBeaten: 71.4 } }),
    "Passed 30 paper trades after fees. Didn't beat random entries on the same coins and side (71% of 300).");
  assert.equal(badgeLine({ verdict: "PASS", target: 30, randomCheck: { verdict: "BEAT", pctBeaten: 93.2 } }),
    "Passed 30 paper trades after fees and beat 93% of 300 random entries on the same coins and side.");
  assert.match(badgeLine({ verdict: "PASS", random: "UNREAD", randomUsable: 212 }), /unread \(212 of 300 replays usable\): the badge waits/);
  assert.match(badgeLine({ verdict: "PASS" }), /hasn't run: not cleared/);
  assert.equal(badgeLine({ verdict: "FAIL" }), null);
  for (const l of [badgeLine({ verdict: "PASS", randomCheck: { verdict: "BEAT", pctBeaten: 99 } })]) assert.doesNotMatch(l, /proven|edge|\$/i);
});
