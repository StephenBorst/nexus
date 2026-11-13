// Run: node --test app/lib/slippage.test.mjs
// Live slippage: exchange fill vs the mark it was decided on (slippage.mjs), the route, and exec's wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderSide, slippageBps, slipRecord, pushSlip, slippageSummary, slippageLine, SLIP_KEEP } from "./slippage.mjs";
import { handleSlippage } from "../../workers/nexus-lab-api/routes-slippage.mjs";

test("the order's side: entries and adds trade with the position, partials and closes against it", () => {
  assert.deepEqual(["entry", "add", "partial", "close"].map((k) => orderSide("LONG", k)), ["BUY", "BUY", "SELL", "SELL"]);
  assert.deepEqual(["entry", "add", "partial", "close"].map((k) => orderSide("SHORT", k)), ["SELL", "SELL", "BUY", "BUY"]);
});

test("positive = paid worse than the mark, on both sides; negative = improvement", () => {
  assert.equal(slippageBps("BUY", 100, 100.05), 5, "bought 5 bps above");
  assert.equal(slippageBps("SELL", 100, 99.95), 5, "sold 5 bps below");
  assert.equal(slippageBps("BUY", 100, 99.98), -2, "bought below the mark");
  assert.equal(slippageBps("SELL", 100, 100.1), -10);
  assert.equal(slippageBps("BUY", 0, 100), null);
});

test("only exchange-confirmed fills count: a mark fallback is unknown, never 0", () => {
  const base = { t: 1, symbol: "PERP_ETH_USDC", direction: "LONG", kind: "entry", mark: 100, orderId: 7 };
  assert.deepEqual(slipRecord({ ...base, fill: { price: 100.03, source: "exchange" } }),
    { t: 1, symbol: "PERP_ETH_USDC", kind: "entry", side: "BUY", mark: 100, fill: 100.03, bps: 3, order_id: "7" });
  assert.equal(slipRecord({ ...base, fill: { price: 100, source: "mark" } }), null);
  assert.equal(slipRecord({ ...base, fill: null }), null);
  assert.equal(slipRecord({ ...base, kind: "weird", fill: { price: 100, source: "exchange" } }), null);
});

test("the list keeps the newest SLIP_KEEP; the summary is overall and per kind; nothing measured says nothing", () => {
  let list = [];
  for (let i = 0; i < SLIP_KEEP + 5; i++) list = pushSlip(list, { t: i, kind: i % 2 ? "close" : "entry", bps: i % 10 });
  assert.equal(list.length, SLIP_KEEP);
  assert.equal(list[0].t, SLIP_KEEP + 4);
  const s = slippageSummary([{ kind: "entry", bps: 1 }, { kind: "entry", bps: 3 }, { kind: "close", bps: 8 }, { kind: "close", bps: -2 }]);
  assert.deepEqual([s.n, s.medianBps, s.meanBps, s.worstBps], [4, 2, 2.5, 8]);
  assert.deepEqual([s.byKind.entry.n, s.byKind.entry.medianBps, s.byKind.close.worstBps, s.byKind.add.n], [2, 2, 8, 0]);
  assert.match(slippageLine(s), /^Live slippage over 4 exchange fills: median \+2 bps, worst \+8 bps/);
  assert.equal(slippageLine(slippageSummary([])), null, "no live fill = no line, never 0 bps");
  assert.deepEqual(pushSlip([{ t: 1 }], null), [{ t: 1 }]);
});

test("the route serves the fills, the summary and the rule; read-only", async () => {
  const W = "0x" + "ab".repeat(20);
  const store = new Map([[`agent:state:${W}`, JSON.stringify({ live_slip: [{ t: 1, kind: "entry", side: "BUY", mark: 100, fill: 100.02, bps: 2 }] })]]);
  const env = { NEXUS_AGENT: { get: async (k) => store.get(k) ?? null, put: async () => { throw new Error("read-only"); } } };
  const body = await (await handleSlippage(["agent", W, "slippage"], new Request("https://x/"), env)).json();
  assert.deepEqual([body.summary.n, body.summary.medianBps, body.fills.length], [1, 2, 1]);
  assert.match(body.rule, /positive = paid worse than the mark/);
  assert.equal((await handleSlippage(["agent", "0x" + "00".repeat(20), "slippage"], new Request("https://x/"), env)).status, 404);
  assert.equal(await handleSlippage(["agent", W, "tape"], new Request("https://x/"), env), null);
});

test("exec records each live fill site with the mark it decided on, and only from the exchange's answer", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-exec/index.js", import.meta.url), "utf8");
  const calls = src.match(/state\.live_slip = pushSlip\(state\.live_slip, slipRecord\(\{[^\n]*\}\)\);/g) || [];
  assert.equal(calls.length, 4, "entry, add, partial, close");
  for (const k of ["entry", "add", "partial", "close"]) assert.ok(calls.some((c) => c.includes(`kind: "${k}"`)), k);
  assert.ok(calls.find((c) => c.includes('kind: "entry"')).includes("fill: entryFill"));
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /live_slip\b(?!\s*=\s*pushSlip|,)/, "exec never reads it to trade");
});
