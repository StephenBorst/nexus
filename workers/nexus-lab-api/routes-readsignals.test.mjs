// GET /signals/read/:axis (routes-readsignals.mjs): no signals at all until the read is CLEARED, re-checked each request.
// Run: node --test workers/nexus-lab-api/routes-readsignals.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handleReadSignals, SOLD_CACHE_KEY } from "./routes-readsignals.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";

const KEY = "axisbt:test";
const T = Date.UTC(2026, 11, 30, 5, 10);
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}
const board = (stage = "PAPER") => ({ asOf: "2026-12-30T04:53:00Z", pipeline: { reads: [{ axis: "btc_lead_lag", stage, failing: null, numbers: { events: 150, meanR: 0.45, beatsRandomPct: 96.8 } }] } });
const PASS = { verdict: "PASS", randomCheck: { verdict: "BEAT", pctBeaten: 93 } };
const req = () => new Request("https://og.test/signals/read/btc_lead_lag");
const call = (env, o = {}) => handleReadSignals(["signals", "read", "btc_lead_lag"], req(), env, { scorecardKey: KEY, now: () => T, locks: {}, ...o });

test("today (TRADEABLE, no paper verdict): 403 not_cleared, no signals, and the read is never run", async () => {
  let ran = 0;
  const env = { LAB_STORE: kv({ [KEY]: board("TRADEABLE") }), NEXUS_AGENT: kv({}) };
  const res = await call(env, { read: async () => { ran++; return []; } });
  assert.equal(res.status, 403);
  const b = await res.json();
  assert.equal(b.cleared, false); assert.equal(b.error, "not_cleared"); assert.ok(!("signals" in b));
  assert.equal(ran, 0);
});

test("cleared: 200 with the grade and the brain's rows, cached 5 min", async () => {
  let ran = 0;
  const env = { LAB_STORE: kv({ [KEY]: board(), [PJUDGE_KEY("btc_lead_lag")]: PASS }), NEXUS_AGENT: kv({}) };
  const read = async () => { ran++; return [{ symbol: "ETH", side: "LONG", event_at: "2026-12-30T05:00:00.000Z", reason: "x" }]; };
  const b = await (await call(env, { read })).json();
  assert.equal(b.ok, true); assert.equal(b.cleared, true); assert.equal(b.grade.cleared, true); assert.equal(b.signals[0].side, "LONG");
  await call(env, { read });
  assert.equal(ran, 1, "second call within 5 min serves the cache");
  assert.ok(env.LAB_STORE.m.has(SOLD_CACHE_KEY("btc_lead_lag")));
});

test("a cached copy is never served once the gate closes (a lock, a failing label, a lost stage)", async () => {
  const env = { LAB_STORE: kv({ [KEY]: board(), [PJUDGE_KEY("btc_lead_lag")]: PASS, [SOLD_CACHE_KEY("btc_lead_lag")]: { at: new Date(T).toISOString(), signals: [{ symbol: "ETH", side: "LONG" }] } }), NEXUS_AGENT: kv({}) };
  const locked = await call(env, { locks: { btc_lead_lag: {} } });
  assert.equal(locked.status, 403); assert.ok(!("signals" in (await locked.json())));
  env.LAB_STORE.m.set(KEY, JSON.stringify(board("REGISTERED")));
  assert.equal((await call(env)).status, 403);
});

test("unread board or unbound store: 503, nothing sold", async () => {
  assert.equal((await call({ LAB_STORE: kv({}), NEXUS_AGENT: kv({}) })).status, 503);
  assert.equal((await call({ LAB_STORE: null, NEXUS_AGENT: kv({}) })).status, 503);
});

test("the last-good board copy is read when the live key is gone; other routes pass through", async () => {
  const env = { LAB_STORE: kv({ [`${KEY}:lastgood`]: board("TRADEABLE") }), NEXUS_AGENT: kv({}) };
  assert.equal((await call(env)).status, 403);
  assert.equal(await handleReadSignals(["signals", "basis"], req(), env, { scorecardKey: KEY }), null);
});
