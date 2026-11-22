// strategyShelf: every row loads on paper at its exact rule, whatever its stage (borst 2026-11-22); grades stay shown.
// Run: node --test app/lib/strategyShelf.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shelfRows, etaAtPace, countNeeded, shelfConfig, shelfButtonLabel, BASIS_CVD_GRADED_PAPER } from "./strategyShelf.mjs";
import { readPaperConfig, housePaperConfig, HOUSE_PAPER_IDS } from "./housePaper.mjs";
import { REGISTERED_READS } from "./readPipeline.mjs";
import { gradedExitRefusal } from "./gradedExit.mjs";
import { BRAIN_READS, registeredReadRefusal } from "../../workers/nexus-lab-api/registeredReadLive.mjs";

const NOW = Date.parse("2026-10-26T00:00:00Z"); // 9 days after the Oct 17 registrations
const reg = (axis, stage, next, numbers = {}) => ({ axis, stage, next, registeredAt: "2026-10-17T00:00:00Z", numbers: { events: 10, ...numbers } });
const ex = (o = {}) => ({ name: "basis_x_cvd", label: "Basis extreme × CVD divergence", verdict: "PREDICTIVE", exitGraded: { oos: { samples: 4, netBps: 44.9 } }, random: { bySide: { LONG: { pctBeaten: 96, verdict: "BEATS_RANDOM" } } }, ...o });
const sc = (reads, axes = [ex()]) => ({ pipeline: { reads, rules: { killEvents: 100 } }, axes });

test("pace + count parsing", () => {
  assert.equal(etaAtPace(9, 9, NOW - 9 * 86400000, NOW), NOW + 9 * 86400000);
  assert.equal(etaAtPace(0, 5, NOW - 9 * 86400000, NOW), null);
  assert.equal(etaAtPace(5, 5, NOW - 3600000, NOW), null, "under a day of data: no date");
  assert.deepEqual(countNeeded("20 more out-of-sample events"), { more: 20, counter: "events" });
  assert.deepEqual(countNeeded("beat 95% of random entries (now 70%) · 21 more holdout events"), { more: 21, counter: "holdoutEvents" });
  assert.deepEqual(countNeeded("26 more graded-exit trades"), { more: 26, counter: "exitTrades" });
  assert.equal(countNeeded("mean R > 0 with both halves agreeing"), null);
});

test("every stage loads, on paper; closest to Paper first", () => {
  const rows = shelfRows(sc([
    reg("rsi_reset_deep", "REGISTERED", "20 more out-of-sample events"),
    reg("session_fade", "LEAD", "21 more holdout events", { holdoutEvents: 9 }),
    reg("spot_absorb", "EDGE", "26 more graded-exit trades", { exitTrades: 4 }),
    reg("btc_lead_lag", "TRADEABLE", "a paper wallet (borst sets it up)"),
    reg("level_reclaim", "PAPER", ""),
    { ...reg("session_momentum", "REGISTERED", "mean R > 0 with both halves agreeing", { events: 140 }), failing: ["main card: 140 events, mean R −0.1"] },
  ]), NOW);
  for (const r of rows) {
    assert.equal(r.canLoad, true, r.id);
    assert.equal(shelfButtonLabel(r), "Load on paper");
    const c = shelfConfig(r);
    assert.equal(c.mode, "PAPER", r.id);
    assert.equal(c.invertSignal, false, r.id);
    assert.equal(gradedExitRefusal(c, true), null, `${r.id}: the graded exit, nothing on top`);
    assert.notEqual(gradedExitRefusal({ ...c, mode: "AUTONOMOUS" }, false), null, `${r.id}: never live by an edit`);
    assert.match(r.reason, /on paper/);
  }
  assert.deepEqual(rows.map((r) => r.id).slice(0, 5), ["level_reclaim", "btc_lead_lag", "spot_absorb", "session_fade", "rsi_reset_deep"]);
  assert.match(rows.find((r) => r.id === "rsi_reset_deep").eta, /^~Nov 13 at today's pace$/); // 10 in 9d → 20 more ≈ 18d
  assert.equal(rows.find((r) => r.id === "session_momentum").stageWord, "Failing", "a failing read loads, labelled");
});

test("a read loads at its exact rule: the house run's config, which the brain runs on paper only", () => {
  for (const { axis } of REGISTERED_READS) {
    assert.ok(BRAIN_READS.includes(axis), `${axis}: the brain runs every registered read`);
    const c = shelfConfig({ kind: "read", id: axis });
    assert.deepEqual(c, { ...readPaperConfig(axis), mode: "PAPER", invertSignal: false });
    assert.equal(c.signalMode, "REGISTERED_READ");
    assert.equal(c.read, axis);
    assert.equal(registeredReadRefusal(c), null);
    assert.match(registeredReadRefusal({ ...c, mode: "AUTONOMOUS" }), /paper only/);
    if (HOUSE_PAPER_IDS[axis]) assert.deepEqual(readPaperConfig(axis), housePaperConfig(axis), "a user's run = the house run's config");
  }
  assert.equal(shelfConfig({ kind: "read", id: "not_a_read" }), null, "an unknown axis loads nothing");
});

test("the Basis × CVD rows load the basis fade with CVD confirm on the graded exit", () => {
  const rows = shelfRows(sc([]), NOW).filter((r) => r.kind !== "read");
  assert.equal(rows.length, 2);
  for (const r of rows) {
    const c = shelfConfig(r);
    assert.equal(c.signalMode, "BASIS_FADE");
    assert.equal(c.basisConfirm, "CVD");
    assert.equal(c.exitContract, "R_CONTRACT");
    assert.deepEqual(c.symbols, [...BASIS_CVD_GRADED_PAPER.symbols]);
    assert.equal(r.canLoad, true);
  }
});

test("each read row carries its grade in plain words", () => {
  const [a] = shelfRows(sc([reg("session_fade", "LEAD", "", { events: 40, beatsRandomPct: 61 })], []), NOW);
  assert.equal(a.grade.line, "40 new-data trades. Beat random trades 61% of the time.");
  assert.match(a.grade.word, /\S/);
  const [b] = shelfRows(sc([reg("session_fade", "REGISTERED", "", { events: 2 })], []), NOW);
  assert.equal(b.grade.line, "2 new-data trades. Too few to compare with random yet.");
});

test("a failing read says so, with the date it reaches the 100-event check; the labelled one sorts with the failing", () => {
  const lab = { ...reg("l", "REGISTERED", "mean R > 0 with both halves agreeing", { events: 118 }), failing: ["main card: 118 events, mean R 0"] };
  const rows = shelfRows(sc([reg("f", "REGISTERED", "mean R > 0 with both halves agreeing", { events: 40 }), lab, reg("a", "REGISTERED", "5 more out-of-sample events")], []), NOW);
  const f = rows.find((x) => x.id === "f");
  assert.equal(f.stageWord, "Failing");
  assert.match(f.need, /Labelled failing at 100 events unless it recovers/);
  assert.match(f.eta, /^100 events ~/);
  const l = rows.find((x) => x.id === "l");
  assert.equal(l.stageWord, "Failing");
  assert.doesNotMatch(l.need, /Retired/);
  const reads = rows.filter((x) => x.kind === "read");
  assert.equal(reads[0].id, "a", "the counting read first, the failing ones after");
  assert.equal(rows.at(-1).stage, "RETIRED", "the retired graded exit (its own bar, unchanged) sorts last");
});

test("the retired graded exit stays Retired even if the read grades PREDICTIVE again", () => {
  for (const verdict of ["PREDICTIVE", "PROMISING"]) {
    const row = shelfRows(sc([], [ex({ verdict })]), NOW).find((r) => r.kind === "exit");
    assert.equal(row.stage, "RETIRED");
    assert.equal(row.stageWord, "Retired");
    assert.equal(row.canLoad, true, "retired still loads on paper (2026-11-22)");
    assert.match(row.note, /^Retired Oct 26, 2026: the read fell to PROMISING, below PREDICTIVE\./);
  }
});

test("unreadable scorecard → empty shelf, never invented rows", () => {
  assert.deepEqual(shelfRows(null), []);
  assert.deepEqual(shelfRows({ axes: [] }), []);
});

test("names come from the scoreboard's labels", () => {
  const [r] = shelfRows(sc([reg("rsi_reset_deep", "REGISTERED", "20 more out-of-sample events")], [{ name: "rsi_reset_deep", label: "RSI reset <45 (uptrend)" }]), NOW);
  assert.equal(r.name, "RSI reset <45 (uptrend)");
});

test("the copy never calls a shelf row an edge or proven before it is", () => {
  const src = readFileSync(new URL("./strategyShelf.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /\b(proven|validated|guaranteed)\b/i);
});

import { regimeFromMs as rwFrom, regimeLimitMs as rwLimit } from "./regimeWindow.mjs";

const rwSc = ({ trades = 6, net = 10, counts = { UP: 4, DOWN: 1, FLAT: 2 } } = {}) => ({
  pipeline: { reads: [], rules: { killEvents: 100 } },
  axes: [{ name: "basis_x_cvd", verdict: "PROMISING", regimeWindow: { exitGraded: { samples: trades, netBps: net }, r: { samples: 40, meanR: 0.2, stable: true }, random: { bySide: { LONG: { pctBeaten: 96 } } } } }],
  holdout: { axes: [{ name: "basis_x_cvd", regimeWindow: { r: { samples: 30, meanR: 0.1 }, random: { bySide: { LONG: { pctBeaten: 85 } } } } }] },
  regimeWindow: { regime: { counts, missing: 0 } },
});
const rwRow = (sc, now) => shelfRows(sc, now).find((r) => r.kind === "test");

test("regime window row: counts from its date, then trades + regime days; loads on paper like the graded exit", () => {
  const pre = rwRow(rwSc({ trades: 0 }), rwFrom() - 3600e3);
  assert.equal(pre.stageWord, "Testing");
  assert.equal(pre.note, "Counts from Oct 27.");
  assert.equal(pre.canLoad, true);
  const mid = rwRow(rwSc(), rwFrom() + 12 * 86_400_000);
  assert.match(mid.need, /^24 more counted trades and the regime condition/);
  assert.match(mid.note, /UP 4 · DOWN 1 · FLAT 2 days/);
  assert.match(mid.eta, /^30 trades ~/);
});

test("regime window row: a judgment on today's numbers is shown, final only once recorded; an unread board says so", () => {
  const judged = rwRow(rwSc({ trades: 31, net: -2 }), rwLimit());
  assert.equal(judged.stageWord, "Failed its bar");
  assert.match(judged.note, /Final once recorded/);
  const unread = rwRow({ ...rwSc(), regimeWindow: { regime: { error: "x" } } }, rwFrom() + 86_400_000);
  assert.match(unread.note, /couldn't be read/);
  assert.equal(unread.canLoad, true, "an unread board doesn't block the paper load: the rule is the same");
});

test("the shelf copy: on paper, stage beside it, no old gate words (2026-11-22)", () => {
  assert.equal(shelfButtonLabel(null), "Can’t load");
  const src = readFileSync(new URL("./strategyShelf.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Loads only at Paper|loads once the strategy itself reaches Paper|never loads/);
  const ui = readFileSync(new URL("../pages/lab/StrategyShelf.tsx", import.meta.url), "utf8");
  assert.match(ui, /every strategy loads on paper/);
  assert.match(ui, /CLEARED/, "the one thing still gated is named");
  const agent = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.match(agent, /hasPosition && config\.mode !== "PAPER"/, "never loaded over a live position");
  assert.match(agent, /mode: "PAPER", invertSignal: false \}\)\)/, "Load forces paper, as registered");
});
