// Fill price of the shared exit walker (stepExit) — measurement change 2026-10-31
// (docs/research/level-reclaim-exit-gap.md, logged in docs/research/read-pipeline.md). An exit fills
// at its own level, as the live exec closes at the market within a minute of the mark crossing it;
// a bar that opens past the level fills at the open (a gap); a timeout closes at its bar's open.
// Run: node --test workers/nexus-lab-api/backtest.fill.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { openPosition, stepExit, closedPnlPct } from "./backtest.mjs";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const bar = (o, h, l, c) => ({ t: 0, o, h, l, c });
const pos = (cfg, dir = "LONG") => openPosition(cfg, dir, 100, 0);
const CFG = { tpPercent: 3, slPercent: 2, maxHoldHours: 24 };
const H = 3600e3;

test("a stop crossed inside the bar fills at the stop, not at the bar's low", () => {
  const p = pos(CFG);
  const hit = stepExit(p, bar(100, 100.5, 90, 95), H, CFG);
  assert.equal(hit.reason, "SL");
  close(closedPnlPct(p, hit.px), -2);
});

test("a bar that opens past the stop fills at the open (a gap), worse than the stop", () => {
  const p = pos(CFG);
  const hit = stepExit(p, bar(96, 97, 90, 95), H, CFG);
  assert.equal(hit.reason, "SL");
  close(closedPnlPct(p, hit.px), -4);
});

test("a target fills at the target, not at the bar's high; a gap past it fills at the open", () => {
  const p = pos(CFG);
  const hit = stepExit(p, bar(100, 110, 99.5, 105), H, CFG);
  assert.equal(hit.reason, "TP");
  close(closedPnlPct(p, hit.px), 3);
  const g = pos(CFG);
  const gap = stepExit(g, bar(104, 110, 103.5, 105), H, CFG);
  close(closedPnlPct(g, gap.px), 4);
});

test("SHORT: the stop and the target fill at their levels", () => {
  const s = pos(CFG, "SHORT");
  const sl = stepExit(s, bar(100, 108, 99.5, 101), H, CFG);
  assert.equal(sl.reason, "SL");
  close(closedPnlPct(s, sl.px), -2);
  const t = pos(CFG, "SHORT");
  const tp = stepExit(t, bar(100, 100.2, 90, 95), H, CFG);
  assert.equal(tp.reason, "TP");
  close(closedPnlPct(t, tp.px), 3);
});

test("a bar touching both: still the stop (adverse first), at the stop", () => {
  const p = pos(CFG);
  const hit = stepExit(p, bar(100, 110, 90, 100), H, CFG);
  assert.equal(hit.reason, "SL");
  close(closedPnlPct(p, hit.px), -2);
});

test("a timeout closes at the open of its bar, not at the bar's adverse extreme", () => {
  const p = pos(CFG);
  const hit = stepExit(p, bar(101, 101.5, 99, 100.5), 24 * H, CFG);
  assert.equal(hit.reason, "TIMEOUT");
  close(closedPnlPct(p, hit.px), 1);
});

test("trailing stop fills at the trail level", () => {
  const cfg = { ...CFG, tpPercent: 50, trailingStopPct: 1, trailActivatePct: 2 };
  const p = pos(cfg);
  assert.equal(stepExit(p, bar(100, 104, 99.8, 103.8), H, cfg), null); // peak +4% → trail at +3%
  const hit = stepExit(p, bar(103.8, 103.9, 101, 101.5), 2 * H, cfg);
  assert.equal(hit.reason, "TRAIL");
  close(closedPnlPct(p, hit.px), 3);
});

test("breakeven stop fills at the breakeven level", () => {
  const cfg = { ...CFG, tpPercent: 10, breakevenTriggerPct: 1.5, breakevenBufferPct: 0.2 };
  const p = pos(cfg);
  assert.equal(stepExit(p, bar(100, 102, 99.9, 101.8), H, cfg), null); // arms at +2%
  const hit = stepExit(p, bar(101.8, 101.9, 99, 99.5), 2 * H, cfg);
  assert.equal(hit.reason, "BE");
  close(closedPnlPct(p, hit.px), 0.2);
});

test("a take-profit ladder books each slice at its own level", () => {
  const cfg = { ...CFG, takeProfits: [{ pct: 2, sizePct: 50 }, { pct: 4, sizePct: 50 }] };
  const p = pos(cfg);
  assert.equal(stepExit(p, bar(100, 102.5, 99.9, 102.2), H, cfg), null); // first half at +2
  close(p.realized, 1);
  const hit = stepExit(p, bar(102.2, 106, 102, 105), 2 * H, cfg);
  assert.equal(hit.reason, "TP");
  close(closedPnlPct(p, hit.px), 1 + 2); // +2 on half, +4 on half
});

test("a bar with no usable open walks its extremes as before", () => {
  const p = pos(CFG);
  const hit = stepExit(p, { t: 0, h: 100.5, l: 90, c: 95 }, H, CFG);
  assert.equal(hit.reason, "SL");
  close(closedPnlPct(p, hit.px), -10); // the first probe is the low: nothing to fill between
});
