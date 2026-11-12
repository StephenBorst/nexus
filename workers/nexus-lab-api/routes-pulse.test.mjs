import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePulse, buildPulse, PULSE_CACHE_KEY, PULSE_BOARD_KEY } from "./routes-pulse.mjs";
import { GRADE_V } from "./grading.mjs";
import { HEADLINE_DEFAULT } from "../../app/lib/proofCopy.mjs";

const NOW = Date.now();
const fakeKv = (entries, pageSize = 1) => {
  const m = new Map(Object.entries(entries));
  const puts = [];
  return {
    puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { puts.push({ k, o }); m.set(k, v); },
    // Paged like Cloudflare's list, so a missing cursor loop would drop wallets.
    async list({ prefix, cursor }) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + pageSize).map((name) => ({ name }));
      const done = start + pageSize >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(start + pageSize) };
    },
  };
};
const call = (id, extra) => ({ id, isPublic: true, symbol: "PERP_SOL_USDC", direction: "SHORT", entryPrice: 100, stopLoss: 105, takeProfit1: 90, ...extra });

test("counts across every page of wallets, leaves out the house, reads the headline from the scoreboard cache", async () => {
  const LAB_STORE = fakeKv({
    "lab:0xa": JSON.stringify({ theses: [call("1", { fillState: "OPEN" })] }),
    "lab:0xb": JSON.stringify({ theses: [call("2", { gradedOutcome: "WIN", gradedR: 2, gradeV: GRADE_V, exitedAt: NOW - 3600000 })] }),
    "lab:0xhouse": JSON.stringify({ theses: [call("3", { fillState: "OPEN" })] }),
    "axisbt:v21:min20": JSON.stringify({ asOf: new Date(NOW).toISOString(), pipeline: { reads: [] } }),
  });
  const p = await buildPulse({ LAB_STORE, HOUSE_CALLER_ADDRESS: "0xHOUSE" }, { now: NOW, scorecardKey: "axisbt:v21:min20" });
  assert.equal(p.open, 1);
  assert.equal(p.gradedWeek, 1);
  assert.equal(p.last.symbol, "SOL");
  assert.equal(p.headline.title, HEADLINE_DEFAULT.title);
});

test("no cached scoreboard = no headline claim; a stale grade stamp counts nowhere", async () => {
  const LAB_STORE = fakeKv({ "lab:0xa": JSON.stringify({ theses: [call("1", { gradedOutcome: "WIN", gradeV: -1, exitedAt: NOW - 1000 })] }) });
  const p = await buildPulse({ LAB_STORE }, { now: NOW, scorecardKey: "axisbt:v21:min20" });
  assert.equal(p.headline, null);
  assert.equal(p.gradedWeek, 0);
  assert.equal(p.last, null);
});

test("route: public GET, any origin, cached 5 minutes; other paths fall through; no writes besides its cache", async () => {
  const LAB_STORE = fakeKv({ "lab:0xa": JSON.stringify({ theses: [] }) });
  const env = { LAB_STORE };
  assert.equal(await handlePulse(["calls", "pulsex"], new Request("https://x/calls/pulsex"), env), null);
  const res = await handlePulse(["calls", "pulse"], new Request("https://x/calls/pulse"), env, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assert.deepEqual([body.open, body.gradedWeek, body.last, body.headline, body.engines.open], [0, 0, null, null, 0]);
  assert.deepEqual(LAB_STORE.puts.map((x) => x.k), [PULSE_CACHE_KEY]);
  assert.equal(LAB_STORE.puts[0].o.expirationTtl, 300);
  const post = await handlePulse(["calls", "pulse"], new Request("https://x/calls/pulse", { method: "POST" }), env);
  assert.equal(post.status, 405);
});

test("index.js reads the headline from the same key the scoreboard route writes", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /const CACHE = axisbtCacheKey\(min\);/);
  assert.match(src, /handlePulse\(parts, request, env, \{ scorecardKey: axisbtCacheKey\(20\) \}\)/);
});

test("engines counted apart and named; both house wallets left out; the wrangler var lists the engines", async () => {
  const g = (id) => call(id, { gradedOutcome: "LOSS", gradedR: -1, gradeV: GRADE_V, exitedAt: NOW - 3600000 });
  const LAB_STORE = fakeKv({
    "lab:0xperson": JSON.stringify({ theses: [call("p", { fillState: "OPEN" })] }),
    "lab:0xember": JSON.stringify({ theses: [g("e1")] }),
    "lab:0xvariant": JSON.stringify({ theses: [g("v1")] }),
    "lab:0xhouse": JSON.stringify({ theses: [g("h1")] }),
    "lab:0xcatalyst": JSON.stringify({ theses: [call("c1", { fillState: "OPEN" })] }),
    "profile:0xember": JSON.stringify({ displayName: "Ember" }),
    "profile:0xperson": JSON.stringify({ displayName: "kai" }),
  });
  const env = { LAB_STORE, HOUSE_CALLER_ADDRESS: "0xHOUSE", HOUSE_CATALYST_ADDRESS: "0xCatalyst", ENGINE_CALLER_ADDRESSES: "0xEmber, 0xVariant" };
  const p = await buildPulse(env, { now: NOW });
  assert.deepEqual([p.open, p.gradedWeek], [1, 0]);
  assert.equal(p.openCalls[0].caller, "kai");
  assert.deepEqual([p.engines.open, p.engines.gradedWeek], [0, 2]);
  assert.deepEqual(p.engines.recentGraded.map((r) => r.caller).sort(), ["0xvari…iant", "Ember"]);
  assert.deepEqual(p.engineRecords.map((r) => [r.caller, r.graded, r.wins, r.netR]).sort(), [["0xvari…iant", 1, 0, -1], ["Ember", 1, 0, -1]]);
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  const m = /^ENGINE_CALLER_ADDRESSES = "([^"]+)"/m.exec(toml);
  assert.ok(m, "ENGINE_CALLER_ADDRESSES is set in wrangler.toml");
  assert.deepEqual(m[1].split(",").map((a) => a.toLowerCase()).sort(), [
    "0x3b2cd0961aec641fb9c821661d173eedf1bcfbe4", "0x493dc0ce72b8b761844cb25bc17b6aff9a28c086",
  ]);
  // Engine A's wallet is a person from 2026-11-08 (Apex Tape), never an engine and never both
  const pf = /^PERSON_FROM_ADDRESSES = "([^"]+)"/m.exec(toml);
  assert.ok(pf, "PERSON_FROM_ADDRESSES is set in wrangler.toml");
  assert.equal(pf[1], "0xd9f7b3273b504e1473c3faba6341299d0ec9b449@2026-11-08T00:00:00Z");
  assert.ok(!m[1].toLowerCase().includes("0xd9f7b3273b504e1473c3faba6341299d0ec9b449"));
});

test("signals: the cleared read with its paper count; last good board reused ≤6h after the scoreboard cache expires, then no claim", async () => {
  const { registrationFor } = await import("../../app/lib/readPipeline.mjs");
  const wallet = registrationFor("level_reclaim").paperWallet.toLowerCase();
  const T0 = Date.parse("2026-11-05T12:00:00Z");
  const board = { asOf: new Date(T0).toISOString(), pipeline: { reads: [{ axis: "level_reclaim", stage: "PAPER", numbers: { exitTrades: 42, exitNetBps: 25.2 } }] } };
  const LAB_STORE = fakeKv({ "axisbt:v21:min20": JSON.stringify(board) });
  const NEXUS_AGENT = fakeKv({ [`agent:state:${wallet}`]: JSON.stringify({ paper_agg: { trades: 3, net: 999 } }) });
  const env = { LAB_STORE, NEXUS_AGENT };
  const p = await buildPulse(env, { now: T0 + 60000, scorecardKey: "axisbt:v21:min20" });
  assert.equal(p.headline.cleared, true);
  assert.deepEqual(p.signals.map((x) => [x.axis, x.stage, x.trades, x.paper.trades, x.paper.target]), [["level_reclaim", "PAPER", 42, 3, 30]]);
  assert.equal(JSON.stringify(p.signals).includes("999"), false, "no paper P&L leaves the record");
  assert.ok(LAB_STORE.puts.some((x) => x.k === PULSE_BOARD_KEY));
  // the scoreboard cache expires: the last good board still serves (paper count re-read), within 6h of its asOf
  await LAB_STORE.put("axisbt:v21:min20", undefined); LAB_STORE.get = ((orig) => async (k) => (k === "axisbt:v21:min20" ? null : orig(k)))(LAB_STORE.get);
  await NEXUS_AGENT.put(`agent:state:${wallet}`, JSON.stringify({ paper_agg: { trades: 4 } }));
  const later = await buildPulse(env, { now: T0 + 5 * 3600e3, scorecardKey: "axisbt:v21:min20" });
  assert.equal(later.headline.cleared, true);
  assert.equal(later.signals[0].paper.trades, 4);
  const stale = await buildPulse(env, { now: T0 + 7 * 3600e3, scorecardKey: "axisbt:v21:min20" });
  assert.deepEqual([stale.headline, stale.signals], [null, []]);
});

test("paper count: a wallet with no state yet is unread (null), never 0", async () => {
  const board = { asOf: new Date(NOW).toISOString(), pipeline: { reads: [{ axis: "level_reclaim", stage: "PAPER", numbers: { exitTrades: 42, exitNetBps: 25.2 } }] } };
  const env = { LAB_STORE: fakeKv({ "axisbt:v21:min20": JSON.stringify(board) }), NEXUS_AGENT: fakeKv({}) };
  const p = await buildPulse(env, { now: NOW, scorecardKey: "axisbt:v21:min20" });
  assert.equal(p.signals[0].paper.trades, null);
});
