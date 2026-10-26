// strategyShelf: Load only at PAPER with a preset that trades the rule; every other row says why.
// Run: node --test app/lib/strategyShelf.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shelfRows, etaAtPace, countNeeded, SHELF_PRESETS } from "./strategyShelf.mjs";

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

test("nothing loads before Paper; each row says why", () => {
  const rows = shelfRows(sc([
    reg("a", "REGISTERED", "20 more out-of-sample events"),
    reg("b", "LEAD", "21 more holdout events", { holdoutEvents: 9 }),
    reg("c", "EDGE", "26 more graded-exit trades", { exitTrades: 4 }),
    reg("d", "TRADEABLE", "a paper wallet (borst sets it up)"),
  ]), NOW);
  for (const r of rows) { assert.equal(r.canLoad, false, r.id); assert.match(r.reason, /\S/, r.id); }
  assert.deepEqual(rows.map((r) => r.id).slice(0, 4), ["d", "c", "b", "a"], "closest to Paper first");
  assert.match(rows.find((r) => r.id === "a").eta, /^~Nov 13 at today's pace$/); // 10 in 9d → 20 more ≈ 18d
});

test("Paper with no preset still doesn't load; Paper with one does", () => {
  const [r] = shelfRows(sc([reg("x", "PAPER", "")], []), NOW);
  assert.equal(r.canLoad, false);
  assert.match(r.reason, /no agent preset/);
  assert.deepEqual(SHELF_PRESETS, {}, "no read has an agent rule yet — a mapping is its own reviewed PR");
});

test("a failing read says so, with its retirement count date; retired sorts last", () => {
  const rows = shelfRows(sc([reg("f", "REGISTERED", "mean R > 0 with both halves agreeing", { events: 40 }), reg("r", "RETIRED", null), reg("a", "REGISTERED", "5 more out-of-sample events")], []), NOW);
  const f = rows.find((x) => x.id === "f");
  assert.equal(f.stageWord, "Failing");
  assert.match(f.need, /Retired at 100 events unless it recovers/);
  assert.match(f.eta, /^100 events ~/);
  const reads = rows.filter((x) => x.kind === "read");
  assert.equal(reads.at(-1).id, "r");
  assert.match(reads.at(-1).reason, /never loads/);
  assert.equal(rows.at(-1).stage, "RETIRED", "retired rows (the read + the retired graded exit) sort last");
});

test("the retired graded exit stays Retired even if the read grades PREDICTIVE again", () => {
  for (const verdict of ["PREDICTIVE", "PROMISING"]) {
    const row = shelfRows(sc([], [ex({ verdict })]), NOW).find((r) => r.kind === "exit");
    assert.equal(row.stage, "RETIRED");
    assert.equal(row.stageWord, "Retired");
    assert.equal(row.canLoad, false);
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
