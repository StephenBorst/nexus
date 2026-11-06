// The order of exec's per-agent tick (processUser), pinned by source position: index.js isn't
// importable without the worker runtime. Exits and position management must come before anything
// that can stop the tick for entry reasons.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("async function processUser("), src.indexOf("\nasync function ", src.indexOf("async function processUser(") + 10));
const at = (needle) => { const i = body.indexOf(needle); assert.ok(i > 0, `missing: ${needle}`); return i; };

test("daily caps gate entries only: they come after the position monitor and ghost adoption", () => {
  // Before 2026-11-06 the cap check ran first, so the day's last allowed trade went unmanaged until
  // the 24h reset (trades_today is bumped at entry). No SL, TP or timeout on a live position.
  const cap = at("dailyCapBlocked(state, config)");
  assert.ok(at("await monitorPosition(") < cap, "an open position is managed even when capped");
  assert.ok(at("adoptOrphanPosition(") < cap, "a ghost position is adopted even when capped");
  assert.ok(at('wh.action === "CLOSE"') < cap, "an external CLOSE works even when capped");
  assert.equal(body.split("dailyCapBlocked(").length - 1, 1, "one cap check");
});

test("the kill branch runs before everything else", () => {
  const kill = at("if (killRaw || state.kill_requested)");
  for (const later of ["if (!state.active) return;", "dailyCapBlocked(", "await monitorPosition("]) assert.ok(kill < at(later), later);
});

test("a live safety order or partial TP with no key books nothing (fails closed)", () => {
  for (const fn of ["async function addSafetyOrder(", "async function partialClose("]) {
    const start = src.indexOf(fn);
    const chunk = src.slice(start, src.indexOf("\nasync function ", start + 10));
    const keyed = chunk.indexOf("if (keyRaw) {");
    assert.ok(keyed > 0, fn);
    assert.match(chunk.slice(keyed), /\} else \{[\s\S]{0,200}?no key[\s\S]{0,80}?return;/, `${fn} returns when there is no key`);
  }
});
