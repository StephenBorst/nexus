// Tests for strategy naming + backtest gate honesty.
// Run: node --test app/lib/strategyLabel.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { strategyLabel, backtestGateSupport } from "./strategyLabel.mjs";

// The shipped "Regime-Gated Invert" preset (app/config/strategyPresets.ts) — the exact
// composition that was being mislabelled "CONFLUENCE" in backtest notes.
const REGIME_GATED_INVERT = {
  signalMode: "CONFLUENCE", invertSignal: true,
  fundingThreshold: 0.01, oiChangeThreshold: 1,
  minVolAtrPct: 0.7, tradeSessions: ["US", "EUROPE"],
  maxSignalAgeSec: 180,
};

test("strategyLabel: an inverted+gated config is NOT called CONFLUENCE", () => {
  assert.equal(strategyLabel(REGIME_GATED_INVERT), "Regime-Gated Invert");
  assert.notEqual(strategyLabel(REGIME_GATED_INVERT), "CONFLUENCE");
});

test("strategyLabel: invert without gates still says inverted (opposite trade)", () => {
  assert.equal(strategyLabel({ signalMode: "CONFLUENCE", invertSignal: true }), "Inverted CONFLUENCE");
  assert.equal(strategyLabel({ signalMode: "FUNDING_ONLY", invertSignal: true }), "Inverted FUNDING_ONLY");
});

test("strategyLabel: plain modes keep their name; gated modes are marked", () => {
  assert.equal(strategyLabel({ signalMode: "CONFLUENCE" }), "CONFLUENCE");
  assert.equal(strategyLabel({}), "CONFLUENCE", "defaults to the house mode");
  assert.equal(strategyLabel({ signalMode: "MOMENTUM", tradeSessions: ["US"] }), "Gated MOMENTUM");
  assert.equal(strategyLabel({ signalMode: "MOMENTUM", tradeSessions: [] }), "MOMENTUM", "empty session list is not a gate");
});

test("backtestGateSupport: the preset's gates ARE simulated (vol + session + invert)", () => {
  const { applied, skipped } = backtestGateSupport(REGIME_GATED_INVERT);
  assert.deepEqual(applied, ["invert", "session", "volatility"]);
  // The preset does NOT set respectRegime — its only unsimulated bit is the latency guard.
  assert.deepEqual(skipped, ["signal-age (live latency guard)"]);
});

test("backtestGateSupport: respectRegime / smart-money are flagged as NOT simulated", () => {
  const { skipped } = backtestGateSupport({ respectRegime: true, respectSmartMoney: true });
  assert.ok(skipped.some((s) => s.startsWith("regime")), "regime gate never runs in a sim (no regime series)");
  assert.ok(skipped.some((s) => s.startsWith("smart-money")), "smart-money gate never runs in a sim");
});

test("backtestGateSupport: a bare config claims nothing", () => {
  assert.deepEqual(backtestGateSupport({}), { applied: [], skipped: [] });
});
