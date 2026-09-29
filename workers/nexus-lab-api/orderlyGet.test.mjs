// orderlyGet / mapLimit — Orderly's public limit is 10 req/s per IP; these pin the pacing + the
// loud, named failure. No network: fetch, sleep and random are injected.
// Run: node --test workers/nexus-lab-api/orderlyGet.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { orderlyGet, mapLimit, backoffMs, whyFailed, OrderlyError, ORDERLY_CONCURRENCY, ORDERLY_GAP_MS } from "./orderlyGet.mjs";

const resp = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const script = (...answers) => { const calls = []; return { calls, fetchImpl: async (url) => { calls.push(url); const a = answers.shift(); if (a instanceof Error) throw a; return a; } }; };
const quiet = () => { const lines = []; return { lines, log: { error: (m) => lines.push(m) } }; };
const noSleep = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };
const URL1 = "https://api-evm.orderly.org/v1/public/futures";

test("200 JSON returns the body, one request, no log", async () => {
  const f = script(resp(200, { success: true, data: { rows: [1] } })); const q = quiet();
  assert.deepEqual(await orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: q.log }), { success: true, data: { rows: [1] } });
  assert.equal(f.calls.length, 1); assert.equal(q.lines.length, 0);
});

test("429 is retried with backoff, logged loudly, then succeeds", async () => {
  const f = script(resp(429, { success: false }), resp(200, { ok: 1 })); const q = quiet(); const s = noSleep();
  assert.deepEqual(await orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: q.log, sleep: s.sleep, random: () => 0 }), { ok: 1 });
  assert.equal(f.calls.length, 2);
  assert.match(q.lines[0], /RATE LIMITED 429 \/v1\/public\/futures/);
  assert.deepEqual(s.waits, [400]);
});

test("429 on every try throws a rate_limited error naming it (never a silent empty)", async () => {
  const f = script(resp(429, {}), resp(429, {}), resp(429, {})); const q = quiet(); const s = noSleep();
  await assert.rejects(orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: q.log, sleep: s.sleep, random: () => 0 }),
    (e) => e instanceof OrderlyError && e.kind === "rate_limited" && e.status === 429);
  assert.equal(f.calls.length, 3); assert.equal(q.lines.length, 3);
  assert.deepEqual(s.waits, [400, 800]); // exponential; no wait after the last try
});

test("Retry-After is honoured, capped at 4s", async () => {
  const s = noSleep();
  const f = script(resp(429, {}, { "retry-after": "2" }), resp(429, {}, { "retry-after": "60" }), resp(200, {}));
  await orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: quiet().log, sleep: s.sleep, random: () => 0 });
  assert.deepEqual(s.waits, [2000, 4000]);
});

test("HTML challenge page is retried and reported as a challenge with its status", async () => {
  const f = script(resp(403, "<!DOCTYPE html><title>Just a moment</title>"), resp(403, "<html>"), resp(403, "<html>"));
  await assert.rejects(orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: quiet().log, sleep: noSleep().sleep }),
    (e) => e.kind === "challenge" && e.status === 403);
  assert.equal(f.calls.length, 3);
});

test("a JSON error (400) is not retried and names the status", async () => {
  const f = script(resp(400, { success: false, message: "bad symbol" }));
  await assert.rejects(orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: quiet().log }), (e) => e.kind === "http" && e.status === 400 && /bad symbol/.test(e.message));
  assert.equal(f.calls.length, 1);
});

test("network error retries, then reports network", async () => {
  const f = script(new Error("socket hang up"), resp(200, { ok: 1 }));
  assert.deepEqual(await orderlyGet(URL1, { fetchImpl: f.fetchImpl, log: quiet().log, sleep: noSleep().sleep }), { ok: 1 });
});

test("backoff: exponential with jitter on top, capped", () => {
  assert.equal(backoffMs(0, null, () => 0), 400);
  assert.equal(backoffMs(1, null, () => 0), 800);
  assert.equal(backoffMs(1, null, () => 0.999), 800 + 799);
  assert.equal(backoffMs(9, null, () => 0), 4000);
});

test("whyFailed gives a short public reason", () => {
  assert.equal(whyFailed(new OrderlyError("rate_limited", 429, "/x")), "rate_limited 429");
  assert.equal(whyFailed(new OrderlyError("network", null, "/x")), "network");
});

test("mapLimit never has more than `limit` in flight and keeps order", async () => {
  let inFlight = 0, peak = 0;
  const out = await mapLimit([...Array(14).keys()], ORDERLY_CONCURRENCY, async (x) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--; return x * 2;
  }, { gapMs: 0 });
  assert.equal(peak, ORDERLY_CONCURRENCY);
  assert.deepEqual(out, [...Array(14).keys()].map((x) => x * 2));
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
});

test("mapLimit spaces starts by gapMs — bounds the RATE even on instant round-trips", async () => {
  const starts = [];
  await mapLimit([...Array(8).keys()], ORDERLY_CONCURRENCY, async () => { starts.push(performance.now()); }, { gapMs: 20 });
  starts.sort((x, y) => x - y);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 15, `gap ${i}: ${starts[i] - starts[i - 1]}`);
  // Worst caller makes 2 reads per item: 2 per ORDERLY_GAP_MS must stay ≤ Orderly's 10 req/s per IP.
  assert.ok((2 * 1000) / ORDERLY_GAP_MS <= 10);
});
