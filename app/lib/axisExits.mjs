// ── Exit-matched grading contracts — what the agent ACTUALLY trades on a graded read ──
// The scoreboard grades a read two ways that are NOT the agent's exit: fixed forward
// horizons (4/12/24h close-to-close) and the frozen R contract (1.2×ATR stop, 1.5R target,
// 168h). A preset trades the read with its OWN exit (tp% / sl% / maxHoldHours). This map
// names, per scoreboard axis, the preset that trades it (see AXIS_PRESET in
// app/config/strategyPresets.ts) and that preset's exit, so axisbt can grade the read
// through the preset's exit along the real price path. A parity test
// (axisExits.test.mjs) pins these numbers to the preset file — change a preset's exit
// and the test fails until this map moves with it.
export const AXIS_EXITS = Object.freeze({
  basis_extreme: Object.freeze({ preset: "basis-extreme-fade", tpPercent: 2.5, slPercent: 2, maxHoldHours: 12 }),
  basis_x_cvd: Object.freeze({ preset: "basis-cvd-stack", tpPercent: 2.5, slPercent: 2, maxHoldHours: 12 }),
});
