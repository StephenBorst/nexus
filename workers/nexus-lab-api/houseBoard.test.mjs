// House caller board choice + run reporting. Run: node --test workers/nexus-lab-api/houseBoard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { pickHouseBoard, houseRunSummary, HOUSE_BOARD_MAX_AGE_MS } from "./houseBoard.mjs";

const NOW = 1_800_000_000_000;
const board = (ageMs) => JSON.stringify({ asOfMs: NOW - ageMs, markets: [{ coin: "BTC", status: "MISPRICED" }] });
const buildBoard = (rows) => ({ markets: rows.map((r) => ({ coin: r.symbol })) });
const fetcher = (answers) => { let n = 0; const f = async () => { n++; const a = answers.shift(); if (a instanceof Error) throw a; return a; }; f.calls = () => n; return f; };

test("a fresh cached board is used as-is; no live fetch", async () => {
  const f = fetcher([]);
  const r = await pickHouseBoard({ cachedRaw: board(60_000), now: NOW, fetchDetailed: f, buildBoard });
  assert.equal(r.source, "cache");
  assert.equal(r.markets[0].coin, "BTC");
  assert.equal(f.calls(), 0);
});

test("a stale cached board is NOT used (entry = its mark); the caller builds its own", async () => {
  const f = fetcher([{ rows: [{ symbol: "ETH" }] }]);
  const r = await pickHouseBoard({ cachedRaw: board(HOUSE_BOARD_MAX_AGE_MS + 1), now: NOW, fetchDetailed: f, buildBoard });
  assert.equal(r.source, "live");
  assert.equal(r.markets[0].coin, "ETH");
});

test("cold cache + a failing live fetch retries once when allowed, then names both causes", async () => {
  const waits = [];
  const f = fetcher([{ rows: [], why: "rate_limited 429" }, { rows: [], why: "challenge 403" }]);
  const r = await pickHouseBoard({ cachedRaw: null, now: NOW, fetchDetailed: f, buildBoard, attempts: 2, waitMs: 20000, sleep: async (ms) => waits.push(ms) });
  assert.match(r.error, /cache cold; live: rate_limited 429 \| challenge 403/);
  assert.deepEqual(waits, [20000]);
  assert.equal(f.calls(), 2);
});

test("the retry recovers; request paths (attempts 1) never wait", async () => {
  const f = fetcher([new Error("network down"), { rows: [{ symbol: "SOL" }] }]);
  const r = await pickHouseBoard({ cachedRaw: board(HOUSE_BOARD_MAX_AGE_MS * 3), now: NOW, fetchDetailed: f, buildBoard, attempts: 2, sleep: async () => {} });
  assert.equal(r.source, "live");
  assert.equal(r.tries, 2);
  const one = fetcher([{ rows: [] , why: "x" }]);
  let waited = false;
  const r1 = await pickHouseBoard({ cachedRaw: "not json", now: NOW, fetchDetailed: one, buildBoard, sleep: async () => { waited = true; } });
  assert.match(r1.error, /cache unreadable/);
  assert.equal(waited, false);
});

test("houseRunSummary: one plain line for every outcome", () => {
  assert.equal(houseRunSummary({ posted: [{ symbol: "BTC", direction: "SHORT" }], boardSource: "live" }), "posted 1: BTC SHORT (board: live)");
  assert.equal(houseRunSummary({ posted: [], note: "no fade signal right now", boardSource: "cache" }), "no post: no fade signal right now (board: cache)");
  assert.equal(houseRunSummary({ error: "no fresh board (cache cold; live: x)" }), "no post: no fresh board (cache cold; live: x)");
  assert.equal(houseRunSummary({ skipped: "HOUSE_CALLER_ADDRESS not set" }), "no post: HOUSE_CALLER_ADDRESS not set");
  assert.equal(houseRunSummary(null), "no post: no result");
});
