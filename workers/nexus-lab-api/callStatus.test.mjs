// Run: node --test workers/nexus-lab-api/callStatus.test.mjs
// GET /theses/status rows and the fill / TP1 alerts the hourly pass sends.
import test from "node:test";
import assert from "node:assert/strict";
import { callState, callStatusRow, fillEvents, fillEventMessage } from "./callStatus.mjs";
import { handleCallStatus, _resetMarkCache } from "./routes-callstatus.mjs";
import { topicForType } from "./push.mjs";

const T0 = 1_790_000_000_000;
const call = (over = {}) => ({
  id: "c1", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 100, stopLoss: 98, takeProfit1: 103, takeProfit2: 108,
  isPublic: true, status: "ACTIVE", createdAt: T0, ...over,
});

test("callState: the grader's stamps decide; a split with its TP1 half closed is RUNNER", () => {
  assert.equal(callState(call({ gradedOutcome: "WIN" })), "WIN");
  assert.equal(callState(call({ fillState: "WORKING" })), "WORKING");
  assert.equal(callState(call({ fillState: "OPEN" })), "OPEN");
  assert.equal(callState(call({ fillState: "OPEN", tp1HitAt: T0 + 3600e3 })), "RUNNER");
  assert.equal(callState(call()), "UNCHECKED");
  assert.equal(callState(call({ publishMark: { px: 100.1 } })), "OPEN", "posted at the market: filled by the grader's own rule");
});

test("callStatusRow: distances from the mark in % and R; an open call carries its move in R", () => {
  const r = callStatusRow(call({ fillState: "OPEN", filledAt: T0, exitPlan: "SPLIT_50" }), 101);
  assert.equal(r.state, "OPEN");
  assert.deepEqual(r.plannedR, { tp1: 1.5, tp2: 4 });
  assert.equal(r.live.moveR, 0.5);
  assert.deepEqual(r.live.levels.tp1, { price: 103, pct: 1.98, r: 1 });
  assert.deepEqual(r.live.levels.stop, { price: 98, pct: -2.97, r: 1.5 });
  assert.equal(r.live.levels.tp2.r, 3.5);
  const short = callStatusRow(call({ direction: "SHORT", stopLoss: 102, takeProfit1: 97, takeProfit2: 0, fillState: "OPEN" }), 99);
  assert.equal(short.live.moveR, 0.5, "signed in the trade's direction");
  assert.equal(short.takeProfit2, null);
  assert.equal("tp2" in short.live.levels, false);
});

test("callStatusRow: a resting order shows whether price has been through the entry since the post", () => {
  const bid = call({ entryPrice: 95, stopLoss: 93, takeProfit1: 98, fillState: "WORKING", publishMark: { px: 100 } });
  assert.equal(callStatusRow(bid, 99).live.crossedEntrySincePost, false);
  assert.equal(callStatusRow(bid, 94.5).live.crossedEntrySincePost, true);
  assert.equal(callStatusRow(bid, 99).live.moveR, undefined, "no position, no move");
  assert.equal(callStatusRow({ ...bid, publishMark: undefined }, 99).live.crossedEntrySincePost, null, "no mark at the post: can't say");
});

test("callStatusRow: graded calls and calls without a mark carry no live block", () => {
  const g = callStatusRow(call({ gradedOutcome: "LOSS", gradedR: -1, gradedAt: T0 + 5 }), 101);
  assert.deepEqual(g.graded, { outcome: "LOSS", r: -1, at: T0 + 5 });
  assert.equal(g.live, null);
  assert.equal(callStatusRow(call({ fillState: "OPEN" }), null).live, null);
});

test("fillEvents: a resting order that traded later, and a split's first half; nothing else", () => {
  const filled = call({ fillState: "OPEN", filledAt: T0 + 3 * 3600e3 });
  assert.deepEqual(fillEvents({ fillState: "WORKING" }, filled), ["FILL"]);
  assert.deepEqual(fillEvents({}, filled), ["FILL"], "filled before the first stamp: still news");
  assert.deepEqual(fillEvents({}, call({ fillState: "OPEN", filledAt: T0 - 500 })), [], "filled at the post: live from the start");
  assert.deepEqual(fillEvents({ fillState: "OPEN" }, filled), [], "already open");
  assert.deepEqual(fillEvents({ fillState: "OPEN" }, { ...filled, tp1HitAt: T0 + 9 }), ["TP1"]);
  assert.deepEqual(fillEvents({ fillState: "OPEN", tp1HitAt: T0 + 9 }, { ...filled, tp1HitAt: T0 + 9 }), []);
  assert.deepEqual(fillEvents({ fillState: "WORKING" }, call()), [], "resolved in the same pass: the resolution says it");
});

test("fillEventMessage: plain words, the levels that matter next; both types are phone-pushed as calls", () => {
  const f = fillEventMessage(call(), "FILL");
  assert.equal(f.type, "call_fill");
  assert.equal(f.message, "BTC LONG filled at 100 · the call is live and graded from here · stop 98, TP1 103");
  const t1 = fillEventMessage(call({ exitPlan: "SPLIT_50" }), "TP1");
  assert.equal(t1.type, "call_tp1");
  assert.equal(t1.message, "BTC LONG reached TP1 103 · half closed +0.75R · runner open to 108, stop 98");
  assert.equal(topicForType("call_fill"), "calls");
  assert.equal(topicForType("call_tp1"), "calls");
});

// ── the route ──────────────────────────────────────────────────────────────────
const W = "0x" + "ab".repeat(20);
const kv = (init) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
};
let ip = 0;
const get = (path) => new Request(`https://og.test${path}`, { headers: { "cf-connecting-ip": `10.1.0.${++ip}` } });
const futures = (marks, counter) => async (url) => {
  counter.n++;
  assert.equal(String(url), "https://api-evm.orderly.org/v1/public/futures");
  return { status: 200, ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ data: { rows: Object.entries(marks).map(([symbol, mark_price]) => ({ symbol, mark_price })) } }), text: async () => JSON.stringify({ data: { rows: Object.entries(marks).map(([symbol, mark_price]) => ({ symbol, mark_price })) } }) };
};

test("GET /theses/status/:wallet: public open calls with live marks, recent grades, nothing private", async () => {
  _resetMarkCache();
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    call({ id: "work", symbol: "ETH", entryPrice: 2400, stopLoss: 2350, takeProfit1: 2500, takeProfit2: 0, fillState: "WORKING", createdAt: T0 + 2 }),
    call({ id: "open", fillState: "OPEN", filledAt: T0, createdAt: T0 + 1 }),
    call({ id: "won", gradedOutcome: "WIN", gradedR: 1.5, gradedAt: T0 + 9 }),
    call({ id: "priv", isPublic: false }),
    call({ id: "hold", holdersOnly: true }),
    call({ id: "dup", duplicateOf: "0x" + "cd".repeat(20) }),
  ] } }) };
  const n = { n: 0 };
  const deps = { fetchImpl: futures({ PERP_BTC_USDC: 101, PERP_ETH_USDC: 2538 }, n), now: () => T0 + 60_000 };
  const res = await handleCallStatus(["theses", "status", W.toUpperCase().replace("0X", "0x")], get(`/theses/status/${W}`), env, deps);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.calls.map((c) => c.id), ["work", "open"], "newest first; private, holders-only and copies left out");
  assert.deepEqual(body.recent.map((c) => c.id), ["won"]);
  assert.deepEqual(body.counts, { working: 1, open: 1, runner: 0, unchecked: 0, recentGraded: 1 });
  assert.equal(body.calls[0].live.mark, 2538, "bare symbols map to the Orderly market");
  assert.equal(body.calls[1].live.moveR, 0.5);
  await handleCallStatus(["theses", "status", W], get(`/theses/status/${W}`), env, deps);
  assert.equal(n.n, 1, "one all-markets read, reused within 20 s");
});

test("GET /theses/status/:wallet: a bad address is refused; Orderly down still answers, without live blocks", async () => {
  _resetMarkCache();
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call({ fillState: "OPEN" })] } }) };
  const bad = await handleCallStatus(["theses", "status", "nope"], get("/theses/status/nope"), env, {});
  assert.equal(bad.status, 400);
  const down = await handleCallStatus(["theses", "status", W], get(`/theses/status/${W}`), env, { fetchImpl: async () => { throw new Error("down"); }, now: () => T0, sleep: async () => {} });
  const body = await down.json();
  assert.equal(body.marksAvailable, false);
  assert.equal(body.calls[0].live, null);
  assert.equal(body.calls[0].state, "OPEN");
  assert.equal(await handleCallStatus(["theses", "leaderboard"], get("/theses/leaderboard"), env, {}), null);
});
