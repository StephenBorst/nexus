// Run: node --test workers/nexus-lab-api/minuteCandles.test.mjs
// The 1-minute archive minute-graded calls are graded on (minuteCandles.mjs). Hand-built bars, an
// injected Orderly, an in-memory KV: no network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planDayPages, applyMinutePage, windowFrom, rangeSince, makeMinuteCandles, loadMinuteWindow,
  handleMinuteArchive, minuteBarsFrom, minuteNeededFrom, dayOf, daysBetween, M1_KEY, M1_PAGE_S, M1_OVERLAP_S,
} from "./minuteCandles.mjs";

const M = 60, D = 86400;
const DAY = Date.UTC(2026, 10, 14) / 1000;             // 2026-11-14T00:00Z (sec)
const SYM = "PERP_ETH_USDC";

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [];
  return {
    m, puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); puts.push({ k, opts }); },
    async delete(k) { m.delete(k); },
  };
}
// Orderly's /tv/history at resolution 1, from a price function of the minute. Records each request.
function orderly(px, { fail = () => false } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    const q = new URL(url).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    calls.push({ res: q.get("resolution"), sym: q.get("symbol"), from, to });
    if (fail(from, to)) throw new Error("orderly 429");
    const t = []; for (let x = Math.ceil(from / M) * M; x <= to; x += M) t.push(x);
    if (!t.length) return { s: "no_data" };
    const b = t.map(px);
    return { s: "ok", t, o: b.map((x) => x.c), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c) };
  };
  return { fetchJson, calls };
}
const flat = () => ({ h: 100.5, l: 99.5, c: 100 });

test("a day with no chunk is fetched ascending in pages from the need to now", () => {
  const now = DAY + 10 * 3600;
  const pages = planDayPages(null, dayOf(DAY), DAY + 30 * M, now);
  assert.deepEqual(pages, [
    { kind: "tail", from: DAY + 30 * M, to: DAY + 30 * M + M1_PAGE_S },
    { kind: "tail", from: DAY + 30 * M + M1_PAGE_S, to: now },
  ]);
});

test("a chunk is extended at its tail (re-reading the partial minutes) and walked back at its head", () => {
  const chunk = { v: 1, from: DAY + 3600, to: DAY + 2 * 3600, t: [], o: [], h: [], l: [], c: [] };
  const pages = planDayPages(chunk, dayOf(DAY), DAY + 1800, DAY + 2 * 3600 + 5 * M);
  assert.deepEqual(pages, [
    { kind: "tail", from: DAY + 2 * 3600 - M1_OVERLAP_S, to: DAY + 2 * 3600 + 5 * M },
    { kind: "head", from: DAY + 1800, to: DAY + 3600 },
  ]);
  const done = { ...chunk, from: DAY, to: DAY + D };
  assert.deepEqual(planDayPages(done, dayOf(DAY), DAY, DAY + 3 * D), [], "a finished day is never re-fetched");
});

test("a page that would leave a hole is refused; a re-read minute replaces the partial one", () => {
  const sym = SYM, day = dayOf(DAY);
  const c1 = applyMinutePage(null, sym, day, { kind: "tail", from: DAY, to: DAY + 3 * M }, [[DAY, 1, 2, 0.5, 1.5], [DAY + 2 * M, 1, 1.2, 0.9, 1]]);
  assert.deepEqual([c1.from, c1.to, c1.t], [DAY, DAY + 3 * M, [DAY, DAY + 2 * M]]);
  const c2 = applyMinutePage(c1, sym, day, { kind: "tail", from: DAY + 2 * M, to: DAY + 4 * M }, [[DAY + 2 * M, 1, 1.9, 0.8, 1.8], [DAY + 3 * M, 1.8, 2, 1.7, 1.9]]);
  assert.deepEqual(c2.h, [2, 1.9, 2], "the partial minute's high is the final one");
  assert.throws(() => applyMinutePage(c2, sym, day, { kind: "tail", from: DAY + 10 * M, to: DAY + 11 * M }, []), /gap/);
  assert.throws(() => applyMinutePage(c2, sym, day, { kind: "head", from: DAY - 5 * M, to: DAY - M }, []), /gap/);
});

test("a window is only handed over when its days cover it with no hole", () => {
  const d1 = dayOf(DAY), d2 = dayOf(DAY + D);
  const day1 = { v: 1, from: DAY + 3600, to: DAY + D, t: [DAY + 3600, DAY + D - M], o: [1, 1], h: [2, 3], l: [1, 1], c: [1, 2] };
  const day2 = { v: 1, from: DAY + D, to: DAY + D + 600, t: [DAY + D], o: [2], h: [4], l: [1.5], c: [3] };
  const w = windowFrom({ [d1]: day1, [d2]: day2 }, DAY + 3600, DAY + D + 600);
  assert.deepEqual([w.t, w.h, w.step, w.to], [[DAY + 3600, DAY + D - M, DAY + D], [2, 3, 4], 60, DAY + D + 600]);
  assert.equal(windowFrom({ [d1]: day1, [d2]: day2 }, DAY, DAY + D + 600), null, "doesn't reach back to the post");
  assert.equal(windowFrom({ [d1]: { ...day1, to: DAY + D - 3600 }, [d2]: day2 }, DAY + 3600, DAY + D + 600), null, "a past day short of its end");
  assert.equal(windowFrom({ [d1]: day1 }, DAY + 3600, DAY + D + 600), null, "a missing day");
  assert.deepEqual(rangeSince(w, DAY + D - M), { lo: 1, hi: 4 });
  assert.equal(rangeSince(w, DAY + 2 * D), null);
});

test("ensure fetches 1-minute pages, flush writes the archive with no expiry, and movedRange is only what changed", async () => {
  const env = { LAB_STORE: kv() };
  const o = orderly(flat);
  let now = (DAY + 3600) * 1000;
  const mc = makeMinuteCandles(env, { fetchJson: o.fetchJson, nowMs: () => now });
  assert.equal(await mc.ensure("ETH", DAY + 1800), true);
  assert.ok(o.calls.every((c) => c.res === "1" && c.sym === SYM));
  assert.deepEqual(mc.movedRange("ETH"), { lo: 99.5, hi: 100.5 }, "every bar is new on the first run");
  assert.equal(env.LAB_STORE.m.size, 0, "nothing written before flush");
  await mc.flush();
  const stored = JSON.parse(env.LAB_STORE.m.get(M1_KEY(SYM, dayOf(DAY))));
  assert.deepEqual([stored.from, stored.to, stored.t.length], [DAY + 1800, DAY + 3600, 30]);
  assert.equal(env.LAB_STORE.puts[0].opts, undefined, "no expirationTtl: it's the archive");
  // The next minute: one small tail page, starting a few minutes back.
  now += 60_000;
  const mc2 = makeMinuteCandles(env, { fetchJson: o.fetchJson, nowMs: () => now });
  const before = o.calls.length;
  await mc2.ensure("ETH", DAY + 1800);
  assert.deepEqual(o.calls.slice(before), [{ res: "1", sym: SYM, from: DAY + 3600 - M1_OVERLAP_S, to: DAY + 3600 + 60 }]);
  assert.deepEqual(mc2.movedRange("ETH"), { lo: 99.5, hi: 100.5 }, "the new minute");
  // A run that re-reads only minutes that came back the same has nothing new to say.
  const mc3 = makeMinuteCandles(env, { fetchJson: o.fetchJson, nowMs: () => now });
  await mc2.flush();
  await mc3.ensure("ETH", DAY + 1800);
  assert.equal(mc3.movedRange("ETH"), null);
});

test("a failed page stops the symbol for the run and leaves no hole in the archive", async () => {
  const env = { LAB_STORE: kv() };
  const now = (DAY + 20 * 3600) * 1000;
  // Each tail page starts M1_OVERLAP_S before the last one ended: the third page is the one refused.
  const o = orderly(flat, { fail: (from) => from >= DAY + 2 * M1_PAGE_S - 2 * M1_OVERLAP_S });
  const mc = makeMinuteCandles(env, { fetchJson: o.fetchJson, nowMs: () => now });
  assert.equal(await mc.ensure("ETH", DAY), false);
  await mc.flush();
  const stored = JSON.parse(env.LAB_STORE.m.get(M1_KEY(SYM, dayOf(DAY))));
  assert.deepEqual([stored.from, stored.to], [DAY, DAY + 2 * M1_PAGE_S - M1_OVERLAP_S], "contiguous up to the failure");
  assert.equal(o.calls.length, 3, "no page after the refused one");
  assert.equal(await loadMinuteWindow(env, "ETH", (DAY + 600) * 1000, now) !== null, true, "graded on what's there");
});

test("loadMinuteWindow reads the archive only, across midnight", async () => {
  const env = { LAB_STORE: kv() };
  const o = orderly(flat);
  const now = (DAY + D + 600) * 1000;
  const mc = makeMinuteCandles(env, { fetchJson: o.fetchJson, nowMs: () => now });
  await mc.ensure("ETH", DAY + D - 3600);
  await mc.flush();
  const calls = o.calls.length;
  const w = await loadMinuteWindow(env, "ETH", (DAY + D - 1800) * 1000, now);
  assert.equal(o.calls.length, calls, "no Orderly request on a read");
  assert.equal(w.t[0], minuteNeededFrom((DAY + D - 1800) * 1000));
  assert.equal(w.t.at(-1), DAY + D + 540, "the minute in progress is the last bar");
  assert.deepEqual(daysBetween(DAY + D - 3600, DAY + D + 600), [dayOf(DAY), dayOf(DAY + D)]);
});

test("minuteBarsFrom keeps only the page's own minutes and refuses a broken page", () => {
  assert.deepEqual(minuteBarsFrom({ s: "no_data" }, 0, 60), []);
  assert.throws(() => minuteBarsFrom({ s: "error" }, 0, 60), /unusable/);
  const d = { s: "ok", t: [0, 60, 120], o: [1, 1, 1], h: [2, 2, 2], l: [0, 0, 0], c: [1, 1, 1] };
  assert.deepEqual(minuteBarsFrom(d, 60, 120).map((b) => b[0]), [60]);
});

test("GET /candles/1m/:symbol/:day serves the archived day as stored, with its Orderly source", async () => {
  const day = dayOf(DAY);
  const chunk = { v: 1, sym: SYM, day, from: DAY, to: DAY + D, t: [DAY], o: [1], h: [2], l: [0.5], c: [1.5] };
  const env = { LAB_STORE: kv({ [M1_KEY(SYM, day)]: chunk }) };
  const req = (path) => new Request(`https://og.example${path}`);
  const parts = (path) => path.split("/").filter(Boolean);
  const res = await handleMinuteArchive(parts(`/candles/1m/ETH/${day}`), req(`/candles/1m/ETH/${day}`), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.t, body.h, body.step], [[DAY], [2], 60]);
  assert.match(body.source, /resolution=1&from=/);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=86400", "a finished day is immutable");
  assert.equal((await handleMinuteArchive(parts(`/candles/1m/BTC/${day}`), req("/x"), env)).status, 404);
  assert.equal((await handleMinuteArchive(parts("/candles/1m/ETH/yesterday"), req("/x"), env)).status, 400);
  assert.equal(await handleMinuteArchive(parts("/candles/1h/ETH/x"), req("/x"), env), null, "not this route");
});
