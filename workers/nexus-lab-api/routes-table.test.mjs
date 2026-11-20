// GET /intel/table (routes-table.mjs). Run: node --test workers/nexus-lab-api/routes-table.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeTable, handleTable, TABLE_CACHE_KEY } from "./routes-table.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
const NOW = Date.parse("2026-11-20T18:00:00Z");
const FUT = [{ symbol: "PERP_BTC_USDC", mark_price: 60_000, open_interest: 250, "24h_amount": 14_000_000, "24h_open": 64_000, last_funding_rate: 0.0001 }];
const BOARDS = {
  "/intel/funding-venues": { rows: [{ coin: "BTC", gap: 12 }] },
  "/smart/consensus": { consensus: { BTC: { long: 1, short: 12 } } },
  "/intel/forecasts": { markets: [{ coin: "BTC", divergence: true }] },
  "/signals/paper-run/oi_div_reversal_4h": { ok: true, open: { coin: "BTC", side: "LONG" } },
};
const dispatch = (b) => async (p) => (p in b ? ok(b[p]) : new Response("x", { status: 404 }));
const news = async () => ({ items: [{ coins: ["BTC"], publishedAt: NOW - 60_000 }] });

test("composes every column for a coin", async () => {
  const t = await composeTable({ LAB_STORE: kv() }, { futures: async () => FUT, dispatch: dispatch(BOARDS), news, now: NOW });
  const [btc] = t.rows;
  assert.equal(btc.gap, 12);
  assert.equal(btc.smart.side, "SHORT");
  assert.deepEqual(btc.forecast, { divergent: 1, total: 1 });
  assert.equal(btc.news, 1);
  assert.deepEqual(btc.reads, [{ axis: "oi_div_reversal_4h", side: "LONG" }]);
  assert.deepEqual(t.unread, []);
});

test("Orderly down = no rows, named, and never cached", async () => {
  const env = { LAB_STORE: kv() };
  const res = await handleTable(["intel", "table"], new Request("https://og.nexustradinglabs.com/intel/table"), env, { futures: async () => { throw new Error("429"); }, dispatch: dispatch(BOARDS), news, now: NOW });
  const b = await res.json();
  assert.deepEqual(b.rows, []);
  assert.deepEqual(b.unread, ["markets"]);
  assert.ok(!env.LAB_STORE.m.has(TABLE_CACHE_KEY));
});

test("a 60 s cache; other paths are not ours", async () => {
  const env = { LAB_STORE: kv() };
  let reads = 0;
  const futures = async () => { reads++; return FUT; };
  const req = new Request("https://og.nexustradinglabs.com/intel/table");
  await handleTable(["intel", "table"], req, env, { futures, dispatch: dispatch(BOARDS), news, now: NOW });
  await handleTable(["intel", "table"], req, env, { futures, dispatch: dispatch(BOARDS), news, now: NOW + 59_000 });
  assert.equal(reads, 1);
  assert.equal(await handleTable(["intel", "wire"], req, env, { futures }), null);
});

test("wired into the worker with the all-markets reader", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /import \{ handleTable \} from "\.\/routes-table\.mjs"/);
  assert.match(src, /handleTable\(parts, request, env, \{\s*futures: \(\) => fetchAllFutures\(\)/);
});
