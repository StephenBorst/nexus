import { test } from "node:test";
import assert from "node:assert/strict";
import { handleHlTape, syncHlTape, sweepHlTapes, readTape, SYNC_MIN_MS } from "./routes-hltape.mjs";

const W = "0x" + "ab".repeat(20);

function kv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const fill = (i) => ({ tid: i, time: 1_000_000 + i, coin: "BTC", px: "1", sz: "1", side: "B", dir: i % 2 ? "Close Long" : "Open Long", closedPnl: "1", fee: "0" });

// A fake Hyperliquid that serves the newest `served` of `all` fills, 2,000 per page,
// earliest-first from startTime (inclusive) — the documented behavior.
function fakeHL(all, { served = 10_000, fail = false } = {}) {
  const calls = [];
  const fn = async (body) => {
    calls.push(body);
    if (fail) throw new Error("boom");
    const window = all.slice(Math.max(0, all.length - served));
    if (body.type === "userFillsByTime") return window.filter((f) => f.time >= body.startTime).slice(0, 2000);
    if (body.type === "userFills") return window.slice(-2000).reverse();
    return [];
  };
  fn.calls = calls;
  return fn;
}
const req = (addr, ip = "1.1.1.1") => new Request(`https://x/xray/hltape?address=${addr}`, { headers: { "CF-Connecting-IP": ip } });
const noLimit = () => false;

test("first view seeds everything HL serves; under 10k = complete", async () => {
  const env = { LAB_STORE: kv() };
  const all = Array.from({ length: 300 }, (_, i) => fill(i));
  const res = await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: fakeHL(all), limiter: noLimit, now: 5e6 });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.fillCount, 300);
  assert.equal(body.completeFrom, null);
  assert.equal(body.synced, true);
  assert.equal(body.seededAt, 5e6);
});

test("the stored tape grows past HL's 10k window across syncs", async () => {
  const env = { LAB_STORE: kv() };
  const all = Array.from({ length: 10_000 }, (_, i) => fill(i));
  await syncHlTape(env, W, { hlInfo: fakeHL(all), now: 1e7 });
  const more = Array.from({ length: 16_000 }, (_, i) => fill(i));           // +6k fills later
  const r = await syncHlTape(env, W, { hlInfo: fakeHL(more), now: 1e7 + SYNC_MIN_MS });
  assert.equal(r.gap, false, "HL still served our newest fill → continuous");
  assert.equal(r.record.fills.length, 16_000, "holds more than HL serves");
  assert.equal(r.record.completeFrom, 1_000_000, "complete from the seed's oldest fill");
});

test(">10k fills between syncs → gap disclosed, completeFrom moves forward", async () => {
  const env = { LAB_STORE: kv() };
  await syncHlTape(env, W, { hlInfo: fakeHL(Array.from({ length: 100 }, (_, i) => fill(i))), now: 1e7 });
  const burst = Array.from({ length: 30_000 }, (_, i) => fill(i));          // HL now serves 20000..29999
  const r = await syncHlTape(env, W, { hlInfo: fakeHL(burst), now: 1e7 + SYNC_MIN_MS });
  assert.equal(r.gap, true);
  assert.equal(r.record.completeFrom, 1_000_000 + 20_000);
});

test("a failed first page never writes and never claims a gap", async () => {
  const env = { LAB_STORE: kv() };
  await syncHlTape(env, W, { hlInfo: fakeHL(Array.from({ length: 50 }, (_, i) => fill(i))), now: 1e7 });
  const before = env.LAB_STORE.m.get(`xray:hltape:${W}`);
  const r = await syncHlTape(env, W, { hlInfo: fakeHL([], { fail: true }), now: 1e7 + SYNC_MIN_MS });
  assert.equal(r.synced, false);
  assert.equal(env.LAB_STORE.m.get(`xray:hltape:${W}`), before);
  assert.equal(r.record.completeFrom, null);
});

test("repeat views within a minute serve the stored tape without calling HL", async () => {
  const env = { LAB_STORE: kv() };
  const hl = fakeHL(Array.from({ length: 10 }, (_, i) => fill(i)));
  await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: hl, limiter: noLimit, now: 1e7 });
  const n = hl.calls.length;
  const res = await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: hl, limiter: noLimit, now: 1e7 + 1000 });
  const body = await res.json();
  assert.equal(hl.calls.length, n, "no new HL calls");
  assert.equal(body.synced, false);
  assert.equal(body.reason, "fresh");
  assert.equal(body.fillCount, 10);
});

test("over the per-IP budget: stored tape served stale, or 429 when there's none", async () => {
  const env = { LAB_STORE: kv() };
  const over = () => true;
  const miss = await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: fakeHL([]), limiter: over, now: 1e7 });
  assert.equal(miss.status, 429);
  await syncHlTape(env, W, { hlInfo: fakeHL([fill(1)]), now: 1e7 });
  const hit = await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: fakeHL([]), limiter: over, now: 1e7 + SYNC_MIN_MS });
  const body = await hit.json();
  assert.equal(hit.status, 200);
  assert.equal(body.stale, true);
});

test("bad address → 400; HL down on first view → 502; other paths → null", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal((await handleHlTape(["xray", "hltape"], req("0x123"), env, { limiter: noLimit })).status, 400);
  assert.equal((await handleHlTape(["xray", "hltape"], req(W), env, { hlInfo: fakeHL([], { fail: true }), limiter: noLimit })).status, 502);
  assert.equal(await handleHlTape(["smart", "xray"], req(W), env), null);
});

test("cron sweep syncs watched wallets (bounded) and reports", async () => {
  const env = { LAB_STORE: kv() };
  const a = "0x" + "11".repeat(20), b = "0x" + "22".repeat(20);
  await env.LAB_STORE.put("sm:wl:someone", JSON.stringify([a, b, "not-an-address"]));
  const r = await sweepHlTapes(env, { hlInfo: fakeHL(Array.from({ length: 5 }, (_, i) => fill(i))), now: 1e7 });
  assert.deepEqual({ watched: r.watched, synced: r.synced, failed: r.failed }, { watched: 2, synced: 2, failed: 0 });
  assert.equal((await readTape(env, a)).fills.length, 5);
});
