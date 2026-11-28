import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readChecklist, STAGE_BARS, ROW_MARK } from "./readChecklist.mjs";
import { PIPELINE_RULES } from "./readPipeline.mjs";
import { BADGE_BAR } from "./badgeBar.mjs";

const reg = (stage, gates = [], extra = {}) => ({ axis: "x_read", stage, gates, failing: null, ...extra });
const row = (out, key) => out.rows.find((r) => r.key === key);

test("REGISTERED with too few events: the served gate in numbers, every later stage named, the CLEARED stretch at the end", () => {
  const out = readChecklist({ reg: reg("REGISTERED", [{ key: "events", label: "out-of-sample events", now: 11, bar: 30, unit: "events", met: false }]), paper: { count: 4, target: 30 } });
  assert.equal(out.cleared, false);
  assert.deepEqual(row(out, "gate:events"), { key: "gate:events", title: "out-of-sample events", state: "open", line: "11 of 30 · needs 19 more", group: "To reach Lead" });
  assert.deepEqual([...new Set(out.rows.map((r) => r.group))], ["To reach Lead", "Then Edge", "Then Tradeable", "Then Paper", "Then CLEARED"]);
  assert.equal(row(out, "paper:count").line, "4 of 30 · needs 26 more closed trades");
  assert.equal(row(out, "paper:afterfees").line, "checked at 30 trades · needs 26 more closed trades", "not enough data: says how many more");
  assert.equal(row(out, "paper:random").state, "later");
  assert.match(out.head, /^Still testing · \d+ requirements left$/);
});

test("the later stages' bars are PIPELINE_RULES' own numbers; the CLEARED bar is BADGE_BAR's", () => {
  const R = PIPELINE_RULES;
  assert.match(STAGE_BARS.LEAD[0], new RegExp(`^${R.minEvents} `));
  assert.match(STAGE_BARS.EDGE.join(" "), new RegExp(`≥ ${R.edgePct}%.*≥ ${R.sidePct}%.*${R.holdoutMinEvents} events.*≥ ${R.holdoutPct}%`));
  assert.match(STAGE_BARS.TRADEABLE[0], new RegExp(`^${R.exitMinTrades} trades`));
  const out = readChecklist({ reg: reg("PAPER"), judgment: { ok: true, verdict: "ACCRUING", count: 12, target: 30 } });
  assert.equal(row(out, "paper:random").title, `≥ ${BADGE_BAR.beatPct}% of ${BADGE_BAR.runs} random entries finishing under it`);
});

test("unread stays unread: no board row, no paper record, an unreadable judgment at 30+ trades", () => {
  assert.equal(readChecklist({ reg: null }).unread, true);
  const noPaper = readChecklist({ reg: reg("PAPER"), paper: { unread: true } });
  assert.deepEqual([row(noPaper, "paper:count").state, row(noPaper, "paper:count").line], ["unread", "paper record unread right now"]);
  const at30 = readChecklist({ reg: reg("PAPER"), paper: { count: 31, target: 30 }, judgment: null });
  assert.deepEqual([row(at30, "paper:afterfees").state, row(at30, "paper:afterfees").line], ["unread", "the judgment couldn’t be read right now"]);
  const noPage = readChecklist({ reg: reg("PAPER"), paper: { count: 0, target: 30 }, judgment: { ok: false, error: "no_judgment" } });
  assert.equal(row(noPage, "paper:afterfees").line, "checked at 30 trades · needs 30 more closed trades");
});

test("after the 30: PASS + ≥ 90% = CLEARED (the only passed state); PASS under 90%, FAIL, a lock or the failing label = what is left", () => {
  const pass = (pct, verdict = "BEAT") => ({ ok: true, recorded: true, verdict: "PASS", count: 30, target: 30, meanNetBps: 12.4, randomCheck: { verdict, pctBeaten: pct, usable: 300 } });
  const cleared = readChecklist({ reg: reg("PAPER"), judgment: pass(93.3) });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.head, "CLEARED");
  assert.ok(cleared.rows.every((r) => r.state === "met"));

  const under = readChecklist({ reg: reg("PAPER"), judgment: pass(71, "DIDNT_BEAT") });
  assert.equal(under.cleared, false);
  assert.deepEqual([row(under, "paper:random").state, row(under, "paper:random").line], ["open", "71% of 300 under it · needs ≥ 90%"]);
  assert.equal(row(under, "paper:afterfees").line, "+12.4 bps a trade after fees and funding");

  const fail = readChecklist({ reg: reg("PAPER"), judgment: { ok: true, recorded: true, verdict: "FAIL", count: 30, target: 30, meanNetBps: -8.2 } });
  assert.equal(row(fail, "paper:afterfees").line, "−8.2 bps a trade after fees and funding · needs above 0 · final for this run");

  const locked = readChecklist({ reg: reg("PAPER"), judgment: pass(93.3), locks: { x_read: { cleanPasses: 1 } } });
  assert.equal(locked.cleared, false);
  assert.equal(row(locked, "hold:lock").line, "1 of 2 clean daily reads ≥ 7 days apart + 15 new events since it fell back");

  const failing = readChecklist({ reg: reg("PAPER", [], { failing: ["main card: 140 events, mean R -0.07"] }), judgment: pass(93.3) });
  assert.equal(failing.cleared, false);
  assert.equal(row(failing, "hold:failing").line, "main card: 140 events, mean R -0.07");

  const unreadRandom = readChecklist({ reg: reg("PAPER"), judgment: { ...pass(0), randomCheck: { verdict: "UNREAD", usable: 120 } } });
  assert.equal(row(unreadRandom, "paper:random").line, "random replays unread (needs 250 of 300 usable)");
});

test("served gates read as numbers, never the served label's comparative wording", () => {
  const out = readChecklist({ reg: reg("LEAD", [{ key: "random", label: "beats random entries", now: 71.2, bar: 95, unit: "%", met: false }]) });
  assert.deepEqual([row(out, "gate:random").title, row(out, "gate:random").line], ["random entries finishing under its mean R", "71.2% of random entries under it · needs ≥ 95%"]);
  const lead = readChecklist({ reg: reg("REGISTERED", [{ key: "mean_r", now: -0.07, bar: 0, unit: "R", met: false }, { key: "halves", now: null, bar: null, met: false }]) });
  assert.equal(row(lead, "gate:mean_r").line, "now −0.07R · needs above 0R");
  assert.equal(row(lead, "gate:halves").line, "the two halves of the events disagree today");
});

test("words: numbers only, no comparative words, CLEARED the only passed word; marks are shapes", () => {
  for (const f of ["./readChecklist.mjs", "../components/ReadChecklist.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // Two exact strings are allowed: "Edge" is a stage's name (Testing → Lead → Edge → Tradeable → Paper) and "BEAT" is
    // the stored random-check verdict it compares against; neither is shown as a claim.
    const strings = [...src.matchAll(/["`]([^"`]*)["`]/g)].map((m) => m[1]).filter((t) => t !== "Edge" && t !== "BEAT").join("\n");
    assert.doesNotMatch(strings, /\b(better|worse|beat|beats|beaten|passed|outperform|edge|proven)\b/i, f);
    assert.doesNotMatch(src, /C\.pos|C\.neg/, `${f}: no money colours`);
  }
  assert.deepEqual(ROW_MARK, { met: "✓", open: "○", later: "…", unread: "?" });
});

test("mounted on every read's Shelf card (compact) and on its paper page (full), from the same served rows", () => {
  const shelf = readFileSync(new URL("../pages/lab/StrategyShelf.tsx", import.meta.url), "utf8");
  assert.match(shelf, /<ReadChecklist list=\{checklistFor\(r\.id\)\} compact \/>/);
  assert.match(shelf, /readChecklist\(\{ reg, paper: runs\[axis\] \|\| null, judgment, locks: PROMOTION_LOCKS \}\)/);
  const page = readFileSync(new URL("../pages/proof/PaperRun.tsx", import.meta.url), "utf8");
  assert.match(page, /<ReadChecklist list=\{checklist\} \/>/);
  assert.match(page, /sharedJson\(`\$\{AGENT_API\}\/intel\/axis-backtest`\)/, "the same scoreboard the watcher reads");
});
