// Unusual moves by the coin's own history (unusualMove.mjs). Run: node --test app/lib/unusualMove.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { moveLines, currentMove, unusualMove, moveDue, moveMessage, MOVE_MIN_SAMPLES, MOVE_COOLDOWN_MS } from "./unusualMove.mjs";

const H = 3600_000;
const NOW = Date.parse("2026-11-23T12:00:00Z");
// 90 days of hourly closes wiggling ±1% around 100 (a seeded saw), then the last 4 hours as given.
function tape(tail = []) {
  const n = 90 * 24, bars = [];
  for (let i = 0; i < n; i++) bars.push({ t: NOW - (n - i) * H, c: 100 * (1 + 0.01 * Math.sin(i * 1.7) * Math.cos(i * 0.31)) });
  tail.forEach((c, k) => bars.push({ t: NOW + k * H, c }));
  return bars;
}

test("the lines are the coin's own 10th / 90th percentile 4-hour moves", () => {
  const l = moveLines(tape(), { now: NOW });
  assert.ok(l.samples >= MOVE_MIN_SAMPLES);
  assert.ok(l.up > 0 && l.up < 2.5, `up line ${l.up}`);
  assert.ok(l.down < 0 && l.down > -2.5, `down line ${l.down}`);
  assert.equal(moveLines(tape().slice(-100), { now: NOW }), null, "too little history = no lines, never a guess");
});

test("a move past the line is unusual, with how rare in words; inside the lines is quiet", () => {
  const bars = tape([100, 101, 103, 105, 108]);
  const lines = moveLines(bars, { now: NOW });
  const mv = currentMove(bars);
  assert.ok(Math.abs(mv.pct - 8) < 0.01);
  const u = unusualMove(lines, mv);
  assert.equal(u.side, "UP");
  assert.equal(u.share, 100);
  assert.match(moveMessage("ETH", u), /^ETH rose 8\.0% in 4 hours: higher than 100% of its 4-hour moves in the last 90 days \(its 90% line is \+\d\.\d%\)\. A move, not a signal\.$/);
  const down = unusualMove(lines, { pct: -6 });
  assert.equal(down.side, "DOWN");
  assert.match(moveMessage("ETH", down), /fell 6\.0%.*lower than \d+%.*10% line is −/);
  assert.equal(unusualMove(lines, { pct: 0.1 }).side, null);
  assert.equal(unusualMove(null, { pct: 9 }).side, null);
  assert.equal(currentMove([{ t: NOW, c: 1 }]), null, "no bar 4 hours back = no move read");
});

test("once per side per window: a flip fires, the same side waits out the cooldown", () => {
  assert.equal(moveDue(null, "UP", NOW), true);
  assert.equal(moveDue({ side: "UP", at: NOW - 60_000 }, "UP", NOW), false);
  assert.equal(moveDue({ side: "UP", at: NOW - MOVE_COOLDOWN_MS }, "UP", NOW), true);
  assert.equal(moveDue({ side: "UP", at: NOW }, "DOWN", NOW), true);
  assert.equal(moveDue(null, null, NOW), false);
});
