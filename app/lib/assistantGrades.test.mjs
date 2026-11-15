// The assistant speaks the house rules on grades (2026-11-14). Run: node --test app/lib/assistantGrades.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../config/assistant.ts", import.meta.url), "utf8");

test("get_market_read reads the drawer's one request and relays each lens with its grade, never a verdict", () => {
  assert.match(tools, /name: "get_market_read"/);
  assert.match(tools, /\/intel\/market\/\$\{encodeURIComponent\(coin\)\}/);
  assert.match(tools, /grade: l\.graded \?\? null/);
  assert.match(tools, /NEVER add the lenses up into a verdict/);
});

test("no tool hands the model a conviction verdict over ungraded inputs", () => {
  assert.doesNotMatch(tools, /conviction: convictionLevel|, conviction,|"HIGH" : net/);
  assert.doesNotMatch(tools, /Agreement across uncorrelated (axes|sources) is the signal/);
  assert.doesNotMatch(tools, /highest-conviction|HIGH-conviction/);
  assert.match(tools, /fade_grade:/, "the scan carries the fade's own grade");
});

test("the system prompt states the grade rule", () => {
  assert.match(prompt, /- GRADES: a read is "graded" only when the scoreboard grades that EXACT rule/);
  assert.match(prompt, /Never add ungraded inputs up into a conviction, score or verdict/);
  assert.doesNotMatch(prompt, /conviction verdict/);
});

test("the mispriced board carries the fade's grade and never calls the fade an edge (2026-11-15)", () => {
  const mp = tools.slice(tools.indexOf('name: "get_mispriced"'), tools.indexOf('name: "get_trader"'));
  assert.match(mp, /\/intel\/fade-grade/);
  assert.match(mp, /fade_grade:/);
  assert.match(mp, /ALWAYS relay fade_grade/);
  assert.doesNotMatch(mp, /mean-revert(?:\s*\(fade\))? edge/);
  assert.doesNotMatch(mp, /PROVEN means it's paid/);
  assert.doesNotMatch(mp, /edge_annual_pct|edge_quality/);
  const sb = tools.slice(tools.indexOf('name: "get_signal_scoreboard"'), tools.indexOf('input_schema', tools.indexOf('name: "get_signal_scoreboard"')));
  assert.doesNotMatch(sb, /NOT an edge until it's PREDICTIVE/, "PREDICTIVE is not an edge");
  assert.match(sb, /PREDICTIVE alone is NOT enough/);
});
