// Logged-out Quick Trade + Holders Room (2026-11-21): what the tab does and the next step, never a promise.
// Run: node --test app/lib/guestPanels.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const block = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

test("Holders Room guest: tiers from the gate's own thresholds, no yield, no promise", () => {
  const src = read("../components/HoldersRoom.tsx");
  const g = block(src, "if (!walletAddress) {", "</GuestPanel>");
  assert.match(g, /TIER_THRESHOLDS\.find/, "numbers come from the thresholds the gate reads, never typed in");
  assert.match(g, /no yield, no revenue share/);
  assert.doesNotMatch(g.replace(/no yield, no revenue share/, ""), /\b(yield|dividend|returns|profit|moon|earn)\b/i);
});

test("Quick Trade guest: names real collateral and the leverage-first rule", () => {
  const g = block(read("../pages/lab/QuickTrade.tsx"), "if (!connected) {", "</GuestPanel>");
  assert.match(g, /Real collateral/);
  assert.match(g, /If that change fails, the order isn't sent/);
  assert.doesNotMatch(g, /\b(guaranteed|proven|edge|profit)\b/i);
});
