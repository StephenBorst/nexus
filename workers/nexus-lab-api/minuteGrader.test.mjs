// Run: node --test workers/nexus-lab-api/minuteGrader.test.mjs
// The minute grader (minuteGrader.mjs) end to end on a scripted 1-minute tape, plus the rule on minute
// bars (logic.mjs gradeCall with cd.step = 60) and the hand-offs with the hourly pass. In-memory KV,
// injected Orderly, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { gradeCall } from "./logic.mjs";
import { runMinuteGrades, needsRegrade } from "./minuteGrader.mjs";
import { NexusLock } from "./lock.mjs";
import { indexKey, indexPublishedCalls, listMinuteIndex, parseIndexKey, indexMeta } from "./minuteIndex.mjs";
import { gradePublicTheses, computeCallerStats, GRADE_V, PLAN_V } from "./grading.mjs";
import { prepareSeal } from "./labWrite.mjs";
import { M1_KEY, dayOf } from "./minuteCandles.mjs";
import { _pinMinuteGradeFrom, isMinuteGraded, MINUTE_GRADE_FROM_MS } from "../../app/lib/minuteGrade.mjs";
import { readFileSync, readdirSync } from "node:fs";

// Every call in this file is minute-graded, whatever today's date (the real cutoff is pinned below).
_pinMinuteGradeFrom(Date.UTC(2026, 0, 1));

const M = 60, H = 3600, D = 86400;
const W = "0x" + "cd".repeat(20);
const SYM = "PERP_ETH_USDC";

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const meta = new Map();
  const gets = [];
  return {
    m, meta, gets,
    async get(k) { gets.push(k); return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); if (opts?.metadata) meta.set(k, opts.metadata); else meta.delete(k); },
    async delete(k) { m.delete(k); meta.delete(k); },
    async list({ prefix }) {
      return { list_complete: true, keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })) };
    },
  };
}
function minuteOrderly(px) {
  const calls = [];
  const fetchJson = async (url) => {
    const q = new URL(url).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    calls.push({ from, to, res: q.get("resolution") });
    const t = []; for (let x = Math.ceil(from / M) * M; x <= to; x += M) t.push(x);
    if (!t.length) return { s: "no_data" };
    const b = t.map(px);
    return { s: "ok", t, o: b.map((x) => x.c), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c) };
  };
  return { fetchJson, calls };
}

// ── the rule on minute bars ────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 10, 14, 10) / 1000;     // 10:00Z, an hour boundary
const mtape = (bars, start = T0) => ({ step: 60, t: bars.map((_, i) => start + i * M), h: bars.map((b) => b[0]), l: bars.map((b) => b[1]), c: bars.map((b) => b[2] ?? (b[0] + b[1]) / 2) });
const htape = (bars, start = T0) => ({ t: bars.map((_, i) => start + i * H), h: bars.map((b) => b[0]), l: bars.map((b) => b[1]), c: bars.map((b) => b[2] ?? (b[0] + b[1]) / 2) });
const long = (over = {}) => ({ direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: (T0 + 30) * 1000, publishMark: { px: 100, at: 1 }, ...over });

test("minute bars resolve what an hour can't: target at 11:20, stop at 11:40 is a WIN, not a same-candle LOSS", () => {
  const minutes = Array.from({ length: 120 }, (_, i) => (i === 80 ? [110.2, 101] : i === 100 ? [101, 94.8] : [101, 99]));
  // Hourly: the posting hour is bar 0, the 11:00 hour holds both touches.
  assert.equal(gradeCall(long(), htape([[101, 99], [110.2, 94.8]])).outcome, "LOSS", "the hourly rule: both in one hour = a loss");
  const g = gradeCall(long(), mtape(minutes));
  assert.deepEqual([g.outcome, g.r, g.exitAt], ["WIN", 2, T0 + 80 * M]);
  const same = minutes.map((b, i) => (i === 80 ? [110.2, 94.8] : b));
  assert.equal(gradeCall(long(), mtape(same)).outcome, "LOSS", "a minute touching both is still a loss");
});

test("a resting order fills in the minute price reaches it; a stop in that minute counts, a target doesn't", () => {
  const t = long({ entryPrice: 98, stopLoss: 96, takeProfit1: 102 });   // 2% under the 100 mark: resting
  const fillThenTp = mtape([[100.5, 99.5], [100, 97.9], [102.5, 99]]);
  const g = gradeCall(t, fillThenTp);
  assert.deepEqual([g.outcome, g.exitAt], ["WIN", T0 + 2 * M]);
  assert.equal(gradeCall(t, mtape([[100.5, 99.5], [102.5, 97.9]])).outcome, "PENDING", "the fill minute's own high doesn't count");
  assert.equal(gradeCall(t, mtape([[100.5, 99.5], [100, 95.9]])).outcome, "LOSS", "the fill minute's stop does");
});

test("a declared time stop is still counted in hours on minute bars: it settles at the hour's close", () => {
  // Posted 10:00:30 at the market with timeStopH 1: bar 1 = 11:00, the window ends 12:00, and it settles
  // at the close of 11:59 once a 12:00 minute exists, the same price the hourly bar closes at.
  const t = long({ timeStopH: 1, createdAt: Date.UTC(2026, 10, 14, 10, 0, 30) });
  const bars = Array.from({ length: 121 }, (_, i) => [101, 99, i === 119 ? 100.5 : 100]);
  const g = gradeCall(t, mtape(bars));
  assert.deepEqual([g.outcome, g.r, g.exitAt, g.exitReason], ["WIN", 0.1, T0 + 119 * M, "TIME"]);
  assert.equal(gradeCall(t, mtape(bars.slice(0, 120))).outcome, "PENDING", "not until a later minute exists");
});

test("hourly bars grade exactly as before (no step = an hour)", () => {
  const cd = htape([[101, 99], [100, 97.9], [102.5, 99]]);
  const g = gradeCall(long({ entryPrice: 98, stopLoss: 96, takeProfit1: 102 }), cd);
  assert.deepEqual([g.outcome, g.exitAt], ["WIN", T0 + 2 * H]);
});

// ── the trigger ───────────────────────────────────────────────────────────────
test("needsRegrade: a level inside the new or changed minutes, a first stamp, or a time stop due; nothing else", () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const meta = { c: now - 2 * H * 1000, e: 95, sl: 90, t1: 105, g: 1 };
  const ctx = (range) => ({ range, nowMs: now });
  assert.equal(needsRegrade(meta, ctx({ lo: 99, hi: 101 })), false, "price nowhere near: skipped");
  assert.equal(needsRegrade(meta, ctx({ lo: 94.9, hi: 101 })), true, "entry traded");
  assert.equal(needsRegrade(meta, ctx({ lo: 99, hi: 105 })), true, "target touched (inclusive)");
  assert.equal(needsRegrade(meta, ctx(null)), false, "no new or changed minutes");
  assert.equal(needsRegrade({ ...meta, g: undefined }, ctx(null)), true, "never stamped: its first stamp");
  assert.equal(needsRegrade({ ...meta, t2: 100.5 }, ctx({ lo: 99, hi: 101 })), true, "TP2 counts");
  assert.equal(needsRegrade({ ...meta, ts: 4, f: now - 4 * H * 1000 }, ctx(null)), true, "time stop due");
  assert.equal(needsRegrade({ ...meta, ts: 4, f: now - 2 * H * 1000 }, ctx(null)), false, "time stop not due");
  assert.equal(needsRegrade({ ...meta, ts: 4 }, ctx(null)), false, "an unfilled order has no clock");
  assert.equal(needsRegrade(meta, { ...ctx(null), full: true }), true, "the hourly sweep re-grades everything");
});

// ── end to end: post → fill → target ──────────────────────────────────────────
const POST = Date.UTC(2026, 10, 14, 10, 0, 30) / 1000;     // sec
const FILL = POST - 30 + 20 * M;                            // 10:20, the entry trades
const TP = POST - 30 + 50 * M;                              // 10:50, the target trades
const tape = (t) => (t === FILL ? { h: 96, l: 94.8, c: 95.5 } : t === TP ? { h: 105.3, l: 99, c: 105 } : t > TP ? { h: 104.5, l: 103.5, c: 104 } : t > FILL ? { h: 98.5, l: 97.5, c: 98 } : { h: 100.5, l: 99.5, c: 100 });
const resting = (over = {}) => ({ id: "c1", symbol: "ETH", direction: "LONG", entryPrice: 95, stopLoss: 90, takeProfit1: 105, createdAt: POST * 1000, publishMark: { px: 100, at: POST * 1000 }, isPublic: true, status: "ACTIVE", ...over });

async function setup(theses = [resting()]) {
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses } }) };
  await indexPublishedCalls(env.LAB_STORE, W, theses);
  return env;
}
const read = (env) => JSON.parse(env.LAB_STORE.m.get(`lab:${W}`)).theses;
const at = (sec) => () => sec * 1000;

test("a resting call goes WORKING → OPEN at its fill minute → WIN at its target minute, then leaves the index", async () => {
  const env = await setup();
  const o = minuteOrderly(tape);
  const run = (sec, extra = {}) => runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(sec), notify: false, ...extra });

  let r = await run(POST + 5 * M);
  assert.equal(r.triggered, 1, "a new call is graded on its first runs");
  assert.deepEqual([read(env)[0].fillState, read(env)[0].gradedOutcome], ["WORKING", undefined]);
  assert.ok(o.calls.every((c) => c.res === "1"));

  env.LAB_STORE.gets.length = 0;
  r = await run(POST + 15 * M);
  assert.equal(r.triggered, 0, "nothing traded a level: skipped");
  assert.equal(env.LAB_STORE.gets.includes(`lab:${W}`), false, "and its record isn't even read");

  r = await run(POST + 22 * M);
  let c = read(env)[0];
  assert.deepEqual([r.triggered, r.fills, c.fillState, c.filledAt, c.status], [1, 1, "OPEN", FILL * 1000, "ACTIVE"]);
  assert.equal(env.LAB_STORE.meta.get(indexKey(W, "c1")).f, FILL * 1000, "the index learns the fill");

  r = await run(POST + 23 * M);
  assert.equal(r.triggered, 0, "a touch triggers once: the fill minute re-read unchanged is not news");

  r = await run(POST + 52 * M);
  c = read(env)[0];
  assert.deepEqual([c.gradedOutcome, c.gradedR, c.gradeV, c.exitedAt, c.status], ["WIN", 2, GRADE_V, TP * 1000, "HIT_TP"]);
  assert.equal(c.gradedAt, (POST + 52 * M) * 1000);
  assert.equal("fillState" in c, false, "a graded call carries no fill state");
  assert.equal(r.graded, 1);
  assert.equal(env.LAB_STORE.m.has(indexKey(W, "c1")), false, "graded = no longer watched");

  // The archive holds every minute the call was graded on, with no expiry.
  const chunk = JSON.parse(env.LAB_STORE.m.get(M1_KEY(SYM, dayOf(POST))));
  assert.ok(chunk.from <= POST - 60 && chunk.t.includes(FILL) && chunk.t.includes(TP));

  r = await run(POST + 53 * M);
  assert.deepEqual([r.calls, r.triggered], [0, 0], "nothing left to do");
});

test("it writes only the grade fields: plan fields, other calls and an owner's save made meanwhile survive", async () => {
  const hourly = { id: "old", symbol: "BTC", direction: "LONG", entryPrice: 1, stopLoss: 0.5, takeProfit1: 2, createdAt: Date.UTC(2025, 0, 1), isPublic: true };
  const env = await setup([resting(), hourly]);
  // Pretend the call's createdAt predates the cutoff for `old`: it isn't indexed (not minute-graded).
  _pinMinuteGradeFrom(Date.UTC(2026, 0, 1));
  const o = minuteOrderly(tape);
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 5 * M), notify: false });
  // Meanwhile: the hourly pass stamps plan quality, grades the hourly call, and the owner adds a call.
  const rec = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`));
  rec.theses[0].planScore = 77; rec.theses[0].planV = PLAN_V;
  rec.theses[1].gradedOutcome = "LOSS"; rec.theses[1].gradedR = -1;
  rec.theses.push({ id: "new", symbol: "SOL", isPublic: false });
  const realGet = env.LAB_STORE.get.bind(env.LAB_STORE);
  let first = true;
  // The grader reads the record (before those writes), then writes onto a FRESH read (after them).
  const stale = env.LAB_STORE.m.get(`lab:${W}`);
  env.LAB_STORE.get = async (k) => { if (k === `lab:${W}` && first) { first = false; return stale; } return realGet(k); };
  env.LAB_STORE.m.set(`lab:${W}`, JSON.stringify(rec));
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 22 * M), notify: false });
  const [c, old, added] = read(env);
  assert.deepEqual([c.fillState, c.planScore, old.gradedOutcome, added.id], ["OPEN", 77, "LOSS", "new"]);
});

test("the full sweep restores a stamp the trigger can't see: lost to a save made from a stale read", async () => {
  const env = await setup();
  const o = minuteOrderly(tape);
  for (const m of [5, 22]) await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + m * M), notify: false });
  const open = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`));     // the OPEN record, as a stale edge saw it
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 52 * M), notify: false });
  assert.equal(read(env)[0].gradedOutcome, "WIN");
  // An owner's save built on that stale copy writes the call back to OPEN; the index comes back with it
  // (the hourly reconcile), and the target minute is no longer new.
  env.LAB_STORE.m.set(`lab:${W}`, JSON.stringify(open));
  await env.LAB_STORE.put(indexKey(W, "c1"), "1", { metadata: indexMeta(open.theses[0]) });
  let r = await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 60 * M), notify: false });
  assert.deepEqual([r.triggered, read(env)[0].gradedOutcome], [0, undefined], "the minute trigger can't see it");
  r = await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 60 * M), notify: false, full: true });
  const c = read(env)[0];
  assert.deepEqual([c.gradedOutcome, c.gradedR, c.exitedAt], ["WIN", 2, TP * 1000], "the sweep can, on the archived minutes");
  assert.equal(r.graded, 1);
});

test("a minute still printing re-triggers when its high reaches the level", async () => {
  const env = await setup([resting({ entryPrice: 99, stopLoss: 95, takeProfit1: 101, publishMark: { px: 100, at: POST * 1000 } })]);
  // Minute 10:30 is in progress at 10:30:20 (high 100.6) and finishes at 101.2.
  const live = { now: 0 };
  const px = (t) => (t === POST - 30 + 30 * M ? { h: live.now >= (POST + 31 * M) ? 101.2 : 100.6, l: 98.9, c: 100 } : t > POST - 30 + 5 * M && t < POST - 30 + 30 * M ? { h: 100.5, l: 98.9, c: 99.5 } : { h: 100.5, l: 99.5, c: 100 });
  const o = minuteOrderly(px);
  const run = async (sec) => { live.now = sec; return runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(sec), notify: false }); };
  await run(POST + 6 * M);                       // stamped WORKING, then the entry trades at 10:06
  await run(POST + 8 * M);
  assert.equal(read(env)[0].fillState, "OPEN");
  await run(POST + 30 * M - 10);
  assert.equal(read(env)[0].gradedOutcome, undefined, "100.6 isn't the target");
  const r = await run(POST + 31 * M);
  assert.deepEqual([r.triggered, read(env)[0].gradedOutcome], [1, "WIN"], "the same minute, finished at 101.2");
});

// A NexusLock namespace in memory: one object per name, the real lease rule (lock.mjs).
function lockNs() {
  const objs = new Map();
  const store = () => { const m = new Map(); return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
  return {
    idFromName: (n) => n,
    get: (id) => {
      if (!objs.has(id)) objs.set(id, new NexusLock({ storage: store() }));
      return { fetch: (url) => objs.get(id).fetch(new Request(url)) };
    },
  };
}

test("a fill is announced once, even when the next run reads a copy from before the stamp", async () => {
  const env = await setup();
  env.NEXUS_LOCK = lockNs();
  const o = minuteOrderly(tape);
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 5 * M) });
  const working = env.LAB_STORE.m.get(`lab:${W}`);
  const staleMeta = env.LAB_STORE.meta.get(indexKey(W, "c1"));
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 22 * M) });
  const notes = () => JSON.parse(env.LAB_STORE.m.get(`notif:${W}`) || "[]").length;
  assert.equal(notes(), 1, "the fill alert");
  // An edge still serving the WORKING copy, and the full sweep re-grading it a minute later.
  env.LAB_STORE.m.set(`lab:${W}`, working);
  await env.LAB_STORE.put(indexKey(W, "c1"), "1", { metadata: staleMeta });
  await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 23 * M), full: true });
  assert.equal(read(env)[0].fillState, "OPEN", "re-stamped");
  assert.equal(notes(), 1, "not announced twice");
});

test("a call that's no longer public, a copy, or graded leaves the index; notifications don't break the run", async () => {
  const env = await setup([resting(), resting({ id: "c2" }), resting({ id: "c3" })]);
  const rec = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`));
  rec.theses[1].duplicateOf = { wallet: "0x" + "ef".repeat(20) };
  rec.theses[2].isPublic = false;
  env.LAB_STORE.m.set(`lab:${W}`, JSON.stringify(rec));
  const o = minuteOrderly(tape);
  const r = await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + 5 * M) });
  assert.equal(r.dropped, 2);
  assert.deepEqual((await listMinuteIndex(env.LAB_STORE)).map((e) => e.id), ["c1"]);
});

// ── hand-offs: publish, the hourly pass, the board ────────────────────────────
test("publishing a call indexes it for the minute grader, with its frozen levels", async () => {
  const env = { LAB_STORE: kv() };
  const incoming = [{ id: "p1", symbol: "ETH", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97, isPublic: true, createdAt: Date.now() }];
  const prep = await prepareSeal(env, W, [], incoming, Date.now());
  await prep.commit({ theses: [] });
  const [e] = await listMinuteIndex(env.LAB_STORE);
  assert.deepEqual([e.wallet, e.id, e.meta.s, e.meta.e, e.meta.sl, e.meta.t1], [W, "p1", "ETH", 100, 102, 97]);
  assert.deepEqual(parseIndexKey(indexKey(W, "a:b")), { wallet: W, id: "a:b" });
});

function withHourlyOrderly(px, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const t = []; for (let x = Math.ceil(from / H) * H; x <= to; x += H) t.push(x);
    const bars = t.map(px);
    const body = t.length ? { s: "ok", t, o: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c) } : { s: "no_data" };
    return { status: 200, ok: true, json: async () => body };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}

test("the hourly pass never grades a minute call; it stamps its plan + regime and re-indexes it", async () => {
  const posted = Math.floor((Date.now() / 1000 - 3 * D) / H) * H;
  const call = resting({ createdAt: posted * 1000, entryPrice: 2500, stopLoss: 2400, takeProfit1: 2700, publishMark: { px: 2500, at: posted * 1000 } });
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call] } }) };   // never indexed: a lost publish write
  await withHourlyOrderly((t) => (t > posted + 5 * H ? { h: 2750, l: 2600, c: 2720 } : { h: 2520, l: 2480, c: 2500 }), async () => {
    await gradePublicTheses(env);
  });
  const c = read(env)[0];
  assert.equal(c.gradedOutcome, undefined, "hourly bars show the target, but the grade is the minute grader's");
  assert.equal(c.fillState, undefined);
  assert.equal(c.planV, PLAN_V, "plan quality is still the hourly pass's");
  assert.ok(env.LAB_STORE.m.has(indexKey(W, "c1")), "re-indexed");
});

test("the board counts a minute call's sealed stamp, never an hourly re-grade of it", async () => {
  const posted = Math.floor((Date.now() / 1000 - 3 * D) / H) * H;
  const base = { symbol: "ETH", direction: "LONG", entryPrice: 2500, stopLoss: 2400, takeProfit1: 2700, isPublic: true, createdAt: posted * 1000 };
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [
    { ...base, id: "a", gradedOutcome: "WIN", gradedR: 2, gradeV: GRADE_V },
    { ...base, id: "b" },                     // hourly bars say WIN; the minute grader hasn't settled it
  ] } }) };
  await withHourlyOrderly((t) => (t > posted + 5 * H ? { h: 2750, l: 2600, c: 2720 } : { h: 2520, l: 2480, c: 2500 }), async () => {
    const stats = await computeCallerStats(env);
    assert.deepEqual([stats[W].calls, stats[W].wins, stats[W].rSum], [1, 1, 2]);
  });
});

test("the cutoff: calls from 2026-11-13T00:00Z on, and nothing but tests pins it", () => {
  assert.equal(MINUTE_GRADE_FROM_MS, Date.UTC(2026, 10, 13));
  const walk = (dir, out = []) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const p = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(p, out);
      else if (/\.(m?js|tsx?)$/.test(ent.name) && !/\.test\.mjs$/.test(ent.name)) out.push(p);
    }
    return out;
  };
  const root = new URL("../..", import.meta.url).pathname;
  const pinned = [...walk(`${root}app`), ...walk(`${root}workers`)].filter((p) => readFileSync(p, "utf8").includes("_pinMinuteGradeFrom("));
  assert.deepEqual(pinned.map((p) => p.replace(root, "")), ["app/lib/minuteGrade.mjs"], "only the definition");
  _pinMinuteGradeFrom(MINUTE_GRADE_FROM_MS);
  assert.equal(isMinuteGraded({ createdAt: MINUTE_GRADE_FROM_MS - 1 }), false);
  assert.equal(isMinuteGraded({ createdAt: MINUTE_GRADE_FROM_MS }), true);
  _pinMinuteGradeFrom(Date.UTC(2026, 0, 1));
});

test("/verify re-grades a minute call from the archive and links every archived day", async () => {
  const { handleVerify } = await import("./routes-verify.mjs");
  const env = await setup();
  const o = minuteOrderly(tape);
  for (const m of [5, 22, 52]) await runMinuteGrades(env, { fetchJson: o.fetchJson, nowMs: at(POST + m * M), notify: false });
  const calls = o.calls.length;
  // The route reads the archive up to the real clock: give it one that stops where the run did.
  const realNow = Date.now;
  Date.now = () => (POST + 52 * M) * 1000;
  try {
    const res = await handleVerify(["verify", W, "c1"], new Request(`https://og.example/verify/${W}/c1`), env, { now: () => (POST + 52 * M) * 1000 });
    const body = await res.json();
    assert.deepEqual([body.verdict, body.fresh.outcome, body.fresh.r, body.method], ["MATCH", "WIN", 2, "orderly_1m_regrade"]);
    assert.deepEqual(body.archive, [`/candles/1m/${SYM}/${dayOf(POST)}`]);
    assert.match(body.source, /resolution=1/);
    assert.equal(o.calls.length, calls, "no Orderly request on a read");
  } finally { Date.now = realNow; }
});
