// The paper record against the house bar (paperGraduation.mjs). Run: node --test app/lib/paperGraduation.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { graduation, GRADUATION_TRADES } from "./paperGraduation.mjs";

test("under 30 trades: a count, nothing to switch (5 fee-free paper wins used to say READY TO GO LIVE?)", () => {
  const g = graduation({ lifetimeTrades: 5, costs: { trades: 5, netUsd: 40, grossUsd: 42 } });
  assert.equal(g.stage, "COUNTING");
  assert.equal(g.title, "PAPER RECORD · 5 OF 30 TRADES");
  assert.equal(g.offerAssisted, false);
  assert.match(g.line, /25 to go/);
  assert.equal(graduation({ lifetimeTrades: 0, costs: null }), null);
  assert.equal(GRADUATION_TRADES, 30);
});

test("30+: judged after fees and funding; a loss after costs offers nothing", () => {
  const lost = graduation({ lifetimeTrades: 34, costs: { trades: 34, netUsd: -3.2, grossUsd: 6 } });
  assert.equal(lost.stage, "LOST_AFTER_COSTS");
  assert.equal(lost.offerAssisted, false);
  assert.match(lost.line, /come to −\$3\.20/);
  assert.equal(graduation({ lifetimeTrades: 34, costs: null }).stage, "UNREAD");
});

test("30+ and positive after costs: 'not proof', and the one step offered is ASSISTED, never AUTONOMOUS", () => {
  const g = graduation({ lifetimeTrades: 60, costs: { trades: 50, netUsd: 12.5, grossUsd: 20 } });
  assert.equal(g.stage, "LOOK_CLOSER");
  assert.equal(g.offerAssisted, true);
  assert.match(g.line, /the last 50 of 60 trades come to \+\$12\.50\. A reason to look closer, not proof/);
  assert.doesNotMatch(g.line, /autonomous|go live|proven|edge/i);
});

test("the Agent tab: no 'Go autonomous' nudge; caps, state and exits in ink, not money colours", () => {
  const src = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, />\s*→ Go autonomous\s*</);
  assert.doesNotMatch(src, /READY TO GO LIVE\?<\/div>/);
  assert.match(src, /<PaperRecordCard/);
  assert.doesNotMatch(src, /barColor = \(pct: number\) => pct >= 90 \? "#f7525f"/);
  assert.doesNotMatch(src, /isActive \? "#3ecf8e" : "#f7525f"/);
  assert.doesNotMatch(src, /trade\.reason === "TP" \? "#3ecf8e"/);
  const panels = readFileSync(new URL("../pages/lab/AgentPanels.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panels.slice(panels.indexOf("export function PaperRecordCard")), /AUTONOMOUS"\s*\}/);
});
