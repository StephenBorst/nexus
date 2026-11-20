// GET /intel/wire (routes-wire.mjs). Run: node --test workers/nexus-lab-api/routes-wire.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeWire, handleWire, WIRE_SEEN_KEY, WIRE_CACHE_KEY } from "./routes-wire.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
const NOW = Date.parse("2026-11-20T18:00:00Z");
const H = 3600_000;

const SC = { axes: [{ name: "spot_absorb", label: "Spot absorbs a perp-led move" }], pipeline: { reads: [{ axis: "spot_absorb", stage: "REGISTERED", numbers: { events: 3 } }] } };
const BOARDS = {
  "/intel/bell": { list: [{ id: "fund-RAY-LONG", kind: "FUNDING", ts: NOW, title: "RAY funding stretched -0.062%/8h", graded: "the fade's grade" }] },
  "/intel/axis-backtest": SC,
  "/smart/events": { events: [{ source: "orderly", addr: "0xabc0000000000000000000000000000000000def", coin: "ETH", side: "LONG", type: "OPEN", szUsd: 40_000, ts: NOW - 10 * 60_000 }] },
  "/calls/pulse": { recentGraded: [{ symbol: "BTC", direction: "LONG", path: "/feed/thesis/a/1", caller: "Banksy", outcome: "WIN", r: 1.1, at: NOW - H }], engines: {} },
  "/intel/calendar": { events: [{ kind: "MACRO", at: NOW + 2 * H, title: "CPI m/m", impact: "High" }] },
  "/signals/paper-run/spot_absorb": { ok: true, axis: "spot_absorb", count: 1, target: 30, open: { coin: "SOL", side: "SHORT", openedAt: new Date(NOW - 30 * 60_000).toISOString() }, trades: [] },
};
const dispatch = (boards) => async (p) => (p in boards ? ok(boards[p]) : new Response("x", { status: 404 }));
const news = async () => ({ items: [{ id: "n1", title: "Bitcoin falls below $60K", source: "Cointelegraph", coins: ["BTC"], publishedAt: NOW - 5 * 60_000, firstSeenAt: NOW, link: "https://x.test" }], sources: [{ name: "Decrypt", ok: false }] });

test("one stream from every board: a house run's paper trade, funding, news, a wallet move, a graded call", async () => {
  const env = { LAB_STORE: kv() };
  const w = await composeWire(env, { dispatch: dispatch(BOARDS), news, now: NOW });
  assert.deepEqual(w.rows.map((r) => r.kind), ["FUNDING", "NEWS", "WALLET", "READ", "CALL"]);
  assert.equal(w.rows.find((r) => r.kind === "READ").title, "SOL: a registered read opened a paper short");
  assert.deepEqual(w.upcoming.map((r) => r.title), ["CPI m/m"]);
  assert.deepEqual(w.unread, ["news: Decrypt"]);
});

test("funding stays where it entered the stream: dated by first sight, not every build", async () => {
  const env = { LAB_STORE: kv() };
  await composeWire(env, { dispatch: dispatch(BOARDS), news, now: NOW });
  assert.equal(JSON.parse(env.LAB_STORE.m.get(WIRE_SEEN_KEY))["fund-RAY-LONG"], NOW);
  const later = await composeWire(env, { dispatch: dispatch(BOARDS), news, now: NOW + 2 * H });
  assert.equal(later.rows.find((r) => r.kind === "FUNDING").t, NOW);
});

test("a board that fails drops its rows and is named", async () => {
  const env = { LAB_STORE: kv() };
  const { "/smart/events": _drop, ...rest } = BOARDS;
  const w = await composeWire(env, { dispatch: dispatch(rest), news: async () => { throw new Error("x"); }, now: NOW });
  assert.ok(!w.rows.some((r) => r.kind === "WALLET" || r.kind === "NEWS"));
  assert.deepEqual(w.unread, ["news", "wallets"]);
});

test("served from a 60 s cache; other paths are not ours", async () => {
  const env = { LAB_STORE: kv() };
  let calls = 0;
  const d = async (p) => { calls++; return dispatch(BOARDS)(p); };
  const req = new Request("https://og.nexustradinglabs.com/intel/wire");
  await handleWire(["intel", "wire"], req, env, { dispatch: d, news, now: NOW });
  const n = calls;
  const res = await handleWire(["intel", "wire"], req, env, { dispatch: d, news, now: NOW + 30_000 });
  assert.equal(calls, n);
  assert.equal((await res.json()).rows.length, 5);
  assert.ok(env.LAB_STORE.m.has(WIRE_CACHE_KEY));
  assert.equal(await handleWire(["intel", "bell"], req, env, { dispatch: d }), null);
});

test("wired into the worker", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /import \{ handleWire \} from "\.\/routes-wire\.mjs"/);
  assert.match(src, /await handleWire\(parts, request, env, \{/);
});
