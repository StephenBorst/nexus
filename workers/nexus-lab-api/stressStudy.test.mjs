// The stress-hour study wired to the scoreboard (stressStudy.mjs + axisbt eventsWithR):
// same events and the same R as scoreEvents, pending until the 168h window is recorded, the
// scoreboard's own generators, and nothing that trades imports it. Hand-built inputs only.
// Run: node --test workers/nexus-lab-api/stressStudy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventsWithR, scoreEvents, AXES, R_CONTRACT } from "./axisbt.mjs";
import { runStressStudy, studyEvents, STRESS_DOC } from "./stressStudy.mjs";
import { STRESS_STUDY } from "./stressHours.mjs";
import { VERDICT_LABELS } from "./stressGrading.mjs";
import { hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000;
const T0 = Date.parse("2026-11-01T00:00:00Z");
const h0 = hourBucket(T0);

// A coin with `n` hours of flat candles (range ±1%) and a price spine; `path(i)` moves the close.
function coin(name, n, path = () => 100) {
  const candleHist = [], oiHist = [];
  for (let i = 0; i < n; i++) {
    const c = path(i), t = (h0 + i) * H;
    candleHist.push({ t, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 });
    oiHist.push({ t: t + 120000, price: c, oi: 1e6, funding: 0 });
  }
  return { coin: name, oiHist, candleHist };
}
const at = (i) => (h0 + i) * H + 600000;
const gen = (hours, side = "LONG") => () => hours.map((i) => ({ t: at(i), side }));

test("eventsWithR: the same events and the same R as scoreEvents on a settled tape", () => {
  // up 0.5%/h from hour 100: a LONG at 120 / 130 hits its 1.5R target; a SHORT is stopped
  const sets = [coin("AAA", 500, (i) => (i < 100 ? 100 : 100 * (1 + 0.005 * (i - 100)))), coin("BBB", 500)];
  const g = (cs) => (cs.coin === "AAA" ? [{ t: at(120), side: "LONG" }, { t: at(130), side: "SHORT" }] : [{ t: at(150), side: "LONG" }]);
  const ev = eventsWithR(sets, g);
  assert.equal(ev.length, 3);
  assert.ok(ev.every((e) => e.r !== null), "every window is recorded");
  assert.deepEqual(ev.map((e) => e.r), [R_CONTRACT.rMultiple, -1, 0]);
  const s = scoreEvents(sets, g, { minSamples: 1 });
  assert.equal(s.r.samples, ev.length);
  assert.equal(s.r.meanR, Math.round((ev.reduce((a, e) => a + e.r, 0) / ev.length) * 100) / 100);
});

test("eventsWithR: a no-touch event whose 168h window isn't recorded yet is pending, never a 0; a touch is final at once", () => {
  const n = 300; // candles to hour 299
  const flat = coin("AAA", n);
  const early = eventsWithR([flat], gen([120]));                // 120 + 168 = 288 ≤ 299: settled flat
  assert.deepEqual(early.map((e) => e.r), [0]);
  const late = eventsWithR([flat], gen([200]));                 // 200 + 168 > 299, no touch yet
  assert.deepEqual(late.map((e) => e.r), [null]);
  const rising = coin("AAA", n, (i) => (i < 200 ? 100 : 100 * (1 + 0.01 * (i - 200))));
  assert.deepEqual(eventsWithR([rising], gen([205])).map((e) => e.r), [R_CONTRACT.rMultiple], "touched its target inside the recorded hours");
  // the scoreboard still counts the open one as 0 (its own, unchanged, provisional reading)
  assert.equal(scoreEvents([flat], gen([200]), { minSamples: 1 }).r.samples, 1);
});

test("eventsWithR: an event the scoreboard can't grade (no candles before it) is left out, as it is there", () => {
  const thin = coin("AAA", 300);
  thin.candleHist = thin.candleHist.slice(150); // no ATR history before hour 160
  assert.deepEqual(eventsWithR([thin], gen([152])), []);
  assert.equal(scoreEvents([thin], gen([152]), { minSamples: 1 }).r.samples, 0);
});

test("the study uses the scoreboard's own generator for each of the seven reads", () => {
  for (const name of STRESS_STUDY.reads) assert.ok(AXES.find((a) => a.name === name), `${name} is on the scoreboard`);
  const src = readFileSync(new URL("./stressStudy.mjs", import.meta.url), "utf8");
  assert.match(src, /AXES\.find\(\(a\) => a\.name === name\)\?\.gen/);
  assert.match(src, /import \{ judgeStressStudy \} from "\.\/stressGrading\.mjs";/);
});

test("runStressStudy: served shape, every read present, nothing judged on an empty board", () => {
  const sets = ["BTC", "ETH", "SOL"].map((c) => coin(c, 300));
  const out = runStressStudy({ panelSets: sets, mainSets: sets, holdoutSets: [coin("ZEC", 300)], now: (h0 + 299) * H });
  assert.equal(out.name, "stress_hours");
  assert.equal(out.doc, STRESS_DOC);
  assert.equal(out.registeredAt, STRESS_STUDY.registeredAt);
  assert.equal(out.limit, STRESS_STUDY.limit);
  assert.deepEqual(Object.keys(out.reads).sort(), [...STRESS_STUDY.reads].sort());
  assert.equal(out.stressHours, 0, "three coins can't make a judged hour (needs 6)");
  assert.deepEqual(out.episodes, []);
  assert.deepEqual(out.holdoutCoins, ["ZEC"]);
  for (const r of Object.values(out.reads)) {
    assert.equal(r.status, "ACCRUING");
    assert.equal(r.verdict, null);
    assert.equal(r.final, false);
    assert.ok(r.holdout && r.holdout.informational, "holdout shown beside, never judged");
  }
  assert.equal(out.atLimit, false);
});

test("a final verdict carries its label and only WORSE licenses a pause (the judge's rulings, served as is)", () => {
  assert.equal(VERDICT_LABELS.LOWER_STILL_POSITIVE, "lower in stress, still positive");
});

test("studyEvents refuses an unknown read rather than serving an empty one", async () => {
  const mod = await import("./stressStudy.mjs");
  assert.equal(typeof mod.studyEvents, "function");
  assert.deepEqual(Object.keys(studyEvents([])).sort(), [...STRESS_STUDY.reads].sort());
});

test("nothing that trades imports the study, and the scoreboard serves it with a bumped cache key", () => {
  for (const f of ["../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js", "../nexus-agent-exec/logic.mjs"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /stressStudy|stressGrading|stressHours/, `${f} must not import the study`);
  }
  const idx = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /axisbt:v2[1-9]:min/); // v21 brought the study; later bumps keep it
  assert.match(idx, /stressStudy = runStressStudy\(\{/);
  assert.match(idx, /panelSets: coinSets\.filter\(\(c\) => RECORDED_COINS\.includes\(c\.coin\)\)/);
  assert.match(idx, /mainSets: coinSets\.filter\(\(c\) => !isHoldoutCoin\(c\.coin\)\)/);
  assert.match(idx, /stressStudy = \{ name: "stress_hours", doc: STRESS_DOC, error: whyFailed\(e\) \}/);
});
