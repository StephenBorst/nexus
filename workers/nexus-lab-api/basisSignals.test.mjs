// STAGED Oct-15 basis read: what the paid feed would sell == what the agent trades == what the
// scoreboard grades. Run: node --test workers/nexus-lab-api/basisSignals.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { basisStackRead, handleBasisSignals } from "./basisSignals.mjs";
import { basisXcvdEvents } from "./axisbt.mjs";
import { hourBucket, priceByHour } from "../../app/lib/basisStack.mjs";

const H = 3600000;
const T0 = Date.parse("2026-08-01T00:00:00Z");

// Deterministic tape: 240 h of basis / CVD / price with periodic basis extremes (same shape as
// app/lib/basisStack.test.mjs, which pins the brain's gate to the grader).
function tape(s0) {
  let seed = s0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const basisHist = [], cvdHist = [], oiHist = [];
  let price = 100;
  for (let i = 0; i < 240; i++) {
    const t = T0 + i * H + 7 * 60000;
    const spike = i > 60 && i % 17 === 0;
    basisHist.push({ t, basisPct: spike ? (rnd() > 0.5 ? 1 : -1) * (0.5 + rnd()) : (rnd() - 0.5) * 0.1 });
    price *= 1 + (rnd() - 0.5) * 0.02;
    const buy = 1000 * rnd(), sell = 1000 * rnd();
    cvdHist.push({ t, cvd: buy - sell, buy, sell });
    oiHist.push({ t: T0 + i * H + 2 * 60000, price, oi: 1, funding: 0 });
  }
  return { basisHist, cvdHist, oiHist };
}

let fired = 0;
for (const seed of [7, 42, 1337]) {
  test(`parity: the staged paid read == scoreboard basis_x_cvd, hour by hour (seed ${seed})`, () => {
    const cs = tape(seed);
    const graded = new Map(basisXcvdEvents(cs, priceByHour(cs.oiHist)).map((e) => [hourBucket(e.t), e.side]));
    for (let i = 0; i < cs.basisHist.length; i++) {
      const now = cs.basisHist[i].t;
      const r = basisStackRead({ basisHist: cs.basisHist.slice(0, i + 1), cvdHist: cs.cvdHist, oiHist: cs.oiHist }, "CVD", now);
      const want = graded.get(hourBucket(now)) ?? "NONE";
      assert.equal(r.direction, want, `hour ${i}`);
      if (r.direction !== "NONE") fired++;
    }
  });
}
test("parity coverage: the fixtures actually fire the stack (else parity passes vacuously)", () => {
  assert.ok(fired > 0);
});

test("never a fallback: stale / thin basis reads NONE with the reason, not a funding call", () => {
  const cs = tape(7);
  const stale = basisStackRead(cs, "CVD", cs.basisHist.at(-1).t + 10 * H);
  assert.equal(stale.direction, "NONE");
  assert.match(stale.reason, /stale/);
  const thin = basisStackRead({ basisHist: cs.basisHist.slice(0, 5) }, "CVD", cs.basisHist[4].t);
  assert.equal(thin.direction, "NONE");
});

test("flag OFF (today): GET /signals/basis is 404 not_live and reads nothing", async () => {
  let reads = 0;
  const kv = { get: async () => { reads++; return null; }, put: async () => {} };
  const json = (body, _req, status = 200) => ({ status, body });
  const r = await handleBasisSignals(new Request("https://x/signals/basis"), { LAB_STORE: kv, NEXUS_AGENT: kv }, json);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_live");
  assert.equal(reads, 0);
});

test("flag ON: one row per scoreboard market, same rule label, bad confirm refused", async () => {
  const kv = { get: async () => null, put: async () => {} };
  const json = (body, _req, status = 200) => ({ status, body });
  const env = { LAB_STORE: kv, NEXUS_AGENT: kv, BASIS_SIGNALS_LIVE: "true" };
  const r = await handleBasisSignals(new Request("https://x/signals/basis?confirm=cvd"), env, json);
  assert.equal(r.status, 200);
  assert.equal(r.body.signals.length, 12);
  assert.deepEqual(r.body.rule, { signalMode: "BASIS_FADE", basisConfirm: "CVD" });
  assert.ok(r.body.signals.every((s) => s.direction === "NONE")); // empty KV → nothing fires
  const bad = await handleBasisSignals(new Request("https://x/signals/basis?confirm=VIBES"), env, json);
  assert.equal(bad.status, 400);
});
