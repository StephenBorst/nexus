// app/lib/lensRecord.mjs. Run: node --test app/lib/lensRecord.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lensRecord, LENS_MIN } from "./lensRecord.mjs";

const call = (dir, outcome, r, lens, over = {}) => ({ direction: dir, gradedOutcome: outcome, gradedR: r, publishLens: lens, ...over });
const shortAgree = { smartSide: "SHORT", stretched: true, fundAnnual: 21, at: 1 };
const calmNone = { smartSide: "NONE", stretched: false, fundAnnual: 5, at: 1 };

test("nothing to say until a graded call carries a snapshot", () => {
  assert.equal(lensRecord([]), null);
  assert.equal(lensRecord([call("SHORT", "WIN", 1.5, undefined), call("SHORT", undefined, null, shortAgree)]), null);
});

test("splits graded calls by what the lenses showed at the post", () => {
  const rec = lensRecord([
    call("SHORT", "WIN", 1.5, shortAgree), // with smart, with the fade
    call("LONG", "LOSS", -1, shortAgree),  // against both
    call("LONG", "WIN", 2, calmNone),      // no agreement, calm funding
    call("SHORT", "WIN", 1, shortAgree, { duplicateOf: "x" }), // a marked copy never counts
  ]);
  assert.equal(rec.tracked, 3);
  assert.deepEqual(rec.smart.with, { n: 1, wins: 1, netR: 1.5, avgR: null });
  assert.deepEqual(rec.smart.against, { n: 1, wins: 0, netR: -1, avgR: null });
  assert.equal(rec.smart.none.n, 1);
  assert.equal(rec.funding.withFade.n, 1);
  assert.equal(rec.funding.againstFade.n, 1);
  assert.equal(rec.funding.calm.n, 1);
  assert.deepEqual(rec.lines, [], "no averages under the minimum");
});

test("averages and the plain line only once both sides have LENS_MIN calls", () => {
  const list = [];
  for (let i = 0; i < LENS_MIN; i++) list.push(call("SHORT", "WIN", 1, shortAgree));
  for (let i = 0; i < LENS_MIN; i++) list.push(call("LONG", "LOSS", -1, shortAgree));
  const rec = lensRecord(list);
  assert.equal(rec.smart.with.avgR, 1);
  assert.equal(rec.smart.against.avgR, -1);
  assert.deepEqual(rec.lines, [
    "With the tracked traders' 2× agreement: +1.00R a call over 5. Against it: −1.00R over 5.",
    "With the funding fade: +1.00R a call over 5. Against it: −1.00R over 5.",
  ]);
  for (const l of rec.lines) assert.doesNotMatch(l, /edge|proven|signal works/i);
});

test("the Stats tab shows it, and the call type carries the server's snapshot", () => {
  const cards = readFileSync(new URL("../pages/lab/StatsCards.tsx", import.meta.url), "utf8");
  assert.match(cards, /export function LensRecordCard/);
  assert.match(readFileSync(new URL("../pages/lab/AnalyticsView.tsx", import.meta.url), "utf8"), /<LensRecordCard theses=\{theses\} \/>/);
  assert.match(readFileSync(new URL("../pages/lab/types.ts", import.meta.url), "utf8"), /publishLens\?:/);
});
