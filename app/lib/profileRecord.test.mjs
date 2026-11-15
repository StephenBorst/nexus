import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileCalls, recordTiles, signedUsd } from "./profileRecord.mjs";
import { handleAgents } from "../../workers/nexus-lab-api/routes-agents.mjs";

const W = "0x" + "ab".repeat(20);

test("profileCalls: the wallet's own calls, never its agent trades or resolution rows", () => {
  const feed = [
    { id: "1", wallet: W.toUpperCase().replace("0X", "0x"), symbol: "PERP_ETH_USDC", displayName: "kai" },
    { id: "2", wallet: W, agent: true, displayName: "Nexus Agent" },
    { id: "3", wallet: W, resolution: true },
    { id: "4", wallet: "0x" + "cd".repeat(20) },
    null,
  ];
  assert.deepEqual(profileCalls(feed, W).map((t) => t.id), ["1"]);
  assert.deepEqual(profileCalls(feed, ""), []);
  assert.deepEqual(profileCalls(null, W), []);
});

test("recordTiles: the grader's record when it answered, else the calls shown, labelled", () => {
  const g = recordTiles({ calls: 28, hitRate: 36, avgR: 0.05 }, { wins: 3, losses: 1, avgR: 1.2 });
  assert.deepEqual([g.source, g.calls, g.winRate, g.avgR], ["grader", 28, 36, 0.05]);
  assert.equal(g.sub, "28 graded calls");
  const local = recordTiles(null, { wins: 3, losses: 1, avgR: 0.4 });
  assert.deepEqual([local.source, local.calls, local.winRate, local.avgR], ["calls", 4, 75, 0.4]);
  assert.match(local.sub, /on the calls shown/);
  assert.equal(recordTiles({ calls: 0, hitRate: null, avgR: null }, { wins: 0, losses: 0 }).winRate, null);
  assert.equal(recordTiles(null, { wins: 0, losses: 0 }).sub, "no graded calls yet");
  assert.equal(recordTiles(null, { wins: 1, losses: 0, avgR: NaN }).avgR, null, "no R, no number");
});

test("signedUsd", () => {
  assert.equal(signedUsd(12.5), "+$12.50");
  assert.equal(signedUsd(-3.2), "−$3.20");
  assert.equal(signedUsd(0), "+$0.00");
  assert.equal(signedUsd("x"), "—");
});

test("the profile reads the rules: no agent rows, tiles from the grader, no BEST R:R brag", () => {
  const src = readFileSync(new URL("../pages/trader/index.tsx", import.meta.url), "utf8");
  assert.match(src, /setTheses\(profileCalls\(all, wallet\) as FeedThesis\[\]\)/);
  assert.match(src, /recordTiles\(record, /);
  assert.doesNotMatch(src, /label="BEST R:R"/);
  assert.doesNotMatch(src, /GRADED RECORD<\/div>/, "realised live trades aren't a graded record");
  assert.match(src, /signedUsd\(agentRec\.netPnl\)/);
});

test("/agents/standing refuses anything but a 0x address before it reaches Supabase", async () => {
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return new Response("[]", { status: 200 }); };
  try {
    const env = { SUPABASE_URL: "https://sb.example", SUPABASE_ANON_KEY: "k" };
    const ask = (a) => handleAgents(["agents", "standing", a], new Request(`https://x/agents/standing/${encodeURIComponent(a)}`), env, {});
    for (const bad of ["%", "%25", "0x*", "0x" + "ab".repeat(19) + "%", "vitalik.eth"]) {
      const r = await ask(bad);
      assert.equal(r.status, 400, bad);
    }
    assert.equal(fetched, 0, "nothing sent upstream");
    const ok = await ask(W);
    assert.equal(ok.status, 200);
    assert.equal(fetched, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
