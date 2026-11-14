// forecast:hist recorder (forecastHist.mjs) — lens read B's input, recording only.
// Run: node --test workers/nexus-lab-api/forecastHist.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forecastHistRows, appendForecastHist, snapshotForecasts, FORECAST_HIST_PREFIX, FORECAST_HIST_MAX_ROWS, FORECAST_HIST_PER_COIN } from "./forecastHist.mjs";

const T = Date.UTC(2026, 10, 15, 3, 0, 0);
const mk = (o) => ({ id: "m1", coin: "ETH", forecastProbPct: 30, target: 1500, targetDirection: "DOWN", distancePct: -19, fundingLean: "UP", volumeUsd: 1e6, endDate: "2026-12-31T12:00:00Z", ...o });
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };

test("one row per price-target market, the inputs B's rule reads; non-targets and unread marks skipped", () => {
  const board = { markets: [mk(), mk({ id: "m2", target: null, targetDirection: null, distancePct: null }), mk({ id: "m3", coin: "BTC", distancePct: null }), mk({ id: 7, coin: "PERP_SOL_USDC", fundingLean: null })] };
  const r = forecastHistRows(board, T);
  assert.deepEqual(Object.keys(r).sort(), ["ETH", "SOL"]);
  assert.deepEqual(r.ETH, [{ t: T, id: "m1", yesPct: 30, target: 1500, direction: "DOWN", distancePct: -19, fundingLean: "UP", volumeUsd: 1e6, endDate: "2026-12-31T12:00:00Z" }]);
  assert.equal(r.SOL[0].id, "7");
  assert.equal(r.SOL[0].fundingLean, null, "no funding read = null, never a guessed lean");
});

test("keeps the deepest markets per coin", () => {
  const board = { markets: Array.from({ length: 10 }, (_, i) => mk({ id: `m${i}`, volumeUsd: i })) };
  const r = forecastHistRows(board, T).ETH;
  assert.equal(r.length, FORECAST_HIST_PER_COIN);
  assert.equal(r[0].id, "m9");
});

test("hourly: a second run inside 55 min writes nothing; the series is capped", () => {
  const rows = forecastHistRows({ markets: [mk()] }, T).ETH;
  assert.equal(appendForecastHist([{ t: T - 30 * 60000 }], rows, T), null);
  assert.equal(appendForecastHist([{ t: T - 60 * 60000 }], rows, T).length, 2);
  assert.equal(appendForecastHist([], [], T), null, "nothing to record = no write");
  const full = Array.from({ length: FORECAST_HIST_MAX_ROWS }, (_, i) => ({ t: i }));
  const next = appendForecastHist(full, rows, T);
  assert.equal(next.length, FORECAST_HIST_MAX_ROWS);
  assert.equal(next[next.length - 1].t, T);
});

test("the job writes only forecast:hist:{COIN}, stamped at the board's own time; an unread board writes nothing", async () => {
  const store = kv();
  const r = await snapshotForecasts(store, async () => ({ asOfMs: T - 120000, markets: [mk(), mk({ coin: "BTC", id: "b" })] }), T);
  assert.deepEqual(r, { coins: 2, rows: 2 });
  assert.deepEqual([...store.m.keys()].sort(), [FORECAST_HIST_PREFIX + "BTC", FORECAST_HIST_PREFIX + "ETH"]);
  assert.equal(JSON.parse(store.m.get(FORECAST_HIST_PREFIX + "ETH"))[0].t, T - 120000);
  const empty = kv();
  assert.deepEqual(await snapshotForecasts(empty, async () => null, T), { coins: 0, rows: 0 });
  assert.equal(empty.m.size, 0);
});

test("index.js runs it on the hourly cron through the worker's own handler, and nothing grades it", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /snapshotForecasts\(env\.NEXUS_AGENT \|\| env\.LAB_STORE, async \(\) => \{\s*const res = await worker\.fetch\(new Request\("https:\/\/og\.nexustradinglabs\.com\/intel\/forecasts"\)/);
  for (const f of ["axisbt.mjs", "explorerReads.mjs"]) {
    assert.doesNotMatch(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /forecast:hist|forecastHist/, `${f} must not read the recorder before B is registered`);
  }
});
