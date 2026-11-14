// Copy that makes a claim must match what the code measured (house rule: never call a read "proven"
// or an "edge" unless the scoreboard grades that exact rule). Pinned so the overclaims don't creep back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
// user-visible strings only: drop // and /* */ comments first
const visible = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the Briefing reads a trader's own record as 'done better', never an edge or a proven record", () => {
  const b = visible(read("../pages/lab/briefing.ts"));
  assert.doesNotMatch(b, /Your edge is/);
  assert.doesNotMatch(b, /proven record/i);
  assert.match(b, /A win rate isn’t an edge/);
});

test("the Mispriced board's reversion chip says what was measured, without the scoreboard's ◆ mark", () => {
  const m = read("../pages/lab/MispricedBoard.tsx");
  const chip = visible(m.slice(m.indexOf("function EdgeQualityChip("), m.indexOf("function EdgeQualityChip(") + 900));
  assert.doesNotMatch(chip, /paid|proven edge|◆/i);
  assert.doesNotMatch(chip, /C\.accent/, "the bone accent belongs to PREDICTIVE");
  assert.match(chip, /beats a coin flip/);
});

test("the Mispriced board calls the funding fade a rule, not an edge", () => {
  const m = visible(read("../pages/lab/MispricedBoard.tsx"));
  assert.doesNotMatch(m, /edge is to bet|Funding edge/);
  assert.match(m, /a mechanical rule, not graded yet/);
  // 2026-11-14: the board's intro, lens label and watch lines called the ungraded fade an "edge".
  assert.doesNotMatch(m, /mean-revert edge|FUNDING-EDGE|fade edge|sorted by edge|\|edge\|/);
});

test("the Lab's funding board section doesn't promise that fades paid", () => {
  // The funding board is a chip on Lab home's lens card since 2026-11-14 (app/lib/intelLenses.mjs).
  const lenses = read("./intelLenses.mjs");
  const line = lenses.slice(lenses.indexOf('id: "funding"'), lenses.indexOf('id: "positioning"'));
  assert.ok(line.length > 0);
  assert.doesNotMatch(line, /PAID|paid vs trap|Funding edges|edge/i);
});

