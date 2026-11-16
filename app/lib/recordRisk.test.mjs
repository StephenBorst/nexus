// app/lib/recordRisk.mjs. Run: node --test app/lib/recordRisk.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordRisk, riskLines, riskBrief, RISK_MIN_CALLS } from "./recordRisk.mjs";

const rows = (rs) => rs.map((r, i) => ({ r, at: i * 1000, closeAt: i * 1000 + 500 }));

test("drawdown from the running peak, worst losing run, profit factor, in CLOSE order", () => {
  // +2, −1, −1, −1, +1.5, −1 → running 2, 1, 0, −1, 0.5, −0.5 → peak 2, trough −1 → DD 3
  const k = recordRisk(rows([2, -1, -1, -1, 1.5, -1]));
  assert.equal(k.maxDrawdownR, 3);
  assert.equal(k.worstStreak, 3);
  assert.equal(k.profitFactor, 0.88, "3.5 won ÷ 4 lost");
  assert.equal(k.expectancy, -0.08);
  // Same calls, closed in another order than posted: the order that counts is when they closed.
  const swapped = recordRisk([{ r: -1, at: 0, closeAt: 9000 }, { r: 2, at: 1000, closeAt: 1000 }, { r: -1, at: 2000, closeAt: 2000 }]);
  assert.equal(swapped.maxDrawdownR, 2, "+2 then −1 −1 (close order), not −1 +2 −1 (post order)");
  assert.equal(swapped.worstStreak, 2);
});

test("no losses = no profit factor (not infinite); the 95% range; shown only from the minimum", () => {
  assert.equal(recordRisk(rows([1, 2])).profitFactor, null);
  assert.equal(recordRisk([]), null);
  const few = recordRisk(rows([1, -1, 1]));
  assert.equal(few.ready, false);
  assert.equal(few.needed, RISK_MIN_CALLS - 3);
  assert.deepEqual(riskLines(few), [`Risk stats show from ${RISK_MIN_CALLS} graded calls · 3 so far, ${RISK_MIN_CALLS - 3} to go.`]);
  assert.equal(riskBrief(few), null);
  const many = recordRisk(rows(Array.from({ length: 20 }, (_, i) => (i % 2 ? -1 : 1.5))));
  assert.equal(many.ready, true);
  assert.ok(many.low < many.expectancy && many.expectancy < many.high);
  const lines = riskLines(many);
  assert.match(lines[0], /^Profit factor 1\.50 · R won per R lost\.$/);
  assert.match(lines[1], /^Max drawdown −1\.00R/);
  assert.match(lines.at(-1), /includes zero: not yet distinguishable from break-even/);
  assert.equal(riskBrief(many), "PF 1.50 · max DD −1.00R");
  assert.doesNotMatch(lines.join(" "), /sharpe|edge|proven|guarantee/i);
});

test("wired: the grader's record carries it, both routes serve it", () => {
  assert.match(readFileSync(new URL("../../workers/nexus-lab-api/grading.mjs", import.meta.url), "utf8"), /a\.risk = recordRisk\(a\.resolved\)/);
  const routes = readFileSync(new URL("../../workers/nexus-lab-api/routes-theses.mjs", import.meta.url), "utf8");
  assert.equal((routes.match(/risk: a\.risk \|\| null/g) || []).length, 2, "/theses/process and /theses/leaderboard");
});
