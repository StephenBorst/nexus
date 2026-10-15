// Run: node --test workers/nexus-lab-api/grading.fill.test.mjs
// Has a call's entry traded? A limit entry away from the market is a resting order: until price
// reaches it there is no position, so a card must not show P&L for it. The hourly pass stamps
// `fillState` (WORKING / OPEN) + `filledAt` on every unresolved public call, by the same rule the
// grader grades on (entryFill), and a client save can't write either field.
import test from "node:test";
import assert from "node:assert/strict";
import { entryFill, gradeCall } from "./logic.mjs";
import { applyFillStamp, gradePublicTheses, PLAN_V } from "./grading.mjs";
import { sealTheses } from "./callLock.mjs";

const H = 3600, D = 86400;
const W = "0x" + "ab".repeat(20);
const nowS = () => Math.floor(Date.now() / 1000);

// ── entryFill: the rule, on a hand-built tape ─────────────────────────────────
const t0 = 1_000_000 * 3600; // an hour boundary, in seconds
const tape = (bars) => ({ t: bars.map((_, i) => t0 + i * H), h: bars.map((b) => b[0]), l: bars.map((b) => b[1]) });
const long = (over = {}) => ({ direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: t0 * 1000, ...over });

test("an entry inside the posting hour's range is filled at the post", () => {
  const f = entryFill(long(), tape([[101, 99], [102, 100]]));
  assert.deepEqual(f, { filled: true, atPost: true, fillSec: t0, fillIdx: -1, next: 0 });
});

test("a limit below the market fills in the first hour that reaches it, not before", () => {
  // ETH-style: entry 95 posted with price ~100, price comes down to it in hour 3.
  const cd = tape([[101, 99], [100, 98], [99, 96], [97, 94.5], [99, 96]]);
  const f = entryFill(long({ entryPrice: 95, stopLoss: 90, takeProfit1: 105 }), cd);
  assert.deepEqual(f, { filled: true, atPost: false, fillSec: t0 + 3 * H, fillIdx: 3, next: 4 });
});

test("a limit price never reaches is not filled, however far price runs the other way", () => {
  // The bug report: LONG entry 2400, mark ~2538. Price never trades down to the entry.
  const cd = tape([[2530, 2510], [2545, 2520], [2560, 2530]]);
  const t = long({ entryPrice: 2400, stopLoss: 2350, takeProfit1: 2700 });
  assert.deepEqual(entryFill(t, cd), { filled: false });
  assert.deepEqual(gradeCall(t, cd), { outcome: "PENDING", r: 0, awaitingEntry: true }, "the grader agrees: nothing to grade");
});

test("with a mark read at publish, 'at the market' means within 0.3% of that mark", () => {
  const cd = tape([[101, 98], [101, 99]]);
  assert.equal(entryFill(long({ entryPrice: 100, publishMark: { px: 100.2, at: 1 } }), cd).atPost, true);
  // Posted mid-hour: 98.5 sits inside the posting hour's range (the old rule would call it filled),
  // but it is 1.7% off the mark, so it is a resting order, and the next hour never reaches it.
  const mid = { createdAt: (t0 + 1800) * 1000, entryPrice: 98.5, stopLoss: 95 };
  assert.equal(entryFill(long(mid), cd).atPost, true, "no mark: the hour-range rule");
  assert.deepEqual(entryFill(long({ ...mid, publishMark: { px: 100.2, at: 1 } }), cd), { filled: false });
});

// ── applyFillStamp: what the pass writes ──────────────────────────────────────
test("an unfilled call is WORKING with no fill time; once it fills it is OPEN with one", () => {
  const t = long({ entryPrice: 95, stopLoss: 90, takeProfit1: 105 });
  const before = tape([[101, 99], [100, 98]]);
  assert.equal(applyFillStamp(t, gradeCall(t, before), before), true);
  assert.equal(t.fillState, "WORKING");
  assert.equal("filledAt" in t, false);
  assert.equal(applyFillStamp(t, gradeCall(t, before), before), false, "unchanged on the next pass = no write");

  const after = tape([[101, 99], [100, 98], [97, 94.8], [98, 96]]);
  assert.equal(applyFillStamp(t, gradeCall(t, after), after), true);
  assert.deepEqual([t.fillState, t.filledAt], ["OPEN", (t0 + 2 * H) * 1000]);
});

test("a graded or invalid call carries no fill state", () => {
  const t = long({ fillState: "OPEN", filledAt: 5 });
  const cd = tape([[101, 99], [111, 100]]); // filled at the post, target next hour
  assert.equal(gradeCall(t, cd).outcome, "WIN");
  assert.equal(applyFillStamp(t, gradeCall(t, cd), cd), true);
  assert.equal("fillState" in t || "filledAt" in t, false);

  const bad = long({ takeProfit1: 90, fillState: "WORKING" }); // target on the wrong side
  applyFillStamp(bad, gradeCall(bad, cd), cd);
  assert.equal("fillState" in bad, false);
});

// ── the hourly pass, end to end ───────────────────────────────────────────────
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
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
const POSTED = Math.floor((nowS() - 3 * D) / H) * H;
const call = (over = {}) => ({ symbol: "ETH", direction: "LONG", stopLoss: 2350, takeProfit1: 2900, createdAt: POSTED * 1000, isPublic: true, status: "ACTIVE", planScore: null, ...over });

test("the pass stamps a limit that never filled WORKING and a call at the market OPEN", () => {
  const drift = () => ({ h: 2545, l: 2525, c: 2538 }); // ETH ~2538 the whole time
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    call({ id: "limit", entryPrice: 2400 }),       // the reported card: resting long, never reached
    call({ id: "market", entryPrice: 2538 }),      // posted at the market: a live position
  ] } }) };
  return withOrderly(drift, async () => {
    await gradePublicTheses(env);
    const [limit, market] = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`)).theses;
    assert.deepEqual([limit.fillState, limit.filledAt, limit.status], ["WORKING", undefined, "ACTIVE"]);
    assert.deepEqual([market.fillState, market.filledAt], ["OPEN", POSTED * 1000]);
    assert.equal(limit.gradedOutcome, undefined, "display state only: nothing graded");
  });
});

test("a client save can't write fillState or filledAt", () => {
  const prev = [{ id: "x", symbol: "ETH", isPublic: false, fillState: "WORKING" }];
  const incoming = [{ id: "x", symbol: "ETH", isPublic: false, fillState: "OPEN", filledAt: 123 }];
  const { theses } = sealTheses({ prev, incoming, registry: null, now: Date.now() });
  const x = theses.find((t) => t.id === "x");
  assert.equal(x.fillState, "WORKING", "the server's value stays");
  assert.equal("filledAt" in x, false);
});

// ── a declared split's runner (2026-10-12) ────────────────────────────────────
test("a split whose TP1 half closed carries tp1HitAt while the runner is open, and nothing once it closes", () => {
  const t = long({ entryPrice: 100, stopLoss: 98, takeProfit1: 103, takeProfit2: 108, exitPlan: "SPLIT_50" });
  const half = tape([[101, 99], [103.5, 100], [105, 101]]);
  assert.equal(applyFillStamp(t, gradeCall(t, half), half), true);
  assert.deepEqual([t.fillState, t.filledAt, t.tp1HitAt], ["OPEN", t0 * 1000, (t0 + H) * 1000]);
  assert.equal(applyFillStamp(t, gradeCall(t, half), half), false, "unchanged = no write");
  const done = tape([[101, 99], [103.5, 100], [108.5, 104]]);
  assert.equal(gradeCall(t, done).r, 2.75);
  applyFillStamp(t, gradeCall(t, done), done);
  assert.equal("tp1HitAt" in t || "fillState" in t, false);
});

// ── plan quality re-derived once under the new LATE_ENTRY rule ────────────────
test("the pass re-stamps an old LATE_ENTRY on a resting bid once, then leaves it", () => {
  const drift = () => ({ h: 2545, l: 2525, c: 2538 });
  // Stamped by the old rule: a limit bid 138 under the market lost 30 points.
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    call({ id: "bid", entryPrice: 2400, planScore: 70, planFlags: ["LATE_ENTRY"] }),
  ] } }) };
  return withOrderly(drift, async () => {
    await gradePublicTheses(env);
    const [bid] = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`)).theses;
    assert.deepEqual([bid.planScore, bid.planFlags, bid.planV], [100, [], PLAN_V]);
    const before = env.LAB_STORE.m.get(`lab:${W}`);
    await gradePublicTheses(env);
    assert.equal(env.LAB_STORE.m.get(`lab:${W}`), before, "stamped once");
  });
});

// ── the fill alert (callStatus.mjs fillEvents → resolutions.mjs notifyFillEvent) ──
test("a resting order that fills on a later pass alerts its owner once; one filled at the post doesn't", async () => {
  const flat = () => ({ h: 2545, l: 2525, c: 2538 });
  const env1 = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    call({ id: "limit", entryPrice: 2400 }),
    call({ id: "market", entryPrice: 2538 }),
  ] } }) };
  await withOrderly(flat, () => gradePublicTheses(env1));
  assert.equal(env1.LAB_STORE.m.get(`notif:${W}`), undefined, "nothing filled later: no alert");
  // A later pass (fresh candle store) where price dipped to the bid a day after the post.
  const dip = (t) => (t >= POSTED + D && t < POSTED + D + 2 * H ? { h: 2420, l: 2395, c: 2410 } : flat());
  const env2 = { LAB_STORE: kv({ [`lab:${W}`]: env1.LAB_STORE.m.get(`lab:${W}`) }) };
  await withOrderly(dip, () => gradePublicTheses(env2));
  const notifs = JSON.parse(env2.LAB_STORE.m.get(`notif:${W}`) || "[]");
  assert.deepEqual(notifs.map((n) => [n.type, n.thesisId]), [["call_fill", "limit"]]);
  assert.match(notifs[0].message, /^ETH LONG filled at 2400/);
  await withOrderly(dip, () => gradePublicTheses(env2));
  assert.equal(JSON.parse(env2.LAB_STORE.m.get(`notif:${W}`)).length, 1, "no repeat on the next pass");
});
