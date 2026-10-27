// Batch-2 explorer DRAFTS (docs/research/explorer-drafts-b.md). Not registered, so: never on the
// scoreboard, behaviour on hand-built tapes, no lookahead, and the power check counts only.
// Run: node --test workers/nexus-lab-api/explorerDraftsB.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oiCoilBreakEvents, OI_COIL, DRAFT_GENS_B, DRAFT_READS_B } from "./explorerDraftsB.mjs";
import { AXES } from "./axisbt.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { powerCheck } from "../../tools/explorers/powerCheck.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);

test("drafts are not graded: off the scoreboard, unregistered, and axisbt doesn't import them", () => {
  const graded = new Set(AXES.map((a) => a.name));
  const registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const n of Object.keys(DRAFT_GENS_B)) {
    assert.ok(!graded.has(n), `${n} is on the scoreboard before it is registered`);
    assert.ok(!registered.has(n), `${n} is registered: move it out of the drafts file in the registration PR`);
  }
  const src = readFileSync(new URL("./axisbt.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /explorerDraftsB/, "axisbt.mjs must not import the drafts");
  assert.deepEqual(DRAFT_READS_B.map((r) => r.name), ["oi_coil_break"]); // A registered 2026-10-27, C dropped, D parked
});

// A tape with a steady wobble (so 24h returns have a spread), then a flat final day.
function coilTape({ oiBuild, breakUp }) {
  const n = 800, oiHist = [], candleHist = [];
  for (let i = 0; i < n; i++) {
    const flat = i >= n - 30;
    const p = flat ? 100 : 100 + Math.sin(i / 9) * 3;
    const oi = flat && i >= n - 24 ? 1000 * (1 + oiBuild * (i - (n - 25)) / 24) : 1000;
    oiHist.push({ t: T0 + i * H + 60000, price: p, oi, funding: 0 });
    candleHist.push({ t: T0 + i * H, o: p, h: p * 1.001, l: p * 0.999, c: p, v: 1 });
  }
  // the hour after the coil: a close outside the 24h range
  const px = breakUp ? 101 : 99;
  candleHist.push({ t: T0 + n * H, o: 100, h: Math.max(100, px) * 1.001, l: Math.min(100, px) * 0.999, c: px, v: 1 });
  return { oiHist, candleHist, coilEnd: T0 + (n - 1) * H };
}

test("oi_coil_break: OI builds into a flat tape, the range break is followed; no OI build → nothing", () => {
  const up = oiCoilBreakEvents(coilTape({ oiBuild: 0.06, breakUp: true }));
  assert.equal(up.at(-1)?.side, "LONG");
  const down = oiCoilBreakEvents(coilTape({ oiBuild: 0.06, breakUp: false }));
  assert.equal(down.at(-1)?.side, "SHORT");
  const t = coilTape({ oiBuild: 0.0, breakUp: true });
  assert.equal(oiCoilBreakEvents(t).filter((e) => e.t > t.coilEnd).length, 0, "no OI build, no coil");
  assert.equal(OI_COIL.oiBuild, 0.05);
});

// a seeded random tape with funding/OI/candles (the same shape explorerReads.test.mjs uses)
function tape(n, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000;
  const oiHist = [], candleHist = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 60 ? 0.3 : 1.5);
    oi *= 1 + (rnd() - 0.5) * 0.03 + (i % 300 < 60 ? 0.004 : 0);
    const hi = Math.max(o, p) * (1 + rnd() * 0.006), lo = Math.min(o, p) * (1 - rnd() * 0.006);
    candleHist.push({ t: T0 + i * H, o, h: hi, l: lo, c: p, v: 1 });
    oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 });
  }
  return { oiHist, candleHist };
}

test("no lookahead: for every draft, the future never changes past events", () => {
  const full = tape(1600);
  for (const [name, gen] of Object.entries(DRAFT_GENS_B)) {
    const all = gen(full, null, {});
    assert.ok(all.length > 0, `${name}: the tape must make it fire`);
    for (const cutH of [900, 1200, 1500]) {
      const cut = T0 + cutH * H;
      const poisoned = {
        oiHist: full.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1, funding: -r.funding } : r)),
        candleHist: full.candleHist.map((c) => (c.t + H > cut ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)),
      };
      const before = (evs) => evs.filter((e) => e.t <= cut).map((e) => `${e.t}|${e.side}`);
      assert.deepEqual(before(gen(poisoned, null, {})), before(all), `${name} looked past ${cutH}h`);
    }
  }
});

test("the power check on the drafts counts and nothing else", () => {
  const t = tape(1600);
  const res = powerCheck([{ coin: "BTC", ...t }], { days: 30, now: T0 + 1600 * H, reads: DRAFT_GENS_B });
  assert.deepEqual(Object.keys(res).sort(), ["oi_coil_break"]);
  for (const per of Object.values(res)) {
    for (const row of Object.values(per)) {
      for (const k of Object.keys(row)) assert.ok(["events", "gradeable", "longs", "coveredDays"].includes(k), `unexpected field ${k}`);
    }
  }
});
