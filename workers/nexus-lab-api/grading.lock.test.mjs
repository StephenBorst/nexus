// Run: node --test workers/nexus-lab-api/grading.lock.test.mjs
// The hourly pass under the publish lock: a published call's grade and status are the server's.
// Stamps from an older grader (or written by a client) are re-derived once, corrections aren't
// announced, and the pass never overwrites a save that landed while it ran.
import test from "node:test";
import assert from "node:assert/strict";
import { gradePublicTheses, GRADE_V, isCurrentStamp } from "./grading.mjs";

const H = 3600, D = 86400;
const W = "0x" + "cd".repeat(20);
const nowS = () => Math.floor(Date.now() / 1000);

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m, onGet: null,
    async get(k) { if (this.onGet) this.onGet(k); return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
// Orderly faked at the network: hourly bars from a price path.
function withOrderly(px, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const t = []; for (let x = Math.ceil(from / H) * H; x <= to; x += H) t.push(x);
    const bars = t.map(px);
    const body = t.length ? { s: "ok", t, o: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c) } : { s: "no_data" };
    return { status: 200, json: async () => body };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}
// A LONG posted 40 days ago (entry 100 / stop 95 / target 110): the target printed on day 2, and
// weeks later the market fell through the stop.
const POSTED = nowS() - 40 * D;
const winThenCrash = (t) => (t < POSTED + 2 * D ? { h: 100.5, l: 99.5, c: 100 }
  : t < POSTED + 2 * D + H ? { h: 111, l: 100, c: 108 }
  : t < nowS() - 20 * D ? { h: 105.5, l: 104.5, c: 105 } : { h: 90.5, l: 89.5, c: 90 });
const flat = () => ({ h: 100.5, l: 99.5, c: 100 });
const call = (over = {}) => ({ id: "c", symbol: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: POSTED * 1000, isPublic: true, status: "ACTIVE", planScore: null, ...over });
const rec = (env) => JSON.parse(env.LAB_STORE.m.get(`lab:${W}`)).theses;

test("an old stamp the call's own window contradicts is re-derived, and the correction isn't announced", () => {
  // Stamped LOSS by the old grader (its window started weeks after the post): the target printed first.
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call({ gradedOutcome: "LOSS", gradedR: -1, gradedAt: 1, status: "STOPPED_OUT" })] } }) };
  return withOrderly(winThenCrash, async () => {
    assert.equal(await gradePublicTheses(env), 0, "a correction isn't a new resolution");
    const t = rec(env)[0];
    assert.deepEqual([t.gradedOutcome, t.gradedR, t.gradeV, t.status], ["WIN", 2, GRADE_V, "HIT_TP"]);
    assert.notEqual(t.gradedAt, 1, "the outcome changed, so it's stamped now");
    assert.equal(env.LAB_STORE.m.has(`notif:${W}`), false, "no 'your call resolved' for a correction");
    assert.ok(isCurrentStamp(t));
  });
});

test("an old stamp the window agrees with only gains the version (and keeps its time)", () => {
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call({ gradedOutcome: "WIN", gradedR: 2, gradedAt: 7, status: "HIT_TP" })] } }) };
  return withOrderly(winThenCrash, async () => {
    await gradePublicTheses(env);
    const t = rec(env)[0];
    assert.deepEqual([t.gradedOutcome, t.gradedR, t.gradedAt, t.gradeV], ["WIN", 2, 7, GRADE_V]);
  });
});

test("a stamp the window doesn't support at all (a self-written WIN) is removed; the call is live again", () => {
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call({ gradedOutcome: "WIN", gradedR: 9, gradedAt: 7, status: "HIT_TP" })] } }) };
  return withOrderly(flat, async () => {
    await gradePublicTheses(env);
    const t = rec(env)[0];
    assert.deepEqual([t.gradedOutcome, t.gradedR, t.gradeV, t.status], [undefined, undefined, undefined, "ACTIVE"]);
  });
});

test("a published call's status is the server's grade: self-marks read as live", () => {
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    call({ id: "a", status: "HIT_TP" }), call({ id: "b", status: "INVALIDATED" }),
    call({ id: "p", isPublic: false, status: "INVALIDATED" }),                 // private: the owner's journal
  ] } }) };
  return withOrderly(flat, async () => {
    await gradePublicTheses(env);
    const [a, b, p] = rec(env);
    assert.equal(a.status, "ACTIVE");
    assert.equal(b.status, "ACTIVE");
    assert.equal(p.status, "INVALIDATED", "private calls keep what the owner wrote");
  });
});

test("a fresh resolution is announced once and is final", () => {
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call()] } }) };
  return withOrderly(winThenCrash, async () => {
    assert.equal(await gradePublicTheses(env), 1);
    assert.equal(JSON.parse(env.LAB_STORE.m.get(`notif:${W}`)).length, 1);
    assert.equal(await gradePublicTheses(env), 0, "a current stamp isn't graded again");
    assert.equal(JSON.parse(env.LAB_STORE.m.get(`notif:${W}`)).length, 1);
  });
});

test("the pass writes onto a fresh read: a call saved while it ran survives", () => {
  const store = kv({ [`lab:${W}`]: { theses: [call()], notes: { d: "n" } } });
  let reads = 0;
  store.onGet = (k) => {
    // The owner saves a new call between the pass's first read and its write.
    if (k === `lab:${W}` && ++reads === 2) store.m.set(k, JSON.stringify({ theses: [call(), call({ id: "new", isPublic: false })], notes: { d: "n2" } }));
  };
  const env = { LAB_STORE: store };
  return withOrderly(winThenCrash, async () => {
    await gradePublicTheses(env);
    const saved = JSON.parse(store.m.get(`lab:${W}`));
    assert.deepEqual(saved.theses.map((t) => t.id), ["c", "new"], "the new call is still there");
    assert.equal(saved.notes.d, "n2", "and so is the note written with it");
    assert.equal(saved.theses[0].gradedOutcome, "WIN", "with the pass's grade on the call it graded");
  });
});
