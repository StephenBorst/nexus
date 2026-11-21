// The scoreboard build's caches (axisbt.mjs, 2026-11-21: "one build, many passes") change speed only. Run:
//   node --test workers/nexus-lab-api/axisbt.memo.test.mjs
// The whole scorecard (main card + holdout line + overlap + out-of-sample grades) on the fixed fingerprint tapes, with
// every cache on and with every cache off (the old path), must serialise to the same bytes; a second build on the same
// objects (warm caches) too. And nothing but a test may switch the caches off.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runScorecard, runHoldoutScorecard, eventsWithR, AXES, OVERLAP_PAIRS, _setBuildCaches } from "./axisbt.mjs";
import { fingerprintTapes } from "./readFingerprint.mjs";

const NOW = Date.UTC(2026, 10, 1);
const sets = () => {
  const [a, b, c] = fingerprintTapes();
  const btc = { ...structuredClone(a.cs), coin: "BTC" };
  return [btc, structuredClone(a.cs), structuredClone(b.cs), structuredClone(c.cs)];
};
const registered = [{ axis: "level_reclaim", fromMs: Date.UTC(2026, 7, 1) }, { axis: "basis_x_cvd", fromMs: Date.UTC(2026, 7, 15) }, { axis: "oi_div_reversal_4h", fromMs: Date.UTC(2026, 7, 1) }];
const tests = [{ axis: "basis_x_cvd", key: "regimeWindow", fromMs: Date.UTC(2026, 7, 20) }];
const build = (cs) => {
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const main = runScorecard(cs, { horizons: [4, 12, 24], minSamples: 20, registered, tests, overlapPairs: OVERLAP_PAIRS });
    const hold = runHoldoutScorecard(cs.slice(1, 3), { horizons: [4, 12, 24], minSamples: 20, axes: ["basis_extreme", "level_reclaim", "btc_lead_lag"], registered, tests, ctxSets: cs.slice(0, 1) });
    const study = Object.fromEntries(["level_reclaim", "basis_x_cvd", "rsi_reset_deep"].map((n) => [n, eventsWithR(cs, AXES.find((a) => a.name === n).gen)]));
    return JSON.stringify({ main, hold, study });
  } finally { Date.now = realNow; }
};

test("the scorecard is byte-identical with the build caches on, off, and warm", () => {
  _setBuildCaches(false);
  let off;
  try { off = build(sets()); } finally { _setBuildCaches(true); }
  const cs = sets();
  const on = build(cs);
  const warm = build(cs);
  assert.ok(off.length > 10_000, "the tapes fire real events");
  assert.equal(on, off);
  assert.equal(warm, off);
});

test("only tests switch the caches off", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === "node_modules" || d.name.startsWith(".")) continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(mjs|js|ts|tsx)$/.test(d.name) && !d.name.includes(".test.") && d.name !== "axisbt.mjs" && /_setBuildCaches/.test(readFileSync(p, "utf8"))) offenders.push(p);
    }
  };
  for (const root of ["../../app", "../../workers", "../../tools"]) walk(new URL(root, import.meta.url).pathname);
  assert.deepEqual(offenders, []);
});
