import { test } from "node:test";
import assert from "node:assert/strict";
import { identityCardModel, identityShareText, recordLine, rankText, normRecord, BOARD_MIN_CALLS } from "./identityCard.mjs";
import { buildOperatorProfile } from "./operatorProfile.mjs";

const SIGNAL = { tier: "SIGNAL", title: "Signal", glyph: "▪" };

test("no merit rank → no rank chip (no placeholder)", () => {
  const m = identityCardModel({ profile: buildOperatorProfile({ process: { calls: 3 } }), record: { calls: 3, hitRate: 33.3, avgR: -0.2 } });
  assert.equal(m.rank, null);
  const ranked = identityCardModel({ profile: { ...buildOperatorProfile({ process: { calls: 28 } }), meritRank: SIGNAL }, record: { calls: 28, hitRate: 35.7, avgR: 0.05 } });
  assert.equal(ranked.rank, "▪ SIGNAL");
  assert.equal(rankText(null), null);
  assert.equal(rankText({}), null);
});

test("hit rate never appears without the average R", () => {
  assert.equal(recordLine({ calls: 28, hitRate: 35.7, avgR: 0.05 }), "28 graded calls · 36% hit · +0.05R avg");
  assert.equal(recordLine({ calls: 1, hitRate: 0, avgR: -1 }), "1 graded call · 0% hit · −1.00R avg");
  assert.equal(recordLine({ calls: 4, hitRate: 50 }), "4 graded calls");   // no R → no hit rate either
  assert.equal(recordLine({ calls: 0 }), null);
  assert.equal(recordLine(null), null);
});

test("cold start says how many calls the board needs, never promises a rank", () => {
  const m = identityCardModel({ profile: buildOperatorProfile({ process: { calls: 2 } }), record: { calls: 2, hitRate: 50, avgR: 0.4 } });
  const q = m.stats.find((s) => s.label === "TO QUALIFY");
  assert.equal(q.value, String(BOARD_MIN_CALLS - 2));
  assert.match(q.sub, /caller board/);
  assert.ok(!JSON.stringify(m).match(/Signal tier|rank up/i));
  assert.equal(m.headline, "BUILDING A GRADED RECORD");
  // R is money: toned; the count and the qualifier are not.
  assert.deepEqual(m.stats.map((s) => s.tone), [null, "pos", null]);
});

test("zero graded calls: plain empty state, no numbers invented", () => {
  const m = identityCardModel({ profile: buildOperatorProfile({}), record: { calls: 0 } });
  assert.equal(m.headline, "NO GRADED CALLS YET");
  assert.equal(m.rank, null);
  assert.equal(m.stats[1].value, "—");
  assert.equal(m.stats[1].tone, null);
  assert.equal(identityShareText({ calls: 0 }, null), "No graded calls yet. Every public call is graded from public price.");
});

test("five or more calls without a rank: no qualifier count, no chip", () => {
  const m = identityCardModel({ profile: buildOperatorProfile({ process: { calls: 6 } }), record: { calls: 6, hitRate: 33.3, avgR: -0.3 } });
  assert.equal(m.rank, null);
  assert.ok(!m.stats.some((s) => s.label === "TO QUALIFY"));
  assert.match(m.recordLine, /−0\.30R avg/);
});

// Live case (Oct 16): 28 graded calls, Signal rank, no archetype yet. The first cut headlined it
// "BUILDING A GRADED RECORD", which is false for a ranked 28-call record.
test("a sampled record without an archetype is not called 'building'", () => {
  const process = { calls: 28, hitRate: 35.7, avgR: 0.05, meritRank: { tier: "SIGNAL", title: "Signal", glyph: "▪" },
    expectancy: { expectancy: 0.053, profitFactor: 1.08, tailRatio: 0.25, avgWinR: 1.95, avgLossR: 1 } };
  const m = identityCardModel({ profile: buildOperatorProfile({ process }), record: process });
  assert.equal(m.headline, "GRADED CALLER RECORD");
  assert.equal(m.rank, "▪ SIGNAL");
  assert.deepEqual(m.stats.map((s) => s.label), ["EXPECTANCY", "PROFIT FACTOR", "PLAN QUALITY"]);
  assert.equal(m.stats[0].value, "+0.053R");
  assert.ok(!m.stats.some((st) => /\byour?\b/i.test(st.sub)), "a caption still says 'you'");
});

test("the regime read is re-pointed to the third person", () => {
  const profile = { tier: "ESTABLISHED", archetype: { label: "Chop trader" }, meritRank: SIGNAL, gradedCalls: 28,
    reads: [{ kind: "REGIME", text: "your edge is real in chop (+0.08R over 19)" }], headline: [] };
  const m = identityCardModel({ profile, record: { calls: 28, hitRate: 35.7, avgR: 0.05 } });
  assert.equal(m.readLine, "Their edge is real in chop (+0.08R over 19)");
});

test("share text: rank name only when earned, record in parts", () => {
  assert.equal(identityShareText({ calls: 28, hitRate: 35.7, avgR: 0.05 }, SIGNAL), "Signal. 28 graded calls · 36% hit · +0.05R avg. Graded from public price.");
  assert.equal(identityShareText({ calls: 3, hitRate: 33.3, avgR: -0.2 }, null), "3 graded calls · 33% hit · −0.20R avg. Graded from public price.");
});

test("normRecord rejects junk", () => {
  assert.deepEqual(normRecord({ calls: "x" }), { calls: 0, hitRate: null, avgR: null });
  assert.deepEqual(normRecord({ calls: 2, hitRate: "50", avgR: "nope" }), { calls: 2, hitRate: 50, avgR: null });
});
