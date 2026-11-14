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


test("the Thesis Engine leads with Quick Call, and a call names a read, not an edge", () => {
  const src = read("../pages/lab/ThesisView.tsx");
  const quick = src.indexOf("⚡ QUICK CALL");
  assert.ok(quick > 0 && quick < src.indexOf("Pick a play on the board.") && quick < src.indexOf("A good call is a Signal"));
  const recipe = visible(src.slice(src.indexOf("A good call is a Signal"), src.indexOf("A good call is a Signal") + 600));
  assert.doesNotMatch(recipe, /\bedge\b/i);
  assert.match(recipe, /read/);
  assert.doesNotMatch(visible(src), /fill in entry, stop, tp1/);
});

test("nothing ungraded is called an edge: your own splits, inverted configs, NOISE reads (2026-11-14 sweep)", () => {
  const banned = [
    ["../pages/proof/SignalBoard.tsx", /avg edge/],
    ["../pages/proof/FeaturedLead.tsx", /gave the edge back/],
    ["../pages/lab/AgentView.tsx", /fade the edge|the edge is the fade|The edge is yours|operator of[\s\S]{0,60}edge —/],
    ["../pages/lab/AnalyticsView.tsx", /YOUR EDGE|coach my edge/],
    ["../pages/lab/ProcessView.tsx", /Your edge lives in|It disappears in|&#9632; REGIME EDGE/],
    ["./operatorProfile.mjs", /your edge is real/],
    ["../pages/lab/PositioningBoard.tsx", /MY EDGE|you’re proven on|your proven markets/],
    ["../pages/lab/DecisionBoard.tsx", /on your graded edge/],
    ["../pages/lab/NexusBriefing.tsx", /the edge only pays/],
    ["../components/NexusAssistant.tsx", /Where's my edge/],
  ];
  for (const [file, re] of banned) assert.doesNotMatch(visible(read(file)), re, file);
});
