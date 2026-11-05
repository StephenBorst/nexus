import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePulse, buildPulse, PULSE_CACHE_KEY } from "./routes-pulse.mjs";
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
  assert.deepEqual([body.open, body.gradedWeek, body.last, body.headline], [0, 0, null, null]);
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
