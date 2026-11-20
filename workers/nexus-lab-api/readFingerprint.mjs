// ── A registered read's fingerprint: what its rule DOES, frozen at registration (borst 2026-11-20) ─────────────────
// pipeline-if-then.md "Reads no longer retire": registrations no longer need a signature; they stay frozen by
// fingerprint. The fingerprint is behavioural: the read's own scoreboard generator (axisbt AXES, called as buildEvents
// calls it: the OI price spine, BTC's candles as context) runs on fixed seeded tapes, and the events it fires
// (time + side) are hashed. A change to the rule, a threshold or a helper it uses changes the events and so the hash;
// a faster body that fires identical events keeps it (the kept-reference rule the scoreboard already follows).
//
// The record is app/lib/readFingerprints.mjs: one frozen entry per registered read, written with its registration.
// readFingerprint.test.mjs recomputes every hash and fails on any difference. There is no "update": a read whose events
// change is a NEW read, with a new name and a new registration date. The tapes are pinned too (TAPES_SHA256): a future
// read that needs a series these tapes lack gets a second tape set recorded beside this one, never an edit to it.
//
// Its limit, said plainly: a gate that never binds on these tapes isn't seen. The tapes are wide on purpose (random
// walks with calm and busy stretches, every series the reads use, a falling stretch for the short-only reads).
//
// Print the current fingerprints (to record a new registration): node workers/nexus-lab-api/readFingerprint.mjs
import { createHash } from "node:crypto";
import { AXES } from "./axisbt.mjs";
import { priceByHour, hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);

// Tape A: the seeded random tape the no-lookahead test uses (explorerReads.test.mjs `tape`), copied here and frozen
// (TAPES_SHA256 in app/lib/readFingerprints.mjs), so editing that test never moves a fingerprint.
function tapeA(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000;
  const oiHist = [], candleHist = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 60 ? 0.3 : 1.5);
    oi *= 1 + (rnd() - 0.5) * 0.03;
    const hi = Math.max(o, p) * (1 + rnd() * 0.006), lo = Math.min(o, p) * (1 - rnd() * 0.006);
    candleHist.push({ t: T0 + i * H, o, h: hi, l: lo, c: p, v: 1 });
    oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 });
  }
  let f = (seed * 7919) >>> 0;
  const frnd = () => { f = (f * 1103515245 + 12345) >>> 0; return f / 2 ** 32; };
  const cvdHist = [], spotCvdHist = [];
  for (let i = 0; i < n; i++) {
    cvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(frnd() * 100), sell: Math.round(frnd() * 100) });
    spotCvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(frnd() * 100), sell: Math.round(frnd() * 100) });
  }
  for (const r of oiHist) if (Math.floor((r.t - T0) / H / 24) % 5 === 0) r.oi = 1000;
  let g = (seed * 104729) >>> 0;
  const grnd = () => { g = (g * 22695477 + 1) >>> 0; return g / 2 ** 32; };
  const basisHist = [];
  let bx = 0;
  for (let i = 0; i < n; i++) { bx += (grnd() - 0.5) * 0.02; basisHist.push({ t: T0 + i * H + 300000, basisPct: bx }); }
  let q = (seed * 15485863) >>> 0;
  const qrnd = () => { q = (q * 214013 + 2531011) >>> 0; return q / 2 ** 32; };
  const smHist = [];
  for (let i = 0; i < n; i++) {
    const long = Math.floor(qrnd() * 8), short = Math.floor(qrnd() * 8);
    if (Math.max(long, short) >= 2) smHist.push({ t: T0 + i * H + 600000, side: long >= short ? "LONG" : "SHORT", long, short });
  }
  return { oiHist, candleHist, cvdHist, spotCvdHist, basisHist, smHist };
}

// Tape B: a drifting-down candle tape with volume bursts (the shelf_breakdown_short no-lookahead tape), with an OI row
// per hour on the same prices so the OI-spine reads see it too.
function tapeB(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100;
  const candleHist = Array.from({ length: n }, (_, i) => {
    const o = p; p *= 1 + (rnd() - 0.55) * 0.02;
    return { t: T0 + i * H, o, h: Math.max(o, p) * (1 + rnd() * 0.003), l: Math.min(o, p) * (1 - rnd() * 0.003), c: p, v: 50 + rnd() * 100 * (rnd() < 0.25 ? 5 : 1) };
  });
  const oiHist = candleHist.map((c, i) => ({ t: c.t + 120000, price: c.c, oi: 1000 * (1 + 0.1 * Math.sin(i / 37)), funding: 0.0001 * Math.cos(i / 53) }));
  return { oiHist, candleHist, cvdHist: [], spotCvdHist: [], basisHist: [], smHist: [] };
}

let cached = null;
/** The fixed inputs every fingerprint runs on (built once). */
export function fingerprintTapes() {
  if (cached) return cached;
  const btc = tapeA(3000, 3);
  const ctx = { btcCandles: new Map(btc.candleHist.map((c) => [hourBucket(c.t), c])) };
  cached = [
    { id: "A7", cs: { coin: "ETH", ...tapeA(3000, 7) }, ctx },
    { id: "A19", cs: { coin: "SOL", ...tapeA(3000, 19) }, ctx },
    { id: "B11", cs: { coin: "ARB", ...tapeB(3000, 11) }, ctx },
  ];
  return cached;
}

/** sha256 over the tapes themselves: pinned, so a fingerprint can't move because its inputs did. */
export function tapeSha256() {
  const h = createHash("sha256");
  for (const t of fingerprintTapes()) h.update(`${t.id}\n${JSON.stringify(t.cs)}\n`);
  return h.digest("hex");
}

/** The events a read fires on the fixed tapes, as `tape|t|side` lines, and their sha256. */
export function readFingerprint(name) {
  const axis = AXES.find((a) => a.name === name);
  if (!axis) throw new Error(`${name} is not on the scoreboard`);
  const lines = [];
  for (const t of fingerprintTapes()) {
    for (const e of axis.gen(t.cs, priceByHour(t.cs.oiHist), t.ctx) || []) if (e) lines.push(`${t.id}|${e.t}|${e.side}`);
  }
  return { events: lines.length, sha256: createHash("sha256").update(`${name}\n${lines.join("\n")}`).digest("hex") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { REGISTERED_READS } = await import("../../app/lib/readPipeline.mjs");
  console.log(JSON.stringify({ tapes: tapeSha256(), reads: Object.fromEntries(REGISTERED_READS.map((r) => [r.axis, readFingerprint(r.axis)])) }, null, 2));
}
