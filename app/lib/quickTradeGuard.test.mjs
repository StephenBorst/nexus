import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Quick Trade (Lab) sets the account's leverage, then sends a market order. A failed leverage
// change used to be swallowed ("keep going at current lev"), so the order filled at whatever
// leverage the account already had while the ticket showed the one picked.
const src = readFileSync(new URL("../pages/lab/QuickTrade.tsx", import.meta.url), "utf8");

test("a failed leverage change stops the order before it is sent", () => {
  const place = src.slice(src.indexOf("async function place("), src.indexOf("const px = "));
  assert.doesNotMatch(place, /catch \{ \/\* keep going at current lev/);
  const change = place.indexOf("await updateLeverage(");
  const bail = place.indexOf("Nothing was placed.` });\n          return;", change);
  const send = place.indexOf("await submit()");
  assert.ok(change > 0 && bail > change && send > bail, "updateLeverage → on failure say so and return → only then submit");
});

test("no screen still advertises the deleted Trading Score (2026-11-14)", () => {
  for (const f of ["../pages/lab/Onboarding.tsx", "../pages/lab/TraderDetail.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /trading score/i, f);
  }
});
