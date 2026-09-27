// Parity: every exit contract the scoreboard grades must equal the preset it names —
// read straight from strategyPresets.ts (text, so no TS toolchain) — and every
// AXIS_PRESET mapping must have an exit contract. Otherwise the "preset exit" row on
// /proof would grade a different trade than the Load button hands the agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AXIS_EXITS } from "./axisExits.mjs";

const src = readFileSync(new URL("../config/strategyPresets.ts", import.meta.url), "utf8");

function presetBlock(id) {
  const i = src.indexOf(`id: "${id}"`);
  assert.ok(i >= 0, `preset ${id} not found`);
  const next = src.indexOf("\n  {\n    id:", i + 1);
  return src.slice(i, next < 0 ? undefined : next);
}
const num = (block, key) => {
  const m = block.match(new RegExp(`\\b${key}:\\s*([0-9.]+)`));
  return m ? Number(m[1]) : undefined;
};

test("every axis exit contract matches its preset's tp / sl / max hold", () => {
  for (const [axis, x] of Object.entries(AXIS_EXITS)) {
    const b = presetBlock(x.preset);
    assert.equal(num(b, "tpPercent"), x.tpPercent, `${axis} tpPercent`);
    assert.equal(num(b, "slPercent"), x.slPercent, `${axis} slPercent`);
    assert.equal(num(b, "maxHoldHours"), x.maxHoldHours, `${axis} maxHoldHours`);
    assert.equal(num(b, "leverage"), x.leverage, `${axis} leverage`);
    assert.equal(num(b, "capitalPerTrade"), x.capitalPerTrade, `${axis} capitalPerTrade`);
    assert.match(b, new RegExp(`signalMode:\\s*"${x.signalMode}"`), `${axis} signalMode`);
    const conf = b.match(/basisConfirm:\s*"(\w+)"/);
    assert.equal(conf ? conf[1] : null, x.basisConfirm, `${axis} basisConfirm`);
    assert.ok(!/takeProfits:|trailingStopPct:|breakevenTriggerPct:|dcaEnabled:/.test(b), `${axis}: preset uses an exit feature the contract doesn't carry`);
  }
});

test("every scoreboard → preset mapping has an exit contract", () => {
  const m = src.match(/AXIS_PRESET[^=]*=\s*\{([^}]*)\}/);
  assert.ok(m, "AXIS_PRESET not found");
  const pairs = [...m[1].matchAll(/(\w+):\s*"([\w-]+)"/g)].map((x) => [x[1], x[2]]);
  assert.ok(pairs.length > 0);
  for (const [axis, preset] of pairs) {
    assert.ok(AXIS_EXITS[axis], `${axis} has no exit contract`);
    assert.equal(AXIS_EXITS[axis].preset, preset, `${axis} maps to a different preset`);
  }
});

// STAGED Basis × Smart (OCT15_BASIS_SMART_LIVE): its mapping is joined at runtime, so the literal
// check above can't see it. Pin the flip here instead — ON demands an exit contract — and keep the
// staged preset identical to the live Basis × CVD Stack except for its confirm, so turning it on
// adds exactly one variable to the comparison.
test("staged Basis × Smart: same trade as the CVD stack except the confirm; ON needs an exit contract", () => {
  const i = src.indexOf('id: "basis-smart-stack"');
  assert.ok(i >= 0, "staged preset not found");
  const staged = src.slice(i, src.indexOf("\n};", i));
  const cvd = presetBlock("basis-cvd-stack");
  for (const k of ["tpPercent", "slPercent", "maxHoldHours", "leverage", "capitalPerTrade", "maxTradesPerDay", "maxDailyLossUsdc"]) {
    assert.equal(num(staged, k), num(cvd, k), `staged ${k}`);
  }
  assert.match(staged, /signalMode:\s*"BASIS_FADE",\s*basisConfirm:\s*"SMART"/);
  const live = /export const OCT15_BASIS_SMART_LIVE = (true|false);/.exec(src);
  assert.ok(live, "OCT15_BASIS_SMART_LIVE not found");
  if (live[1] === "true") {
    assert.ok(AXIS_EXITS.basis_x_smart, "Basis × Smart is live but has no AXIS_EXITS contract");
    assert.equal(AXIS_EXITS.basis_x_smart.preset, "basis-smart-stack");
  } else {
    assert.equal(AXIS_EXITS.basis_x_smart, undefined, "staged read must not change the live scoreboard's exit grades");
  }
});
