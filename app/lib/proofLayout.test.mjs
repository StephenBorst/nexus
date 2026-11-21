// The /proof reads half, visual-first (proofLayout.mjs + the page): counts from the board's own groups, mean R never
// alone, gates as tracks not progress bars, paper as a count only where a run exists, and the layout wiring.
// Run: node --test app/lib/proofLayout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusCounts, vsRandom, sideVsRandom, vsRandomText, gateTrack, paperRun, leadCards, rPos } from "./proofLayout.mjs";
import { boardGroups } from "./signalCard.mjs";

const page = (f) => readFileSync(new URL(`../pages/proof/${f}`, import.meta.url), "utf8");

// btc_lead_lag as served 2026-11-21 01:53 UTC (GET /intel/axis-backtest): a LEAD at +0.19R that beat 0% of random.
const BTC_LEAD_LAG = {
  name: "btc_lead_lag", label: "BTC impulse, lagging alt follows", verdict: "PREDICTIVE",
  oos: {
    r: { samples: 97, meanR: 0.19, stable: true },
    sides: { LONG: { events: 23, r: { meanR: -1 } }, SHORT: { events: 74, r: { meanR: 0.55 } } },
    random: { pooled: { verdict: "BELOW_RANDOM", pctBeaten: 0, randomMedianR: 0.5 }, bySide: { LONG: { pctBeaten: 4.7, randomMedianR: -0.78 }, SHORT: { pctBeaten: 0.3, randomMedianR: 0.85 } } },
  },
};
const REG_LEAD = {
  axis: "btc_lead_lag", stage: "LEAD", numbers: { events: 97, meanR: 0.19, beatsRandomPct: 0 },
  next: "beat 95% of random entries (now 0%) · longs beat ≥ 50% of random longs (now 4.7%)",
  gates: [{ key: "random", label: "beats random entries", now: 0, bar: 95, unit: "%", met: false }, { key: "random_long", label: "longs vs random longs", now: 4.7, bar: 50, unit: "%", met: false }],
};

test("mean R is never alone: it comes with the random entry's, and +0.19R that beat 0% says so", () => {
  const v = vsRandom(BTC_LEAD_LAG);
  assert.deepEqual(v, { n: 97, meanR: 0.19, randomR: 0.5, pct: 0, verdict: "BELOW_RANDOM" });
  assert.equal(vsRandomText(v), "+0.19R vs +0.50R random · beat 0%");
  assert.deepEqual(sideVsRandom(BTC_LEAD_LAG, "SHORT"), { n: 74, meanR: 0.55, randomR: 0.85, pct: 0.3 });
  assert.equal(sideVsRandom({ oos: { sides: { LONG: { events: 0 } } } }, "LONG"), null);
  assert.equal(vsRandom({ oos: { r: { samples: 0, meanR: 0 } } }), null, "no events = nothing printed");
  assert.equal(vsRandomText({ n: 3, meanR: 0.4, randomR: null, pct: null }), "+0.40R vs — random · too few to compare");
});

test("statusCounts: from the board's own groups; a group the board left out counts 0", () => {
  const axes = [BTC_LEAD_LAG, { name: "t1", label: "t1", oos: null }, { name: "t2", label: "t2" }];
  const reads = [REG_LEAD, { axis: "t1", stage: "REGISTERED", numbers: { events: 4 } }, { axis: "t2", stage: "REGISTERED", numbers: { events: 9 } }];
  const groups = boardGroups(axes, reads, []);
  assert.deepEqual(statusCounts(groups), { cleared: 0, lead: 1, testing: 2 });
  assert.deepEqual(statusCounts(null), { cleared: 0, lead: 0, testing: 0 });
});

test("gates are tracks (a dot now, a tick at the bar), on each gate's own scale; steps are words", () => {
  assert.deepEqual(gateTrack({ key: "random", label: "beats random entries", now: 22.2, bar: 95, unit: "%", met: false }),
    { key: "random", label: "beats random entries", met: false, kind: "track", nowPos: 22.2, barPos: 95, nowText: "22.2%", barText: "95%" });
  const ev = gateTrack({ key: "events", label: "out-of-sample events", now: 12, bar: 30, unit: "events" });
  assert.deepEqual([ev.nowPos, ev.barPos, ev.nowText, ev.barText], [40, 100, "12", "30"]);
  assert.equal(gateTrack({ key: "events", label: "x", now: 45, bar: 30, unit: "events" }).nowPos, 100, "capped");
  const r = gateTrack({ key: "holdout_r", label: "holdout mean R > 0", now: 0.31, bar: 0, unit: "R", met: true });
  assert.deepEqual([r.nowPos, r.barPos, r.nowText, r.barText, r.met], [rPos(0.31), rPos(0), "+0.31R", "> 0R", true]);
  const b = gateTrack({ key: "exit_net", label: "graded exit net", now: -5, bar: 0, unit: "bps" });
  assert.ok(b.nowPos < b.barPos && b.barPos === 50, "below the bar sits left of it");
  assert.deepEqual(gateTrack({ key: "holdout_line", label: "a holdout line", now: null, bar: null, unit: null }).kind, "step");
  assert.equal(gateTrack(null), null);
});

test("paper: a count of 30 where a run exists, 'No paper run yet' where none does; never R or dollars", () => {
  assert.deepEqual(paperRun(null), { state: "none", text: "No paper run yet" });
  assert.equal(paperRun({ unread: true }).text, "Paper run: unread right now");
  assert.deepEqual(paperRun({ wallet: "0x1", count: 6, target: 30, open: true }), { state: "running", count: 6, target: 30, open: true, text: "Paper run: 6 of 30 trades · 1 open" });
  assert.equal(paperRun({ wallet: "0x1", count: 0, target: 30 }).text, "Paper run: 0 of 30 trades", "a run with no closed trade yet is still a run");
});

test("leadCards: the board's lead rows in the board's order, with their gates and paper run", () => {
  const groups = [{ key: "cleared", rows: [] }, { key: "lead", rows: [{ a: BTC_LEAD_LAG, reg: REG_LEAD }] }];
  const [c] = leadCards(groups, { btc_lead_lag: { count: 1, target: 30, open: true } });
  assert.equal(c.axis, "btc_lead_lag");
  assert.equal(c.stage, "LEAD");
  assert.equal(c.events, 97);
  assert.deepEqual(c.pooled.pct, 0);
  assert.deepEqual(c.gates.map((g) => [g.key, g.nowPos, g.barPos]), [["random", 0, 95], ["random_long", 4.7, 50]]);
  assert.equal(c.next, REG_LEAD.next, "the served sentence, word for word");
  assert.equal(c.paper.text, "Paper run: 1 of 30 trades · 1 open");
  assert.equal(leadCards(groups, {})[0].paper.text, "No paper run yet");
  assert.deepEqual(leadCards(null), []);
  // A board cached before `gates` existed: no tracks, the sentence still shows.
  const [old] = leadCards([{ key: "lead", rows: [{ a: BTC_LEAD_LAG, reg: { ...REG_LEAD, gates: undefined } }] }]);
  assert.deepEqual([old.gates, old.next], [[], REG_LEAD.next]);
});

test("the page: one source for the counts, mean R always beside random, no progress fill on a gate", () => {
  const idx = page("index.tsx"), board = page("SignalBoard.tsx"), cards = page("LeadCards.tsx"), strip = page("ProofStatus.tsx");
  assert.match(board, /export function useBoardGroups\(/);
  assert.match(idx, /useBoardGroups\(scorecard\)/, "the strip and the cards take the board's own groups");
  assert.doesNotMatch(idx, /boardGroups\(/, "no second grouping on the page");
  // Every line that prints a mean R on a card also prints the random entry's.
  for (const line of cards.split("\n").filter((l) => /fmtR\((c\.pooled|v)\.meanR\)/.test(l) && !l.includes("title="))) {
    assert.match(line, /randomR/, `mean R printed alone: ${line.trim()}`);
  }
  const gate = cards.slice(cards.indexOf("function GateTrack"), cards.indexOf("function PaperCount"));
  assert.doesNotMatch(gate, /width: `\$\{/, "a gate is a dot and a tick, never a bar that fills");
  assert.match(strip, /isMobile \? \{\} : \{ position: "sticky" as const/, "sticky on desktop only");
  // The order of the reads half, and the bar line kept whole (FeaturedLead prints PROOF_BAR_LINE).
  const order = ["<FeaturedLead", "<ProofStatus", "<LeadCards", "<SideChart", "<PaperWallets", "<SignalBoard", "<PlainWords", "<MarketStats", "<WeeklyScorecard"].map((t) => idx.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "verdict → status → leads → chart → paper → board → folds");
  assert.match(page("FeaturedLead.tsx"), /\{PROOF_BAR_LINE\}/);
  // Still testing stays on the board, behind a tap; the read-by-read table left the overview.
  assert.match(board, /Show the \$\{g\.rows\.length\} still testing/);
  assert.doesNotMatch(page("EngineOverview.tsx"), /function ReadTable/);
  for (const src of [cards, strip]) assert.doesNotMatch(src, /\bproven\b|has an edge|\+EV/i);
});
