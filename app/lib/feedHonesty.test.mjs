// Feed honesty pass (borst 2026-11-28, after /proof): no ungraded scores, no side tallies or crowns, no advice or
// "edge" words, sides in ink (green/red is money). Source checks on what the Feed renders.
// Run: node --test app/lib/feedHonesty.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../pages/feed/", import.meta.url);
const page = (f) => readFileSync(new URL(f, dir), "utf8");
// What the page renders, not what its notes say.
const visible = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const pages = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
const MONEY = /#3ecf8e|#f7525f|C\.pos|C\.neg/;

test("Contested: who is on each side and each side's record, no weighted split, no crown", () => {
  const src = visible(page("Contested.tsx"));
  assert.doesNotMatch(src, /longPct|% split|wt \{weight\}/, "no weighted split bar or % split");
  assert.doesNotMatch(src, /have the record here|avg-R edge/, "no side crowned from callers' records");
  assert.doesNotMatch(src, MONEY, "sides are not money");
  assert.doesNotMatch(src, /sharp callers disagree/);
});

test("Contrarians and the trader card: facts in ink, no 'edge', no 'Fader', no 'Calibrated' badge, no Plan score", () => {
  const c = visible(page("Contrarians.tsx"));
  assert.doesNotMatch(c, /\bedge \{/, "the with-crowd gap isn't an edge");
  assert.doesNotMatch(c, /right when they fade/);
  assert.doesNotMatch(c, MONEY);
  const feed = visible(page("index.tsx"));
  assert.doesNotMatch(feed, /Fader \+/);
  assert.doesNotMatch(feed, /◎ Calibrated/);
  assert.doesNotMatch(feed, /Plan \{trader\.graded\.discipline\.score\}/, "a 0–100 plan blend is a score, not a grade");
  assert.match(feed, /Against the crowd \+/);
  assert.match(feed, /regimeEdge\.best\.calls/, "the 'best regime' slice prints its own average and count");
});

test("no composite score on desk rows; the order is said in words", () => {
  const src = visible(page("Desks.tsx"));
  assert.doesNotMatch(src, /\{d\.score/);
  assert.match(src, /ORDER_LINES\.desks/);
});

test("sides in ink everywhere on the Feed's strips and the copy modal", () => {
  assert.doesNotMatch(visible(page("TakesStrip.tsx")), MONEY, "a take's BULL/BEAR is a side, not money");
  assert.doesNotMatch(visible(page("LiveNow.tsx")), /long \? green : red/);
  assert.doesNotMatch(visible(page("index.tsx")), /thesis\.direction === "LONG" \? "#3ecf8e"/);
});

test("trader profile: no board score, sides and leverage not in money colours", () => {
  const src = visible(readFileSync(new URL("../pages/trader/index.tsx", import.meta.url), "utf8"));
  assert.doesNotMatch(src, /BOARD SCORE/, "agentScore is an ordering blend, not a grade");
  assert.doesNotMatch(src, /thesis\.direction === "LONG" \? "#3ecf8e"/);
  for (const f of [src, visible(page("index.tsx"))]) assert.doesNotMatch(f, /calc\.leverage > 10 \? "#fbbf24" : "#3ecf8e"/, "low leverage isn't money green");
});

test("words: no 'conviction', 'Trending', 'rep', false on-chain timestamp, or 'graded' for the Arena's P&L", () => {
  for (const f of pages) {
    const src = visible(page(f));
    assert.doesNotMatch(src, /\bconviction\b/i, f);
    assert.doesNotMatch(src, /\bproven\b|\+EV|guarantee/i, f);
    assert.doesNotMatch(src, /"Trending"/, `${f}: the sort is by copies, so it says so`);
    assert.doesNotMatch(src, /Build your rep\b/, f);
    assert.doesNotMatch(src, /Timestamped on-chain/, `${f}: a feed publish is stamped by our server, not on-chain`);
  }
  assert.doesNotMatch(visible(page("ArenaStrip.tsx")), /graded by the venue|no graded trades/);
  assert.match(visible(page("index.tsx")), /"Most copied"/);
});
