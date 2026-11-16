// Batch-5 explorer DRAFTS (docs/research/scanner-reads-prereg.md). Not registered: never on the scoreboard, behaviour
// on hand-built tapes, no lookahead. Run: node --test workers/nexus-lab-api/explorerDrafts5.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRAFT_GENS_5, DRAFT_READS_5, shelfBreakdownShortEvents, bbRsiMomentumEvents, trend4hByHour, rsiByHour } from "./explorerDrafts5.mjs";
import { AXES } from "./axisbt.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 6, 0, 0, 0);   // a Monday 00:00 UTC
const bar = (i, c, x = {}) => ({ t: T0 + i * H, o: c, h: c + 0.5, l: c - 0.5, c, v: 100, ...x });

test("drafts are not graded: off the scoreboard, unregistered, and nothing else imports them", () => {
  const graded = new Set(AXES.map((a) => a.name)), registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const n of Object.keys(DRAFT_GENS_5)) {
    assert.ok(!graded.has(n), `${n} is on the scoreboard before it is registered`);
    assert.ok(!registered.has(n), `${n} is registered: move it out of the drafts file in the registration PR`);
  }
  for (const f of ["./axisbt.mjs", "./index.js", "./explorerReads.mjs", "../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /explorerDrafts5/, `${f} must not import the drafts`);
  }
  assert.deepEqual(DRAFT_READS_5.map((r) => r.name), ["shelf_breakdown_short", "bb_rsi_momentum"]);
});

// A falling tape (300 → 240 over 600h), then flat at 240 with one low at 230 twenty hours before the break bar K, a
// weekday 10:00 UTC bar. The 4h trend is DOWN (240 sits under the lagging EMA).
function shelfTape(over = {}) {
  const K = (() => { let k = 660; while (new Date(T0 + k * H).getUTCHours() !== 10 || [0, 6].includes(new Date(T0 + k * H).getUTCDay())) k++; return k; })();
  const rows = [];
  for (let i = 0; i < 600; i++) rows.push(bar(i, 300 - i * 0.1));
  for (let i = 600; i < K; i++) rows.push(bar(i, 240, { l: 239.5 }));
  rows[K - (over.shelfAgo ?? 20)] = bar(K - (over.shelfAgo ?? 20), 240, { l: 230 });
  rows.push(bar(K, over.close ?? 229, { l: 228, v: over.vol ?? 300 }));
  for (let i = K + 1; i < K + 30; i++) rows.push(bar(i, 229));
  return { K, rows };
}

test("shelf_breakdown_short: a 1h close under a 24h shelf untouched 12h, on 1.5× volume, in session, 4h down → SHORT", () => {
  const { K, rows } = shelfTape();
  assert.equal(trend4hByHour(new Map(rows.map((r) => [Math.floor(r.t / H), r]))).get(Math.floor((T0 + K * H) / H)), "DOWN");
  const ev = shelfBreakdownShortEvents({ candleHist: rows });
  assert.deepEqual(ev.filter((e) => e.t <= T0 + (K + 1) * H), [{ t: T0 + (K + 1) * H, side: "SHORT" }]);
});

test("shelf_breakdown_short: each gate stops it", () => {
  const at = (o) => { const { K, rows } = shelfTape(o); return shelfBreakdownShortEvents({ candleHist: rows }).some((e) => e.t === T0 + (K + 1) * H); };
  assert.equal(at({ vol: 140 }), false, "volume 1.4× the average");
  assert.equal(at({ shelfAgo: 6 }), false, "shelf touched 6h ago, not 12");
  assert.equal(at({ close: 231 }), false, "closed above the shelf");
  const { K, rows } = shelfTape();
  const up = rows.map((r, i) => (i < 600 ? bar(i, 180 + i * 0.1) : r));   // rising into the flat: 4h trend UP
  assert.equal(shelfBreakdownShortEvents({ candleHist: up }).some((e) => e.t === T0 + (K + 1) * H), false, "4h trend not down");
  const shifted = rows.map((r) => ({ ...r, t: r.t + 14 * H }));          // same bars, the break lands at 00:00 UTC
  assert.equal(shelfBreakdownShortEvents({ candleHist: shifted }).some((e) => e.t === T0 + (K + 15) * H), false, "out of session");
});

// A steady climb (h/l ±0.5), then one bar that jumps above its 20/2 band with RSI at 100.
function momoTape(jump) {
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push(bar(i, 100 + i * 0.1));
  rows.push(bar(400, 100 + 400 * 0.1 + jump));
  for (let i = 401; i < 420; i++) rows.push(bar(i, 100 + 400 * 0.1 + jump));
  return rows;
}

test("bb_rsi_momentum: a close above the 20/2 band with RSI-14 > 60 in a 4h uptrend → LONG; a burst is skipped", () => {
  const at = (jump) => bbRsiMomentumEvents({ candleHist: momoTape(jump) }).filter((e) => e.t === T0 + 401 * H);
  assert.deepEqual(at(1), [{ t: T0 + 401 * H, side: "LONG" }]);
  assert.deepEqual(at(5), [], "the last 3h range is over 2× the prior 24h average");
  assert.deepEqual(bbRsiMomentumEvents({ candleHist: momoTape(0) }).filter((e) => e.t <= T0 + 400 * H), [], "a steady climb stays inside the band");
  const down = momoTape(1).map((r, i) => (i < 400 ? bar(i, 300 - i * 0.1 + (i > 380 ? (i - 380) * 0.4 : 0)) : r));
  assert.ok(!bbRsiMomentumEvents({ candleHist: down }).some((e) => e.side === "LONG" && e.t === T0 + 401 * H), "no long against a 4h downtrend");
});

test("RSI is Wilder's, and a missing hour restarts its warm-up", () => {
  const hm = new Map(Array.from({ length: 30 }, (_, i) => [i, { c: 100 + i, h: 0, l: 0 }]));
  assert.equal(rsiByHour(hm).get(14), 100);
  assert.equal(rsiByHour(hm).has(13), false);
  hm.delete(20);
  assert.equal(rsiByHour(hm).has(30), false, "15 bars after the gap are needed again");
});

test("no lookahead: events on a cut tape are the full tape's events up to the cut", () => {
  let s = 11 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100;
  const rows = Array.from({ length: 2400 }, (_, i) => {
    const o = p; p *= 1 + (rnd() - 0.5) * 0.02 + (rnd() < 0.03 ? (rnd() - 0.6) * 0.06 : 0);
    return { t: T0 + i * H, o, h: Math.max(o, p) * (1 + rnd() * 0.004), l: Math.min(o, p) * (1 - rnd() * 0.004), c: p, v: 50 + rnd() * 200 * (rnd() < 0.1 ? 4 : 1) };
  });
  for (const gen of Object.values(DRAFT_GENS_5)) {
    const full = gen({ candleHist: rows });
    for (const cut of [1200, 1800, 2399]) {
      const part = gen({ candleHist: rows.slice(0, cut + 1) });
      assert.deepEqual(part, full.filter((e) => e.t <= T0 + (cut + 1) * H));
    }
  }
});
