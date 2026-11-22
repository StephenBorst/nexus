// A PRO-locked click says so where it happened (proLock.mjs + AgentView).
// Run: node --test app/lib/proLock.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { proLockCopy } from "./proLock.mjs";

test("the message names the strategy, the reason and both ways in", () => {
  const c = proLockCopy({ name: "Momentum Rider", holderMin: 100_000_000, holderTier: "ARCHITECT", usdc: 20, nexusPrice: 15 });
  assert.equal(c.title, "Momentum Rider needs PRO");
  assert.match(c.body, /wasn’t loaded/);
  assert.match(c.body, /100,000,000 \$NEXUS \(Architect\)/);
  assert.match(c.body, /\$20\/month in USDC \(\$15 paid in \$NEXUS\)/);
  assert.doesNotMatch(c.body, /\b(yield|profit|returns|guaranteed)\b/i);
  assert.equal(proLockCopy({ name: "x", loading: true }).checking, true, "while the tier is still loading it never says 'not PRO'");
});

test("AgentView: every PRO click shows the note next to what was clicked, never silent", () => {
  const src = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /setProNote\(true\)/, "the old boolean note rendered far from the presets");
  assert.equal((src.match(/setProLock\(\{ where: "preset"/g) || []).length, 1);
  assert.equal((src.match(/setProLock\(\{ where: "mode"/g) || []).length, 1);
  assert.match(src, /proLock\?\.where === "preset" && <ProLockNote/);
  assert.match(src, /proLock\?\.where === "mode" && <ProLockNote/);
  // No PRO user is ever told they're locked while their tier is still being read.
  assert.match(src, /locked = .*!isPro/);
  assert.match(src, /loading=\{subLoading\}/);
});
