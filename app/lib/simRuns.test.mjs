// Run: node --test app/lib/simRuns.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { simRunKey, loadSimRun, saveSimRun, SIM_RUN_TTL_MS } from "./simRuns.mjs";

const W = "0xAbC0000000000000000000000000000000000001";
const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };

test("key: the same scenario keeps its key while its live numbers tick", () => {
  const a = simRunKey(W, "◆ Simulate this fade", { kind: "thesis", coin: "BTC", direction: "SHORT", entry: 64000, notes: "funding +31%/yr" });
  const b = simRunKey(W, "◆ Simulate this fade", { kind: "thesis", coin: "BTC", direction: "SHORT", entry: 64210, notes: "funding +29%/yr" });
  assert.equal(a, b);
  const m1 = simRunKey(W, "◆ Simulate", { kind: "macro", question: "Fed cut in Dec?", yesProbPct: 41 });
  const m2 = simRunKey(W, "◆ Simulate", { kind: "macro", question: "Fed cut in Dec?", yesProbPct: 44 });
  assert.equal(m1, m2, "crowd odds move; the question doesn't");
  assert.equal(simRunKey(W.toLowerCase(), "x", { query: "abc" }), simRunKey(W, "x", { query: "abc" }), "wallet case doesn't matter");
});

test("key: a different coin, side, question, card or wallet is a different run", () => {
  const base = simRunKey(W, "L", { kind: "thesis", coin: "BTC", direction: "LONG" });
  const others = [
    simRunKey(W, "L", { kind: "thesis", coin: "ETH", direction: "LONG" }),
    simRunKey(W, "L", { kind: "thesis", coin: "BTC", direction: "SHORT" }),
    simRunKey(W, "other card", { kind: "thesis", coin: "BTC", direction: "LONG" }),
    simRunKey("0x0000000000000000000000000000000000000002", "L", { kind: "thesis", coin: "BTC", direction: "LONG" }),
    simRunKey(W, "L", { kind: "macro", question: "BTC LONG" }),
  ];
  for (const k of others) assert.notEqual(k, base);
  assert.equal(new Set(others).size, others.length);
  assert.equal(simRunKey(null, "L", {}), null, "no wallet, nothing to key");
  assert.match(base, /^nx_sim_run:0xabc0{36}1:[0-9a-z]+$/);
});

test("save → load round-trips a pending run and a finished one", () => {
  const s = mem(), k = simRunKey(W, "L", { query: "q" });
  const t0 = 1_790_000_000_000;
  saveSimRun(s, k, { statusUrl: "https://x402.miroshark.xyz/report/r1", startedAt: t0 });
  assert.deepEqual(loadSimRun(s, k, t0 + 60_000), { statusUrl: "https://x402.miroshark.xyz/report/r1", startedAt: t0 });
  saveSimRun(s, k, { statusUrl: "https://x402.miroshark.xyz/report/r1", startedAt: t0, done: { shareUrl: "https://miroshark.xyz/s/r1" } });
  assert.equal(loadSimRun(s, k, t0 + 60_000).done.shareUrl, "https://miroshark.xyz/s/r1");
});

test("load: expired, malformed, missing or unreadable → null (the card just starts fresh)", () => {
  const s = mem(), k = "nx_sim_run:0x1:abc", t0 = 1_790_000_000_000;
  saveSimRun(s, k, { statusUrl: "u", startedAt: t0 });
  assert.equal(loadSimRun(s, k, t0 + SIM_RUN_TTL_MS), null, "a day old");
  s.setItem(k, "{not json");
  assert.equal(loadSimRun(s, k, t0), null);
  s.setItem(k, JSON.stringify({ startedAt: t0 }));
  assert.equal(loadSimRun(s, k, t0), null, "no status URL");
  assert.equal(loadSimRun(s, "nx_sim_run:0x1:missing", t0), null);
  assert.equal(loadSimRun({ getItem() { throw new Error("SecurityError"); } }, k, t0), null);
  assert.equal(loadSimRun(s, null, t0), null);
  assert.equal(loadSimRun(null, k, t0), null);
});

test("save: a storage that throws (private mode, quota) never breaks the run", () => {
  assert.doesNotThrow(() => saveSimRun({ setItem() { throw new Error("QuotaExceededError"); } }, "k", { statusUrl: "u", startedAt: 1 }));
  assert.doesNotThrow(() => saveSimRun(null, "k", { statusUrl: "u", startedAt: 1 }));
  assert.doesNotThrow(() => saveSimRun(mem(), null, { statusUrl: "u", startedAt: 1 }));
});
