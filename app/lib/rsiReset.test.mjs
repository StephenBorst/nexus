// rsi_reset_deep's rule lives once (app/lib/rsiReset.mjs): the scoreboard grades it, the brain runs it on paper.
// Kept reference: the scoreboard still grades the moved function itself; and the brain's at-stamp view emits exactly
// the events the generator emits once the next row lands, never one more. Synthetic tapes only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, rsi, rsiResetEvents, rsiResetDeepEvents, rsiResetDeepAtStamp } from "./rsiReset.mjs";
import * as axisbt from "../../workers/nexus-lab-api/axisbt.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 8, 1);
function oiTape(seed, n = 1500) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100;
  return Array.from({ length: n }, (_, i) => { p *= 1 + (rnd() - 0.47) * 0.02; return { t: T0 + i * H + 120000, price: p, oi: 1000, funding: 0 }; });
}

test("moved, not copied: the scoreboard grades the shared function itself", () => {
  assert.equal(axisbt.rsiResetDeepEvents, rsiResetDeepEvents);
  assert.equal(axisbt.rsiResetEvents, rsiResetEvents);
  assert.equal(axisbt.ema, ema);
  assert.equal(axisbt.rsi, rsi);
  assert.equal(axisbt.AXES.find((a) => a.name === "rsi_reset_deep").gen, rsiResetDeepEvents);
  assert.equal(axisbt.AXES.find((a) => a.name === "rsi_reset_held").gen, rsiResetEvents);
});

test("at stamp = the generator's events once the next row lands, on every cut, never one more", () => {
  let total = 0;
  for (const seed of [3, 17, 2026]) {
    const full = oiTape(seed);
    const graded = rsiResetDeepEvents({ oiHist: full }, null, {}).map((e) => `${e.t}|${e.side}`);
    total += graded.length;
    for (let k = 80; k < full.length; k++) {
      const cut = full.slice(0, k);
      const lastT = cut[cut.length - 1].t;
      const live = rsiResetDeepAtStamp({ oiHist: cut }, null, {}).map((e) => `${e.t}|${e.side}`);
      // what the generator emits for these rows once the next row exists = the full run up to the cut
      assert.deepEqual(live, graded.filter((x) => Number(x.split("|")[0]) <= lastT), `seed ${seed} cut ${k}`);
      // and it adds at most the cut's own last row to what the generator says today
      const today = rsiResetDeepEvents({ oiHist: cut }, null, {}).map((e) => `${e.t}|${e.side}`);
      assert.deepEqual(live.filter((x) => Number(x.split("|")[0]) < lastT), today);
    }
  }
  assert.ok(total >= 10, `the tapes must make it fire (${total})`);
});

test("the scoreboard's call shape (ctx in the options slot) changes nothing", () => {
  const full = oiTape(17);
  const ctx = { btcMap: new Map(), btcPrice: new Map(), btcCandles: new Map() };
  assert.deepEqual(rsiResetDeepEvents({ oiHist: full }, null, ctx), rsiResetDeepEvents({ oiHist: full }, null));
  assert.deepEqual(rsiResetDeepAtStamp({ oiHist: [] }, null, ctx), []);
});
