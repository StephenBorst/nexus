// Two-sided basis axis (vs trailing mean). Run: node --test workers/nexus-lab-api/axisbt.basisdev.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { basisDevEvents, basisExtremeEvents, AXES } from "./axisbt.mjs";

const H = 3600000, T0 = Date.UTC(2026, 8, 1);
// persistent ~−0.05% discount with swings both ways (seeded)
function tape(n, seed = 3) {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * H, basisPct: -0.05 + (r() - 0.5) * 0.04 }));
}

test("on a persistent discount the old axis is LONG-only; the two-sided axis fires both sides", () => {
  const cs = { basisHist: tape(600) };
  const old = basisExtremeEvents(cs), dev = basisDevEvents(cs);
  assert.ok(old.length > 0 && old.every((e) => e.side === "LONG"), "zero-anchored rule never shorts");
  assert.ok(dev.some((e) => e.side === "LONG") && dev.some((e) => e.side === "SHORT"), "two-sided rule shorts too");
});

test("no lookahead: rewriting the future never changes a past event", () => {
  const rows = tape(600), k = 400;
  const before = basisDevEvents({ basisHist: rows }).filter((e) => e.t <= rows[k].t);
  const poisoned = rows.map((r, i) => (i > k ? { ...r, basisPct: r.basisPct * -50 } : r));
  const after = basisDevEvents({ basisHist: poisoned }).filter((e) => e.t <= rows[k].t);
  assert.deepEqual(after, before);
});

test("registered beside basis_extreme (graded, not traded)", () => {
  const names = AXES.map((a) => a.name);
  assert.ok(names.includes("basis_dev") && names.includes("basis_dev_x_cvd") && names.includes("basis_extreme"));
});
