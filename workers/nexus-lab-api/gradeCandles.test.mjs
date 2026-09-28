// Run: node --test workers/nexus-lab-api/gradeCandles.test.mjs
// Every grader reads candles from the hour a call was posted (gradeCandles.mjs). These pin the page
// plan, the no-holes rule, the budget, the tail refresh, and the bug itself: the leaderboard used to
// grade every call on one fixed [now − 30d − 50h, now] window, so an old WIN could read as a LOSS.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planPages, applyPage, barsFrom, callWindow, makeGradeCandles, candlesForCall, neededFrom, gradeSymbol,
  REGIME_PAD_S, GRADE_PAGE_S, TAIL_REFRESH_MS, TAIL_OVERLAP_S, STORE_TTL_S, GRADE_FLOOR_MS,
} from "./gradeCandles.mjs";
import { gradeCall } from "./logic.mjs";
import { computeCallerStats, gradePublicTheses } from "./grading.mjs";

const H = 3600, D = 86400;
const NOW_MS = Date.UTC(2026, 8, 27, 18, 20, 37);   // an arbitrary second, not on the hour
const NOW_S = Math.floor(NOW_MS / 1000);

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [];
  return {
    m, puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { puts.push({ k, ttl: o && o.expirationTtl }); m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}

// A fake Orderly /tv/history: hourly bars for [from, to] from a price path px(symbol, t).
function fakeOrderly(px, { failWhen = () => false, listedAt = -Infinity } = {}) {
  const calls = [];
  const fn = async (url) => {
    const q = new URL(url).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to")), sym = q.get("symbol");
    calls.push({ sym, from, to });
    if (failWhen({ sym, from, to, n: calls.length })) throw new Error("Orderly didn't return market data (HTTP 403, not JSON). Try again in a minute.");
    const t = [];
    for (let x = Math.ceil(from / H) * H; x <= to; x += H) if (x >= listedAt) t.push(x);
    if (!t.length) return { s: "no_data" };
    const bars = t.map((x) => px(sym, x));
    return { s: "ok", t, o: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c) };
  };
  fn.calls = calls;
  return fn;
}
const flat = (p) => () => ({ h: p + 0.5, l: p - 0.5, c: p });

// ── The bug ──────────────────────────────────────────────────────────────────────────────────
// A LONG posted 40 days ago: entry 100, stop 95, target 110. It hit the target on day 2. Weeks later
// the market fell through 95 and stayed there.
const POSTED_S = NOW_S - 40 * D;
const CALL = { direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: POSTED_S * 1000, symbol: "BTC", isPublic: true, id: "old-win" };
function winThenCrash(now = NOW_S, posted = POSTED_S) {
  return (_sym, t) => {
    if (t < posted + 2 * D) return { h: 100.5, l: 99.5, c: 100 };
    if (t < posted + 2 * D + H) return { h: 111, l: 100, c: 108 };             // target touched
    if (t < now - 20 * D) return { h: 105.5, l: 104.5, c: 105 };
    return { h: 90.5, l: 89.5, c: 90 };                                          // through the stop, weeks later
  };
}

test("the bug: the old fixed window grades an old WIN as a LOSS; the call's own window grades it WIN", async () => {
  const gc = makeGradeCandles({ LAB_STORE: kv() }, { budget: 10, fetchJson: fakeOrderly(winThenCrash()), nowMs: () => NOW_MS });
  const store = await gc.ensure("PERP_BTC_USDC", POSTED_S - REGIME_PAD_S);
  const cd = callWindow(store, CALL.createdAt);
  assert.ok(cd, "the store reaches back to the post");
  assert.deepEqual(gradeCall(CALL, cd), { outcome: "WIN", r: 2 });
  // What the leaderboard used to see: only [now − 30d − 50h, now].
  const winFrom = NOW_S - 30 * D - REGIME_PAD_S;
  const keep = cd.t.map((t, i) => i).filter((i) => cd.t[i] >= winFrom);
  const oldWindow = { t: keep.map((i) => cd.t[i]), h: keep.map((i) => cd.h[i]), l: keep.map((i) => cd.l[i]), c: keep.map((i) => cd.c[i]) };
  assert.equal(gradeCall(CALL, oldWindow).outcome, "LOSS", "the old window started after the target was hit");
});

// ── Page plan ────────────────────────────────────────────────────────────────────────────────
test("plan: a new symbol walks back from now in 20-day pages, contiguous, clamped to what's needed", () => {
  const need = NOW_S - 45 * D;
  const pages = planPages(null, need, NOW_S, NOW_MS);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].to, NOW_S);
  assert.equal(pages[0].reachesNow, true);
  for (let i = 1; i < pages.length; i++) assert.equal(pages[i].to, pages[i - 1].from, "each page ends where the newer one starts");
  assert.equal(pages.at(-1).from, need, "the last page stops at the need, not a full page back");
  assert.ok(pages.every((p) => p.kind === "head" && p.to - p.from <= GRADE_PAGE_S));
});

test("plan: a stale store refreshes its tail first (from a little before its end), then extends its head", () => {
  const store = { v: 2, from: NOW_S - 10 * D, to: NOW_S - 3 * H, fetchedAt: NOW_MS - TAIL_REFRESH_MS, t: [], h: [], l: [], c: [] };
  const pages = planPages(store, NOW_S - 25 * D, NOW_S, NOW_MS);
  assert.deepEqual(pages.map((p) => p.kind), ["tail", "head"]);
  assert.equal(pages[0].from, store.to - TAIL_OVERLAP_S, "re-fetches the bar that may have been a partial hour");
  assert.equal(pages[0].to, NOW_S);
  assert.equal(pages[1].to, store.from);
  assert.equal(pages[1].from, NOW_S - 25 * D);
});

test("plan: a fresh store that already reaches back needs nothing", () => {
  const store = { v: 2, from: NOW_S - 30 * D, to: NOW_S - 60, fetchedAt: NOW_MS - 60_000, t: [], h: [], l: [], c: [] };
  assert.deepEqual(planPages(store, NOW_S - 20 * D, NOW_S, NOW_MS), []);
});

// ── Pages and the store ─────────────────────────────────────────────────────────────────────
test("barsFrom: ok → bars, no_data → an empty page, a challenge or error → throws", () => {
  assert.deepEqual(barsFrom({ s: "ok", t: [1, 2], h: [3, 4], l: [1, 2], c: [2, 3] }), [[1, 3, 1, 2], [2, 4, 2, 3]]);
  assert.deepEqual(barsFrom({ s: "no_data", nextTime: 5 }), []);
  assert.deepEqual(barsFrom({ s: "ok", t: [1, 2], h: [3, "x"], l: [1, 2], c: [2, 3] }), [[1, 3, 1, 2]], "a non-numeric bar is dropped");
  for (const bad of [null, "<!doctype html>", { s: "error", errmsg: "x" }, { s: "ok", t: [1] }]) assert.throws(() => barsFrom(bad));
});

test("applyPage: pages merge only at the store's edges, and a newer copy of a bar replaces the old one", () => {
  const first = applyPage(null, { kind: "head", from: 100 * H, to: 200 * H, reachesNow: true }, [[150 * H, 5, 4, 4.5], [199 * H, 6, 5, 5.5]], NOW_MS);
  assert.equal(first.fetchedAt, NOW_MS);
  const older = applyPage(first, { kind: "head", from: 50 * H, to: 100 * H }, [[60 * H, 3, 2, 2.5]], NOW_MS);
  assert.equal(older.from, 50 * H);
  assert.deepEqual(older.t, [60 * H, 150 * H, 199 * H]);
  const tail = applyPage(older, { kind: "tail", from: 198 * H, to: 210 * H, reachesNow: true }, [[199 * H, 7, 5, 6.5], [209 * H, 8, 6, 7]], NOW_MS + 1);
  assert.equal(tail.h[tail.t.indexOf(199 * H)], 7, "the partial hour was replaced by its closed bar");
  assert.equal(tail.to, 210 * H);
  assert.equal(tail.fetchedAt, NOW_MS + 1);
  assert.throws(() => applyPage(first, { kind: "head", from: 10 * H, to: 90 * H }, [], NOW_MS), /gap/);
  assert.throws(() => applyPage(first, { kind: "tail", from: 205 * H, to: 230 * H }, [], NOW_MS), /gap/);
});

test("callWindow: graded only when the store reaches the post minus the pad and the market printed in that pad", () => {
  const at = NOW_S - 10 * D;
  const bars = [];
  for (let t = at - 5 * D; t <= NOW_S; t += H) bars.push([t, 1, 1, 1]);
  const store = applyPage(null, { kind: "head", from: at - 5 * D, to: NOW_S, reachesNow: true }, bars, NOW_MS);
  assert.equal(callWindow(store, at * 1000), store);
  assert.equal(callWindow(store, (at - 5 * D) * 1000), null, "the store doesn't reach 50h before this one");
  const listedLate = applyPage(null, { kind: "head", from: at - 5 * D, to: NOW_S, reachesNow: true }, bars.filter((b) => b[0] > at), NOW_MS);
  assert.equal(callWindow(listedLate, at * 1000), null, "no bar before the post: not listed yet / no data → not graded");
  assert.equal(callWindow(null, at * 1000), null);
});

// ── Runs: budget, failures, refresh, persistence ────────────────────────────────────────────
test("neededFrom + gradeSymbol: a malformed post time or symbol is never graded and costs no page", () => {
  assert.equal(neededFrom(CALL.createdAt), POSTED_S - REGIME_PAD_S);
  assert.equal(neededFrom(String(CALL.createdAt)), POSTED_S - REGIME_PAD_S, "a numeric string is the same post time");
  for (const bad of [undefined, null, "", "2026-08-18T00:00:00Z", NaN, Infinity, 1, GRADE_FLOOR_MS - 1]) {
    assert.equal(neededFrom(bad), null, `createdAt ${String(bad)} can't be a real post`);
  }
  assert.equal(gradeSymbol("BTC"), "PERP_BTC_USDC");
  assert.equal(gradeSymbol("perp_btc_usdc"), "PERP_BTC_USDC");
  assert.equal(gradeSymbol("BTC/USDT:USDT"), null, "not an Orderly market id: never fetched");
  const store = { v: 2, from: 0, to: NOW_S, fetchedAt: NOW_MS, t: [NOW_S - 100 * H], h: [1], l: [1], c: [1] };
  assert.equal(callWindow(store, GRADE_FLOOR_MS - H * 1000), null, "before 2026: never graded, whatever the store holds");
});

test("a cold run with a small budget gives every symbol its newest page before any goes deeper", async () => {
  const fake = fakeOrderly(flat(100));
  const gc = makeGradeCandles({ LAB_STORE: kv() }, { budget: 4, fetchJson: fake, nowMs: () => NOW_MS });
  const need = NOW_S - 50 * D; // 3 pages each
  const stores = await gc.ensureAll({ PERP_A_USDC: need, PERP_B_USDC: need, PERP_C_USDC: need });
  assert.deepEqual(fake.calls.map((c) => c.sym), ["PERP_A_USDC", "PERP_B_USDC", "PERP_C_USDC", "PERP_A_USDC"]);
  for (const s of ["PERP_A_USDC", "PERP_B_USDC", "PERP_C_USDC"]) assert.equal(stores[s].to, NOW_S, `${s} ends at now`);
  assert.equal(stores.PERP_A_USDC.from, NOW_S - 2 * GRADE_PAGE_S);
  assert.equal(stores.PERP_B_USDC.from, NOW_S - GRADE_PAGE_S);
  assert.equal(gc.pagesUsed(), 4);
  // A call 10 days old is gradeable everywhere already; one 45 days old nowhere yet (never on a partial window).
  for (const s of ["PERP_A_USDC", "PERP_B_USDC", "PERP_C_USDC"]) {
    assert.ok(callWindow(stores[s], (NOW_S - 10 * D) * 1000));
    assert.equal(callWindow(stores[s], (NOW_S - 45 * D) * 1000), null);
  }
});

test("a refused page stops that symbol for the run without leaving a hole; the next run picks up where it stopped", async () => {
  const store = kv();
  const need = NOW_S - 50 * D;
  const refuseSecond = fakeOrderly(flat(100), { failWhen: ({ n }) => n === 2 });
  const run1 = makeGradeCandles({ LAB_STORE: store }, { budget: 10, fetchJson: refuseSecond, nowMs: () => NOW_MS });
  const s1 = await run1.ensure("PERP_BTC_USDC", need);
  await run1.flush();
  assert.equal(s1.from, NOW_S - GRADE_PAGE_S, "kept the page it got; stopped at the refused one");
  assert.equal(refuseSecond.calls.length, 2, "no retry of a refused symbol in the same run");
  const ok = fakeOrderly(flat(100));
  const run2 = makeGradeCandles({ LAB_STORE: store }, { budget: 10, fetchJson: ok, nowMs: () => NOW_MS + 60_000 });
  const s2 = await run2.ensure("PERP_BTC_USDC", need);
  assert.equal(s2.from, need);
  assert.deepEqual(ok.calls.map((c) => c.to), [NOW_S - GRADE_PAGE_S, NOW_S - 2 * GRADE_PAGE_S], "continued backward from the kept page");
  for (let i = 1; i < s2.t.length; i++) assert.equal(s2.t[i] - s2.t[i - 1], H, "one bar every hour, no hole");
});

test("the tail is re-fetched after 30 minutes, replacing the partial hour; a fresh covered store costs no pages", async () => {
  const store = kv();
  let closed = false;
  const px = (_s, t) => (t === Math.floor(NOW_S / H) * H && closed ? { h: 120, l: 99, c: 101 } : { h: 100.5, l: 99.5, c: 100 });
  const fake = fakeOrderly(px);
  const run1 = makeGradeCandles({ LAB_STORE: store }, { budget: 10, fetchJson: fake, nowMs: () => NOW_MS });
  await run1.ensure("PERP_ETH_USDC", NOW_S - 5 * D);
  await run1.flush();
  assert.equal(store.puts[0].ttl, STORE_TTL_S);
  const idle = makeGradeCandles({ LAB_STORE: store }, { budget: 10, fetchJson: fake, nowMs: () => NOW_MS + 60_000 });
  await idle.ensure("PERP_ETH_USDC", NOW_S - 5 * D);
  assert.equal(idle.pagesUsed(), 0);
  closed = true;
  const later = NOW_MS + TAIL_REFRESH_MS + 5_000;
  const run2 = makeGradeCandles({ LAB_STORE: store }, { budget: 10, fetchJson: fake, nowMs: () => later });
  const s = await run2.ensure("PERP_ETH_USDC", NOW_S - 5 * D);
  assert.equal(run2.pagesUsed(), 1);
  assert.equal(fake.calls.at(-1).from, NOW_S - TAIL_OVERLAP_S);
  assert.equal(s.h[s.t.indexOf(Math.floor(NOW_S / H) * H)], 120, "the hour that was partial now has its closed high");
  assert.equal(s.to, Math.floor(later / 1000));
});

test("candlesForCall: one call, its own window, written back for the next reader", async () => {
  const store = kv();
  // Tests never touch the real Orderly (CI can reach it; the sandbox can't): a refusal is injected.
  const refused = makeGradeCandles({ LAB_STORE: store }, { budget: 6, fetchJson: async () => { throw new Error("HTTP 403, not JSON"); }, nowMs: () => NOW_MS });
  const cd = await candlesForCall({ LAB_STORE: store }, "BTC", CALL.createdAt, { gc: refused });
  assert.equal(cd, null, "Orderly refused: null means not graded, never a guess");
  await refused.flush();
  assert.equal(store.m.size, 0, "a refused page writes nothing");
  const gc = makeGradeCandles({ LAB_STORE: store }, { budget: 6, fetchJson: fakeOrderly(winThenCrash()), nowMs: () => NOW_MS });
  const cd2 = await candlesForCall({ LAB_STORE: store }, "BTC", CALL.createdAt, { gc });
  assert.equal(gradeCall(CALL, cd2).outcome, "WIN");
  await gc.flush();
  assert.ok(store.m.has("tvhist:v2:PERP_BTC_USDC"), "bare BTC and PERP_BTC_USDC share one store");
});

// ── The leaderboard and the cron, end to end (Orderly faked at the network) ──────────────────
function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({ status: 200, json: async () => fake(String(url)) });
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}
const W = "0x" + "ab".repeat(20);
const nowS = () => Math.floor(Date.now() / 1000);

test("leaderboard: an old call is graded on its own window; with too small a budget it's left out, not mis-graded", () => {
  const posted = nowS() - 40 * D;
  const call = { ...CALL, createdAt: posted * 1000 };
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call], notes: {} } }) };
  return withFetch(fakeOrderly(winThenCrash(nowS(), posted)), async () => {
    const thin = await computeCallerStats(env, 30 * D, { pageBudget: 1 });
    assert.equal(thin[W], undefined, "one page doesn't reach the post: not graded on this read");
    const full = await computeCallerStats(env, 30 * D);
    assert.equal(full[W].calls, 1);
    assert.equal(full[W].wins, 1, "graded WIN on its own window (the old fixed window said LOSS)");
    assert.equal(full[W].rSum, 2);
  });
});

test("leaderboard: one malformed call can't block its symbol or send the store back years", () => {
  const posted = nowS() - 40 * D;
  const good = { ...CALL, id: "good", createdAt: posted * 1000 };
  const theses = [
    good,
    { ...CALL, id: "epoch", createdAt: 1000 },                        // 1970: would be ~1,000 pages back
    { ...CALL, id: "iso", createdAt: "2026-08-18T00:00:00Z" },        // not a number
    { ...CALL, id: "junk", symbol: "BTC/USDT:USDT" },                  // not a market id
  ];
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses, notes: {} } }) };
  const fake = fakeOrderly(winThenCrash(nowS(), posted));
  return withFetch(fake, async () => {
    const stats = await computeCallerStats(env, 30 * D);
    assert.equal(stats[W].calls, 1, "only the real call is graded");
    assert.equal(stats[W].wins, 1);
    assert.ok(fake.calls.length <= 3, `the good call's window is 2–3 pages (got ${fake.calls.length})`);
    assert.ok(fake.calls.every((c) => c.sym === "PERP_BTC_USDC"), "the junk symbol is never fetched");
    assert.ok(Math.min(...fake.calls.map((c) => c.from)) >= posted - REGIME_PAD_S, "no page before the real call needs");
  });
});

test("cron: an unresolved call older than the old 60-day cap is stamped from its own window", () => {
  const posted = nowS() - 70 * D;
  const call = { ...CALL, id: "c70", createdAt: posted * 1000 };
  const env = { LAB_STORE: kv({ [`lab:${W}`]: { theses: [call], notes: {} } }) };
  return withFetch(fakeOrderly(winThenCrash(nowS(), posted)), async () => {
    const n = await gradePublicTheses(env);
    assert.equal(n, 1);
    const t = JSON.parse(env.LAB_STORE.m.get(`lab:${W}`)).theses[0];
    assert.equal(t.gradedOutcome, "WIN", "the target was hit on day 2; the old window started at day 10");
    assert.equal(t.gradedR, 2);
    assert.ok(env.LAB_STORE.m.has("tvhist:v2:PERP_BTC_USDC"), "the pass wrote the store back for the board to read");
  });
});
