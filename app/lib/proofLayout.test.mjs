// The /proof reads half, visual-first (proofLayout.mjs + the page): counts from the board's own groups, mean R never
// alone, gates as tracks not progress bars, paper as a count only where a run exists, and the layout wiring.
// Run: node --test app/lib/proofLayout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statusCounts, vsRandom, sideVsRandom, vsRandomText, gateLine, paperRun, leadCards, randomWord, beatSentence, vsRandomCards, RANDOM_WORDS } from "./proofLayout.mjs";
import { baselineVerdict } from "../../workers/nexus-lab-api/backtest.mjs";
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

test("gates are a plain checklist: one sentence each, the number now, fresh coins = the holdout", () => {
  assert.deepEqual(gateLine({ key: "random", label: "beats random entries", now: 22.2, bar: 95, unit: "%", met: false }),
    { key: "random", text: "Does better than 95% of random runs", nowText: "22.2%", met: false });
  assert.deepEqual(gateLine({ key: "random_long", label: "longs vs random longs", now: 4.7, bar: 50, unit: "%" }).text, "Its longs do better than 50% of random long runs");
  assert.deepEqual(gateLine({ key: "events", label: "out-of-sample events", now: 12, bar: 30, unit: "events" }).nowText, "12 so far");
  const r = gateLine({ key: "holdout_r", label: "holdout mean R > 0", now: 0.75, bar: 0, unit: "R", met: true });
  assert.deepEqual([r.text, r.nowText, r.met], ["Averages above 0R on fresh coins too", "+0.75R", true]);
  assert.equal(gateLine({ key: "holdout_random", now: 78.5, bar: 80, unit: "%" }).text, "Does better than 80% of random runs on fresh coins");
  assert.equal(gateLine({ key: "holdout_line", now: null, bar: null, unit: null }).nowText, null, "a step has no number");
  assert.equal(gateLine({ key: "something_new", label: "a new bar", now: 1, bar: 2, unit: "%" }).text, "a new bar", "an unknown bar keeps its served label");
  assert.equal(gateLine(null), null);
});

test("vs random in words: the backtest's own cutoffs; too few under 5 trades; the lead sentence", () => {
  const ladder = { BEATS: "BEATS_RANDOM", LEANS: "LEANS_ABOVE", SAME: "NOT_DISTINGUISHABLE", WORSE: "BELOW_RANDOM" };
  for (const p of [0, 5, 5.1, 50, 79.9, 80, 94.9, 95, 100]) assert.equal(ladder[randomWord(p, 30).key], baselineVerdict(p), `at ${p}%`);
  assert.equal(randomWord(99, 4).key, "FEW");
  assert.equal(randomWord(null, 40).text, RANDOM_WORDS.FEW);
  assert.equal(beatSentence(61.2), "Did better than 61% of random runs.");
  assert.match(beatSentence(null), /Too few/);
});

test("vsRandomCards: each side as a word, best side first, a read with no side at 5+ trades last", () => {
  const rows = [
    { axis: "a", label: "A", sides: { LONG: { n: 91, pct: 99.5, meanR: -0.15, randomR: -0.45 }, SHORT: { n: 27, pct: 11.8, meanR: 0.2, randomR: 0.48 } } },
    { axis: "b", label: "B", sides: { LONG: { n: 2, pct: 100, meanR: -1, randomR: null }, SHORT: null } },
    { axis: "c", label: "C", sides: { LONG: { n: 40, pct: 60, meanR: 0.1, randomR: 0 }, SHORT: { n: 30, pct: 2, meanR: -0.4, randomR: 0.3 } } },
  ];
  const cards = vsRandomCards(rows);
  assert.deepEqual(cards.map((c) => c.axis), ["a", "c", "b"]);
  assert.deepEqual([cards[0].sides.LONG.word.key, cards[0].sides.SHORT.word.key, cards[1].sides.SHORT.word.key], ["BEATS", "SAME", "WORSE"]);
  assert.deepEqual([cards[2].sides.LONG.word.key, cards[2].sides.SHORT.n], ["FEW", 0], "2 trades at 100% is too few, not a win");
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
  assert.deepEqual(c.gates.map((g) => [g.key, g.nowText]), [["random", "0%"], ["random_long", "4.7%"]]);
  assert.equal(c.next, REG_LEAD.next, "the served sentence, word for word");
  assert.equal(c.paper.text, "Paper run: 1 of 30 trades · 1 open");
  assert.equal(leadCards(groups, {})[0].paper.text, "No paper run yet");
  assert.deepEqual(leadCards(null), []);
  // A board cached before `gates` existed: no checklist.
  const [old] = leadCards([{ key: "lead", rows: [{ a: BTC_LEAD_LAG, reg: { ...REG_LEAD, gates: undefined } }] }]);
  assert.deepEqual([old.gates, old.next], [[], REG_LEAD.next]);
});

test("the page: one source for the counts, mean R always beside random, no progress fill on a gate", () => {
  const idx = page("index.tsx"), board = page("SignalBoard.tsx"), cards = page("LeadCards.tsx"), strip = page("ProofStatus.tsx");
  assert.match(board, /export function useBoardGroups\(/);
  assert.match(idx, /useBoardGroups\(scorecard\)/, "the strip and the cards take the board's own groups");
  assert.doesNotMatch(idx, /boardGroups\(/, "no second grouping on the page");
  // Every line that prints a mean R on a card also prints the random entry's.
  for (const line of cards.split("\n").filter((l) => /fmtR\((c\.pooled|v|p)\.meanR\)/.test(l) && !l.includes("title=") && !l.includes('cap: "ITS AVERAGE"'))) {
    assert.match(line, /randomR/, `mean R printed alone: ${line.trim()}`);
  }
  // Plain words (2026-11-21): no rulers or tracks on a card or the vs-random section; the bars are a checklist.
  const chart = page("EngineOverview.tsx");
  for (const src of [cards, chart]) assert.doesNotMatch(src, /rPos\(|chartPct\(|VsRuler|GateTrack|SidePanel/, "no ruler");
  assert.match(cards, /function Check\(/);
  assert.match(cards, /beatSentence\(/);
  assert.match(chart, /vsRandomCards\(rows\)/);
  assert.match(chart, /Every read vs random trades/);
  // The tile with its average always sits next to the random average's tile.
  assert.match(cards, /cap: "ITS AVERAGE"[^\n]*\n\s*\{[^\n]*randomR[^\n]*cap: "RANDOM AVERAGE"/);
  // Visual pass (2026-11-26): the first view is the chip, the sentence and the tiles; the checklist and the sides sit
  // behind one Details tap; the paper run is one small line; one card language with the shelf.
  assert.match(cards, /from "@\/components\/ReadCard"/);
  const det = cards.indexOf("<Details"), chk = cards.indexOf("TO MOVE UP"), sides = cards.indexOf("<SideLine label=\"LONGS\"");
  assert.ok(det > 0 && chk > det && sides > det && cards.indexOf("</Details>") > sides, "checklist + sides inside Details");
  assert.ok(cards.indexOf("<Tiles") < det, "the numbers are never behind the tap");
  assert.doesNotMatch(cards, /Array\.from\(\{ length: target \}/, "no filling paper bar");
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
