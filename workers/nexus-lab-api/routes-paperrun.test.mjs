// GET /signals/paper-counts: every registered read's paper run as a COUNT (own wallet, else its house run), one request,
// 60 s cache. Fake KV; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePaperRun, buildPaperCounts, PAPER_COUNTS_KEY } from "./routes-paperrun.mjs";
import { HOUSE_PAPER_IDS } from "../../app/lib/housePaper.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

function kv(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
}
const T = Date.UTC(2026, 10, 20, 1, 17, 22);
const state = (n, open = false) => JSON.stringify({
  started_at: T, paper_agg: { trades: n }, current_position: open ? { paper: true, symbol: "PERP_SOL_USDC" } : null,
  paper_trades: Array.from({ length: n }, (_, i) => ({ symbol: "PERP_ETH_USDC", direction: "LONG", opened_at: T + (i * 2 + 1) * 3600000, closed_at: T + (i * 2 + 2) * 3600000, reason: "TP" })),
});

test("every read with a run gets a count; house runs are marked; an unread state is unread, never 0", async () => {
  const agent = kv({
    [`agent:state:${HOUSE_PAPER_IDS.session_fade}`]: state(3, true),
    [`agent:state:${HOUSE_PAPER_IDS.spot_absorb}`]: state(0),
    "agent:state:0x95e26e980e300c34360933b849457f42c6bd7622": state(12),
  });
  const runs = await buildPaperCounts({ NEXUS_AGENT: agent, LAB_STORE: kv() });
  assert.deepEqual(runs.session_fade, { wallet: HOUSE_PAPER_IDS.session_fade, house: true, count: 3, target: 30, open: true });
  assert.deepEqual(runs.spot_absorb, { wallet: HOUSE_PAPER_IDS.spot_absorb, house: true, count: 0, target: 30, open: false });
  assert.equal(runs.level_reclaim.house, false);
  assert.equal(runs.level_reclaim.count, 12);
  assert.equal(runs.btc_lead_lag.unread, true, "no state stored = unread");
  assert.equal(runs.btc_lead_lag.count, undefined);
  assert.equal(runs.session_momentum, undefined, "retired: no run");
  // every registered read but the retired one
  assert.equal(Object.keys(runs).length, REGISTERED_READS.length - 1);
  // counts only: no R, no P&L, no size reaches the reply
  for (const r of Object.values(runs)) for (const k of Object.keys(r)) assert.ok(["wallet", "house", "count", "target", "open", "unread"].includes(k), k);
});

test("the route serves the cached body for 60 s, then rebuilds; writes are refused", async () => {
  const store = kv();
  const env = { NEXUS_AGENT: kv({ [`agent:state:${HOUSE_PAPER_IDS.session_fade}`]: state(1) }), LAB_STORE: store };
  const res = await handlePaperRun(["signals", "paper-counts"], new Request("https://x/signals/paper-counts"), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assert.equal(body.runs.session_fade.count, 1);
  assert.ok(store.m.has(PAPER_COUNTS_KEY));
  store.m.set(PAPER_COUNTS_KEY, JSON.stringify({ ok: true, runs: { cached: true } }));
  assert.deepEqual((await (await handlePaperRun(["signals", "paper-counts"], new Request("https://x/"), env)).json()).runs, { cached: true });
  assert.equal((await handlePaperRun(["signals", "paper-counts"], new Request("https://x/", { method: "POST" }), env)).status, 405);
  // the per-read route now finds a house run
  const one = await handlePaperRun(["signals", "paper-run", "session_fade"], new Request("https://x/"), env);
  assert.equal(one.status, 200);
  assert.equal((await one.json()).house, true);
});
