// GET /intel/bell (routes-bell.mjs). Run: node --test workers/nexus-lab-api/routes-bell.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleBell, BELL_CACHE_KEY } from "./routes-bell.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const req = (p) => new Request(`https://og.nexustradinglabs.com${p}`);
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
const NOW = Date.UTC(2026, 10, 14, 21);
const BOARDS = {
  "/signals": { signals: [{ symbol: "BTC", funding_rate_8h: 0.0006 }] },
  "/theses/consensus": { consensus: {} },
  "/smart/xray/events": { events: [] },
  "/intel/axis-backtest": {
    axes: [{ name: "funding_fade", verdict: "NOISE", r: { samples: 3933 }, random: { pooled: { verdict: "BELOW_RANDOM" } } }, { name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded" }],
    pipeline: { reads: [{ axis: "oi_div_reversal_4h", stage: "PAPER", paperWallet: "0xd4", numbers: { events: 85, meanR: 0.31, beatsRandomPct: 99.2 } }, { axis: "rsi_reset_deep", stage: "REGISTERED", paperWallet: null, numbers: {} }] },
  },
  "/signals/paper-run/oi_div_reversal_4h": { ok: true, count: 3, target: 30, open: { coin: "ETH", side: "SHORT", openedAt: new Date(NOW - 3600e3).toISOString() }, trades: [] },
};

test("one request: every source read once in-process, paper runs only for reads with a wallet, then cached 60 s", async () => {
  const env = { LAB_STORE: kv() };
  const asked = [];
  const dispatch = async (p) => { asked.push(p); return BOARDS[p] ? ok(BOARDS[p]) : new Response("no", { status: 404 }); };
  const body = await (await handleBell(["intel", "bell"], req("/intel/bell"), env, { dispatch, now: NOW })).json();
  assert.deepEqual(asked.sort(), Object.keys(BOARDS).sort());
  assert.equal(body.list[0].kind, "READ");
  assert.match(body.list[1].graded, /funding fade grades NOISE/);
  assert.deepEqual(body.unread, []);
  assert.ok(env.LAB_STORE.m.has(BELL_CACHE_KEY));
  asked.length = 0;
  await handleBell(["intel", "bell"], req("/intel/bell"), env, { dispatch, now: NOW + 59_000 });
  assert.equal(asked.length, 0);
});

test("a failing source drops its rows and is named unread; the bell still answers", async () => {
  const env = { LAB_STORE: kv() };
  const dispatch = async (p) => (p === "/intel/axis-backtest" ? new Response("x", { status: 503 }) : ok(BOARDS[p] ?? {}));
  const body = await (await handleBell(["intel", "bell"], req("/intel/bell"), env, { dispatch, now: NOW })).json();
  assert.deepEqual(body.unread, ["scoreboard"]);
  assert.ok(!body.list.some((r) => r.kind === "READ"));
  assert.match(body.list[0].graded, /unread/);
  assert.equal(await handleBell(["intel", "market"], req("/intel/market"), env, { dispatch }), null);
});

test("index.js routes /intel/bell through the worker's own handler", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /handleBell\(parts, request, env, \{\s*dispatch: \(path\) => worker\.fetch\(/);
});
