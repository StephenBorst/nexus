import test from "node:test";
import assert from "node:assert/strict";
import { splitLabel, rankAxes, takeaway, sideBar, isCompact, AXIS_BLURB, boardGroups, isCleared, BOARD_GROUP_ORDER, randomBar, tideLine } from "./signalCard.mjs";

const axis = (o = {}) => ({
  name: "x", label: "X", verdict: "PREDICTIVE",
  best: { h: 24, samples: 34, hitRate: 59, meanBps: 61.2, stable: false, drift: { excessBps: 35.7 } },
  sides: { LONG: { events: 50, r: { samples: 50, hitRate: 55, meanR: 0.13 } }, SHORT: { events: 0, r: { samples: 0, hitRate: 0, meanR: 0 } } },
  random: { pooled: { verdict: "LEANS_ABOVE", pctBeaten: 86.7, moreTradesNeeded: 81 }, bySide: { LONG: { verdict: "LEANS_ABOVE", pctBeaten: 86.7 }, SHORT: { verdict: "TOO_FEW", n: 0 } } },
  ...o,
});

test("splitLabel keeps the trailing parenthetical apart, nothing else", () => {
  assert.deepEqual(splitLabel("RSI reset <45 (uptrend)"), { main: "RSI reset <45", aside: "(uptrend)" });
  assert.deepEqual(splitLabel("Basis vs usual (two-sided) × CVD divergence"), { main: "Basis vs usual (two-sided) × CVD divergence", aside: "" });
  assert.deepEqual(splitLabel("Follow smart money"), { main: "Follow smart money", aside: "" });
  assert.deepEqual(splitLabel(undefined), { main: "", aside: "" });
});

test("rankAxes: verdict first, then vs-random, then share beaten; stable otherwise", () => {
  const list = [
    axis({ name: "noise", verdict: "NOISE" }),
    axis({ name: "promise", verdict: "PROMISING" }),
    axis({ name: "pred-nd", random: { pooled: { verdict: "NOT_DISTINGUISHABLE", pctBeaten: 60 } } }),
    axis({ name: "pred-lean-low", random: { pooled: { verdict: "LEANS_ABOVE", pctBeaten: 82 } } }),
    axis({ name: "pred-lean-high", random: { pooled: { verdict: "LEANS_ABOVE", pctBeaten: 90 } } }),
    axis({ name: "pred-beats", random: { pooled: { verdict: "BEATS_RANDOM", pctBeaten: 97 } } }),
  ];
  assert.deepEqual(rankAxes(list).map((a) => a.name), ["pred-beats", "pred-lean-high", "pred-lean-low", "pred-nd", "promise", "noise"]);
  assert.deepEqual(rankAxes(null), []);
});

test("takeaway says one-sidedness, the random verdict and the drift, from served numbers only", () => {
  assert.deepEqual(takeaway(axis()), { text: "Long-only in practice · leans above random entries (86.7%), not yet separated, ~81 more events.", tone: "neutral" });
  const beats = takeaway(axis({ sides: { LONG: { events: 5 }, SHORT: { events: 5 } }, random: { pooled: { verdict: "BEATS_RANDOM", pctBeaten: 97 } } }));
  assert.equal(beats.tone, "pos");
  assert.match(beats.text, /^Beats random entries in its window \(97%\)\.$/);
  const worse = takeaway(axis({ random: { pooled: { verdict: "BELOW_RANDOM", pctBeaten: 1.3 } } }));
  assert.equal(worse.tone, "neg");
  const drift = takeaway(axis({ best: { ...axis().best, drift: { excessBps: -2.8 } }, random: { pooled: { verdict: "NOT_DISTINGUISHABLE", pctBeaten: 50 } } }));
  assert.match(drift.text, /its move doesn’t clear the market’s drift\.$/);
  assert.equal(drift.tone, "neg");
  assert.equal(takeaway(axis({ verdict: "INSUFFICIENT" })).text, "Accruing. Not enough history to rate yet.");
  assert.equal(takeaway(null).tone, "neutral");
});

test("sideBar: a side that never fires says so; thin sides aren't drawn as bars", () => {
  const a = axis();
  assert.deepEqual(sideBar(a, "SHORT"), { events: 0, state: "never", label: "never fires" });
  assert.deepEqual(sideBar(a, "LONG"), { events: 50, state: "tested", meanR: 0.13, pct: 86.7, verdict: "LEANS_ABOVE" });
  const thin = axis({ sides: { LONG: { events: 3, r: { samples: 3, meanR: 0.5 } }, SHORT: { events: 0 } }, random: { bySide: { LONG: { verdict: "TOO_FEW", n: 3 } } } });
  assert.equal(sideBar(thin, "LONG").state, "thin");
});

test("isCompact: only reads with a possible edge get the full card", () => {
  assert.equal(isCompact(axis()), false);
  assert.equal(isCompact(axis({ verdict: "PROMISING" })), false);
  assert.equal(isCompact(axis({ verdict: "NOISE" })), true);
  assert.equal(isCompact(axis({ best: null })), true);
});

test("every blurb is a plain description, never a grade", () => {
  for (const [k, v] of Object.entries(AXIS_BLURB)) {
    assert.ok(v.length < 110, k);
    assert.doesNotMatch(v, /strongest|best|proven|edge|winning|reliable/i, k);
  }
});

test("boardGroups: Cleared, Leads, Still testing, then the folds, Archived last; best first by NEW data, never in-sample", () => {
  const list = [
    axis({ name: "top-insample", random: { pooled: { verdict: "BEATS_RANDOM", pctBeaten: 100 } } }),
    axis({ name: "reg-lead-low", verdict: "PROMISING" }),
    axis({ name: "reg-lead-high", verdict: "NOISE" }),
    axis({ name: "reg-edge" }),
    axis({ name: "reg-test-a" }),
    axis({ name: "reg-test-b" }),
    axis({ name: "reg-test-unread" }),
    axis({ name: "worse", verdict: "NOISE", random: { pooled: { verdict: "BELOW_RANDOM", pctBeaten: 1 } } }),
    axis({ name: "noise", verdict: "NOISE", random: { pooled: { verdict: "NOT_DISTINGUISHABLE", pctBeaten: 60 } } }),
    axis({ name: "archived" }),
    axis({ name: "reg-test-failing" }),
  ];
  const n = (pct, events = 40) => ({ beatsRandomPct: pct, events });
  const reads = [
    { axis: "reg-lead-low", stage: "LEAD", numbers: n(40) },
    { axis: "reg-lead-high", stage: "LEAD", numbers: n(90) },
    { axis: "reg-edge", stage: "EDGE", numbers: n(10) },
    { axis: "reg-test-a", stage: "REGISTERED", numbers: n(55, 12) },
    { axis: "reg-test-b", stage: "REGISTERED", numbers: n(80, 9) },
    { axis: "reg-test-unread", stage: "REGISTERED", numbers: n(null, 0) },
    { axis: "archived", stage: "REGISTERED", numbers: n(70, 120) },
    { axis: "reg-test-failing", stage: "REGISTERED", numbers: n(99, 118), failing: ["main card: 118 events, mean R 0"] },
    { axis: "not-on-board", stage: "EDGE" },
  ];
  const g = boardGroups(list, reads, ["archived"]);
  assert.deepEqual(g.map((x) => x.key), ["cleared", "lead", "testing", "history", "below", "archived"]);
  assert.deepEqual(g[0].rows, [], "nothing cleared: the group is still there, empty, so the page can say so");
  // The furthest stage first, then the share of random entries beaten on NEW data. The in-sample verdict plays no part:
  // the NOISE-graded lead with 90% on new data sits above the PROMISING one with 40%.
  assert.deepEqual(g[1].rows.map((r) => r.a.name), ["reg-edge", "reg-lead-high", "reg-lead-low"]);
  assert.deepEqual(g[2].rows.map((r) => r.a.name), ["reg-test-b", "reg-test-a", "reg-test-unread", "reg-test-failing"], "unread new-data share goes last; a failing read after it, whatever its share");
  assert.deepEqual(g[3].rows.map((r) => r.a.name), ["top-insample", "noise"], "the best in-sample number never tops the board");
  assert.deepEqual(g[4].rows.map((r) => r.a.name), ["worse"]);
  assert.deepEqual(g[5].rows.map((r) => r.a.name), ["archived"]);
  assert.equal(g.reduce((k, x) => k + x.rows.length, 0), list.length, "every read on the board appears exactly once");
  assert.deepEqual(BOARD_GROUP_ORDER, ["cleared", "lead", "testing", "history", "below", "archived"]);
  // A served RETIRED (a board from before 2026-11-20) is not a group: it lands nowhere special, never in Cleared.
  assert.ok(!boardGroups(list, [{ axis: "reg-edge", stage: "RETIRED" }]).some((x) => x.key === "cleared" && x.rows.length));
});

test("CLEARED needs the full ladder: Tradeable or Paper, no promotion lock, and a recorded 30-trade paper PASS", () => {
  const reg = (stage, axis = "r") => ({ axis, stage, numbers: { beatsRandomPct: 97, events: 60 } });
  // badge bar v2 (signed 2026-11-20): the PASS must also beat ≥ 90% of 300 matched random entries
  const pass = { recorded: true, verdict: "PASS", randomCheck: { verdict: "BEAT", pctBeaten: 94 } };
  assert.equal(isCleared(reg("PAPER"), pass), true);
  assert.equal(isCleared(reg("PAPER"), { recorded: true, verdict: "PASS" }), false, "a PASS with no random check isn't cleared");
  assert.equal(isCleared(reg("PAPER"), { recorded: true, verdict: "PASS", randomCheck: { verdict: "DIDNT_BEAT", pctBeaten: 71 } }), false, "a PASS that didn't beat random isn't cleared");
  assert.equal(isCleared(reg("PAPER"), { recorded: true, verdict: "PASS", randomCheck: { verdict: "UNREAD", usable: 200 } }), false, "an unread check makes the badge wait");
  assert.equal(isCleared(reg("PAPER"), { recorded: true, verdict: "PASS", random: "BEAT" }), true, "the /proof hook's slim shape");
  assert.equal(isCleared(reg("TRADEABLE"), pass), true);
  assert.equal(isCleared(reg("EDGE"), pass), false, "a paper PASS without the scoreboard ladder is not a clear");
  assert.equal(isCleared(reg("LEAD"), pass), false);
  assert.equal(isCleared(reg("REGISTERED"), pass), false, "a read that fell back keeps its paper verdict but loses the badge");
  assert.equal(isCleared(reg("PAPER"), { recorded: false, verdict: "ACCRUING" }), false);
  assert.equal(isCleared(reg("PAPER"), { recorded: true, verdict: "FAIL" }), false);
  assert.equal(isCleared(reg("PAPER"), { recorded: false, verdict: "PASS" }), false, "only a RECORDED verdict counts");
  assert.equal(isCleared(reg("PAPER"), pass, { r: { lostStage: "PAPER" } }), false, "a promotion lock holds the badge back");
  assert.equal(isCleared(reg("PAPER"), null), false);
  assert.equal(isCleared({ ...reg("PAPER"), failing: ["holdout: 100 events, mean R -0.1"] }, pass), false, "the 100-event label holds the badge back");
  assert.equal(isCleared({ ...reg("PAPER"), failing: null }, pass), true, "and the badge comes back with the numbers");
  const list = [axis({ name: "r" }), axis({ name: "s" })];
  const g = boardGroups(list, [reg("PAPER", "r"), reg("PAPER", "s")], [], { judgments: { r: pass, s: { recorded: false, verdict: "ACCRUING" } } });
  assert.deepEqual(g.find((x) => x.key === "cleared").rows.map((x) => x.a.name), ["r"]);
  assert.deepEqual(g.find((x) => x.key === "lead").rows.map((x) => x.a.name), ["s"], "on paper but not judged yet = a lead");
});

test("boardGroups: an archive is by hand only (the list passed in), whatever stage is served", () => {
  const list = [axis({ name: "gone" }), axis({ name: "live" })];
  const reads = [{ axis: "gone", stage: "REGISTERED" }, { axis: "live", stage: "REGISTERED" }];
  const g = boardGroups(list, reads, ["gone"]);
  assert.deepEqual(g.map((x) => x.key), ["cleared", "testing", "archived"]);
  assert.deepEqual(g[1].rows.map((r) => r.a.name), ["live"]);
  assert.deepEqual(g[2].rows.map((r) => r.a.name), ["gone"]);
});

test("boardGroups: no pipeline served → the archive only, plus the (empty) Cleared group; nothing read = just that", () => {
  const g = boardGroups([axis({ name: "a" })], undefined);
  assert.deepEqual(g.map((x) => x.key), ["cleared", "history"]);
  assert.deepEqual(boardGroups(null, null).map((x) => x.key), ["cleared"]);
});

test("randomBar: thin baselines aren't drawn as bars", () => {
  assert.deepEqual(randomBar(axis({ random: { pooled: { verdict: "TOO_FEW", n: 3 } } })), { state: "thin", label: "too few to test" });
  assert.deepEqual(randomBar(axis({ random: { pooled: { verdict: "BELOW_RANDOM", pctBeaten: -2 } } })), { state: "tested", pct: 0, verdict: "BELOW_RANDOM" });
  assert.equal(randomBar({}).state, "thin");
});

test("sideBar carries the random entry's R beside the read's, so a side riding the market reads as such", () => {
  // level_reclaim's out-of-sample shorts on 2026-11-16: +0.15R, a random short +0.44R, beat 13.2%.
  const a = { sides: { SHORT: { events: 26, r: { samples: 26, meanR: 0.15 } } }, random: { bySide: { SHORT: { verdict: "NOT_DISTINGUISHABLE", n: 26, pctBeaten: 13.2, randomMedianR: 0.44 } } } };
  assert.deepEqual(sideBar(a, "SHORT"), { events: 26, state: "tested", meanR: 0.15, pct: 13.2, verdict: "NOT_DISTINGUISHABLE", randomR: 0.44 });
});

test("tideLine: the board's tide in plain words, nothing when unread", () => {
  const t = tideLine({ from: "2026-08-07T16:00:00.000Z", to: "2026-11-16T07:00:00.000Z", markets: 12, LONG: { n: 18390, meanR: -0.18 }, SHORT: { n: 18390, meanR: 0.2 } });
  assert.deepEqual(t, { since: "Aug 7", long: -0.18, short: 0.2, rule: "Each side has to beat its own random entry, not zero." });
  assert.equal(tideLine(null), null);
  assert.equal(tideLine({ from: "2026-08-07T16:00:00Z", LONG: { meanR: null }, SHORT: { meanR: 0.2 } }), null, "a missing side is unread, never 0");
  assert.doesNotMatch(t.rule, /edge|proven/i);
});

test("the board layout is the signed rule's (pipeline-if-then.md, borst 2026-11-17): CLEARED, the full ladder, never 'proven'", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../docs/research/pipeline-if-then.md", import.meta.url), "utf8");
  const sec = page.slice(page.indexOf("**Board layout and the CLEARED badge**"), page.indexOf("## Stacks")).replace(/\s+/g, " ");
  assert.ok(sec.length > 200, "the section is on the page, above Stacks");
  for (const w of ["**Cleared**", "**Leads**", "**Still testing**", "**Retired** last", "full ladder", "no promotion lock",
    "recorded PASS", "Nothing has cleared yet.", "never \"proven\"", "Only a CLEARED read may be marketed or promoted",
    "Never an in-sample number", "signed page"]) assert.ok(sec.includes(w), w);
  const board = readFileSync(new URL("../pages/proof/SignalBoard.tsx", import.meta.url), "utf8");
  assert.match(board, /const NOTHING_CLEARED = "Nothing has cleared yet\.";/);
  assert.match(board, /boardGroups\(scorecard\?\.axes, reads, Object\.keys\(ARCHIVED_READS\), \{ judgments, locks: PROMOTION_LOCKS \}\)/);
  assert.doesNotMatch(board, /\bproven\b/i);
});
