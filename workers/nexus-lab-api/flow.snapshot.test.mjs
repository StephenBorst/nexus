import { test } from "node:test";
import assert from "node:assert";
import { snapshotFlow, FLOW_COIN_GAP_MS } from "./flow.mjs";

// The hourly basis/CVD snapshot, without the network: a fake OKX, a fake KV and a virtual clock.
const resp = (body, { status = 200, headers = {} } = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const ticker = (last) => resp({ code: "0", data: [{ last: String(last) }] });
const LIMITED = () => resp({ code: "50011", msg: "Too Many Requests" });
const T0 = Date.UTC(2026, 9, 11, 3, 17);

function harness({ script = {}, kvSeed = {} } = {}) {
  let clock = T0;
  const store = new Map(Object.entries(kvSeed).map(([k, v]) => [k, JSON.stringify(v)]));
  const env = { NEXUS_AGENT: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  const calls = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async (url) => {
    calls.push(url);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await null; // let a sibling request start, so concurrency is observable
    inFlight--;
    const u = new URL(url);
    const q = script[`${u.pathname.split("/").pop()}:${u.searchParams.get("instId")}`];
    if (q && q.length) return q.length > 1 ? q.shift() : q[0];
    if (url.includes("/market/trades")) {
      return resp({ code: "0", data: [{ ts: String(clock - 1000), side: "buy", sz: "2", px: "100" }, { ts: String(clock - 2000), side: "sell", sz: "1", px: "100" }] });
    }
    return url.includes("-SWAP") ? ticker(99.95) : ticker(100);
  };
  const slept = [];
  const logs = { log: [], error: [] };
  const opts = {
    fetchImpl,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
    random: () => 0,
    clock: () => clock,
    log: { log: (m) => logs.log.push(m), error: (m) => logs.error.push(m) },
  };
  const hist = (k) => JSON.parse(store.get(k) || "[]");
  return { env, opts, calls, slept, logs, hist, maxInFlight: () => maxInFlight };
}

test("snapshot: writes the SAME row shapes as before (t + basisPct, t + cvd/buy/sell)", async () => {
  const h = harness();
  const n = await snapshotFlow(h.env, ["BTC", "ETH"], h.opts);
  assert.equal(n, 2);
  const b = h.hist("basis:hist:BTC");
  assert.equal(b.length, 1);
  assert.deepEqual(Object.keys(b[0]).sort(), ["basisPct", "t"]);
  assert.equal(b[0].basisPct, -0.05);
  assert.equal(b[0].t, T0);
  const c = h.hist("cvd:hist:ETH");
  assert.deepEqual(Object.keys(c[0]).sort(), ["buy", "cvd", "sell", "t"]);
  assert.deepEqual([c[0].buy, c[0].sell, c[0].cvd], [200, 100, 100]);
  assert.match(h.logs.log[0], /basis 2\/2 · cvd 2\/2 · retries 0/);
  assert.deepEqual(h.logs.error, []);
});

test("snapshot: a rate-limited ticker is retried and the hour still lands", async () => {
  const h = harness({ script: { "ticker:ETH-USDT-SWAP": [LIMITED(), LIMITED(), ticker(99.9)] } });
  await snapshotFlow(h.env, ["BTC", "ETH"], h.opts);
  assert.equal(h.hist("basis:hist:ETH").length, 1, "the hour that used to be dropped is now written");
  assert.match(h.logs.log[0], /basis 2\/2 · cvd 2\/2 · retries 2/);
  assert.deepEqual(h.logs.error, []);
});

test("snapshot: a coin that never answers is skipped LOUDLY, and the others still land", async () => {
  const h = harness({ script: { "ticker:HYPE-USDT-SWAP": [LIMITED()] } });
  const n = await snapshotFlow(h.env, ["BTC", "HYPE", "SOL"], h.opts);
  assert.equal(h.hist("basis:hist:HYPE").length, 0);
  assert.equal(h.hist("cvd:hist:HYPE").length, 1, "its CVD still lands");
  assert.equal(h.hist("basis:hist:SOL").length, 1, "a later coin is not starved");
  assert.equal(n, 3);
  assert.match(h.logs.log[0], /basis 2\/3 · cvd 3\/3/);
  assert.equal(h.logs.error.length, 1);
  assert.match(h.logs.error[0], /MISSED 1: HYPE basis: okx 50011 Too Many Requests \(HTTP 200\), 4 tries/);
});

test("snapshot: paced — never more than a coin's two tickers in flight, a gap between coins", async () => {
  const h = harness();
  await snapshotFlow(h.env, ["BTC", "ETH", "SOL", "BNB"], h.opts);
  assert.equal(h.maxInFlight(), 2, "spot + perp together, nothing else alongside");
  assert.equal(h.slept.filter((ms) => ms === FLOW_COIN_GAP_MS).length, 3, "one gap between each pair of coins");
  assert.equal(h.calls.length, 12, "3 OKX calls per coin when nothing fails");
});

test("snapshot: a bad tick is logged, not retried, and writes nothing", async () => {
  const h = harness({ script: { "ticker:BTC-USDT": [ticker(0)] } });
  await snapshotFlow(h.env, ["BTC"], h.opts);
  assert.equal(h.hist("basis:hist:BTC").length, 0);
  assert.match(h.logs.error[0], /BTC basis: bad tick/);
  assert.match(h.logs.log[0], /retries 0/);
});

test("snapshot: the hourly guard is unchanged (a row <55 min old blocks a second one)", async () => {
  const h = harness({ kvSeed: { "basis:hist:BTC": [{ t: T0 - 30 * 60 * 1000, basisPct: -0.04 }] } });
  await snapshotFlow(h.env, ["BTC"], h.opts);
  assert.equal(h.hist("basis:hist:BTC").length, 1);
});
