// app/lib/engineBeat.mjs + its digest wiring. Run: node --test app/lib/engineBeat.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engineBeat, engineBeats, enginesLines, engineAlerts, quietWallets, ENGINE_QUIET_H } from "./engineBeat.mjs";
import { digestState, alertsFor, digestText } from "./opsDigest.mjs";

const H = 3600000, NOW = Date.parse("2026-11-20T12:00:00Z");
const row = (wallet, caller, lastH, posted = 3) => ({ wallet, caller, posted, lastPostedAt: lastH == null ? null : NOW - lastH * H });

test("posting, quiet after 48h, never-posted = not started (never an outage)", () => {
  assert.equal(engineBeat(row("0xA", "Ember", 3), NOW).state, "POSTING");
  assert.equal(engineBeat(row("0xA", "Ember", ENGINE_QUIET_H), NOW).state, "POSTING");
  assert.equal(engineBeat(row("0xA", "Ember", ENGINE_QUIET_H + 0.1), NOW).state, "QUIET");
  assert.equal(engineBeat(row("0xA", "Ember", null, 0), NOW).state, "NOT_STARTED");
  assert.equal(engineBeats(undefined, NOW), null, "an unread pulse is never 'all quiet'");
  assert.deepEqual(enginesLines(null), ["Engine calls unread right now."]);
  const lines = enginesLines(engineBeats([row("0xa", "Ember", 3), row("0xbce4b16be2088696d11d271ad29149f2dd97f432", null, 72), row("0xc", "New", null, 0)], NOW));
  assert.deepEqual(lines, ["Ember · last call 3h ago · 3 posted", "0xbce4…f432 · QUIET: last call 3d ago (none in 48h). Check its automation.", "New · no call posted yet"]);
});

test("alerts once when an engine goes quiet and once when it posts again; no burst on the first run", () => {
  const quiet = engineBeats([row("0xa", "Ember", 72)], NOW), back = engineBeats([row("0xa", "Ember", 1)], NOW);
  assert.deepEqual(engineAlerts(undefined, quiet), [], "no previous run");
  assert.deepEqual(engineAlerts(null, quiet), [], "the previous run couldn't read the engines");
  assert.match(engineAlerts([], quiet)[0].text, /^Ember has posted no call in 48h \(last 3d ago\)\. Check its automation: Engine A stopped this way\.$/);
  assert.deepEqual(engineAlerts(["0xa"], quiet), [], "still quiet: no repeat");
  assert.match(engineAlerts(["0xa"], back)[0].text, /^Ember is posting again/);
  assert.deepEqual(quietWallets(quiet), ["0xa"]);
});

test("the digest: state carries the quiet list, alertsFor raises it, the text has an Engine callers section", () => {
  const facts = { asOf: NOW, stages: {}, paper: [], pending: [], engines: engineBeats([row("0xa", "Ember", 72)], NOW), ruleChecks: [{ caller: "Scanner", line: "Rule check since Nov 17: 4 setups on its coins · 3 posted · 1 skipped · 0 calls off its rules." }] };
  assert.deepEqual(digestState(facts).quietEngines, ["0xa"]);
  assert.equal(digestState({ ...facts, engines: null }).quietEngines, null);
  const prev = digestState({ ...facts, engines: engineBeats([row("0xa", "Ember", 2)], NOW) });
  assert.deepEqual(alertsFor(prev, facts).map((a) => a.key), ["engine:0xa:QUIET"]);
  const text = digestText(facts);
  assert.match(text, /<b>Engine callers<\/b>\nEmber · QUIET: last call 3d ago/);
  assert.match(text, /Scanner: Rule check since Nov 17: 4 setups/);
  assert.doesNotMatch(digestText({ asOf: NOW, stages: {}, paper: [], pending: [] }), /Engine callers/, "an older facts shape prints no section");
});

test("wired: the digest reads the pulse's engine rows and the rule check once a day", () => {
  const src = readFileSync(new URL("../../workers/nexus-lab-api/opsDigest.mjs", import.meta.url), "utf8");
  assert.match(src, /engineBeats\(\(await readPulse\(env, \{ scorecardKey \}\)\)\?\.engineRecords, nowMs\)/);
  assert.match(src, /if \(withReceivers\) \{\n\s+for \(const w of Object\.keys\(RULE_CHECKS\)\)/);
});
