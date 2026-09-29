import test from "node:test";
import assert from "node:assert/strict";
import { splitLabel, rankAxes, takeaway, sideBar, isCompact, AXIS_BLURB } from "./signalCard.mjs";

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
  assert.match(drift.text, /edge doesn’t clear the market’s drift\.$/);
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
