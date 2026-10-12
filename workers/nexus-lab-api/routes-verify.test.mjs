// The call page's "Verify outcome" re-runs the real grader. These pin that it agrees with gradeCall
// (not the old CoinGecko first-touch), refuses calls that aren't public, and flags a stamp that
// doesn't match a fresh grade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCall, handleVerify, orderlySourceUrl, isPublicCall } from "./routes-verify.mjs";
import { gradeCall } from "./logic.mjs";

const H = 3600;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const t0 = T0 / 1000;

// Hourly candles starting at the posting hour.
function candles(rows) {
  return { t: rows.map((_, i) => t0 + i * H), h: rows.map((r) => r[0]), l: rows.map((r) => r[1]), c: rows.map((r) => r[2] ?? r[1]) };
}

const base = { id: "c1", symbol: "PERP_BTC_USDC", direction: "LONG", stopLoss: 95, takeProfit1: 110, createdAt: T0 + 60_000, isPublic: true };

test("a resting order that never trades is PENDING, not a WIN (the old CoinGecko check said WIN)", () => {
  // Market at ~105 the whole time, entry typed at 100 (below), TP1 110 touched later.
  const t = { ...base, entryPrice: 100 };
  const cd = candles([[106, 104], [108, 103], [111, 104], [112, 105]]);
  const v = verifyCall(t, cd);
  assert.equal(v.fresh.outcome, "PENDING");
  assert.equal(v.fresh.awaitingEntry, true);
  assert.equal(v.verdict, "UNSTAMPED");
});

test("fresh grade equals gradeCall, and a matching stamp reads MATCH", () => {
  const t = { ...base, entryPrice: 100 };
  const cd = candles([[101, 99], [104, 98], [111, 103]]);
  const g = gradeCall(t, cd);
  assert.equal(g.outcome, "WIN");
  const v = verifyCall({ ...t, gradedOutcome: "WIN", gradedR: g.r, gradeV: 3 }, cd);
  assert.deepEqual(v.fresh, { outcome: g.outcome, r: g.r });
  assert.equal(v.verdict, "MATCH");
  assert.ok(v.candlesChecked >= 3);
});

test("a stamp that disagrees with a fresh grade reads MISMATCH", () => {
  const t = { ...base, entryPrice: 100, gradedOutcome: "WIN", gradedR: 2, gradeV: 3 };
  const cd = candles([[101, 99], [100, 94]]); // stopped out
  const v = verifyCall(t, cd);
  assert.equal(v.fresh.outcome, "LOSS");
  assert.equal(v.verdict, "MISMATCH");
});

test("no candle window → NO_DATA, never a guess", () => {
  const v = verifyCall({ ...base, entryPrice: 100 }, null);
  assert.equal(v.verdict, "NO_DATA");
  assert.equal(v.fresh, null);
});

test("only public, non-holders, non-duplicate calls are verifiable", () => {
  assert.equal(isPublicCall({ isPublic: true }), true);
  assert.equal(isPublicCall({ isPublic: false }), false);
  assert.equal(isPublicCall({ isPublic: true, holdersOnly: true }), false);
  assert.equal(isPublicCall({ isPublic: true, duplicateOf: "0xabc" }), false);
});

function env(theses) {
  return { LAB_STORE: { get: async (k) => (k === "lab:0x00000000000000000000000000000000000000aa" ? JSON.stringify({ theses }) : null) } };
}
const req = () => new Request("https://og.example/verify/x/y", { headers: { "cf-connecting-ip": "1.1.1." + Math.floor(Math.random() * 250) } });
const W = "0x00000000000000000000000000000000000000aa";

test("route: private call is a 404 and never reads candles", async () => {
  let read = false;
  const res = await handleVerify(["verify", W, "c1"], req(), env([{ ...base, entryPrice: 100, isPublic: false }]), { getCandles: async () => { read = true; return null; } });
  assert.equal(res.status, 404);
  assert.equal(read, false);
});

test("route: public call returns the fresh grade, the rule and the Orderly source", async () => {
  const cd = candles([[101, 99], [111, 103]]);
  const res = await handleVerify(["verify", W, "c1"], req(), env([{ ...base, entryPrice: 100 }]), { getCandles: async () => cd, now: () => T0 + 5 * H * 1000 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.method, "orderly_1h_regrade");
  assert.equal(body.fresh.outcome, "WIN");
  assert.match(body.source, /^https:\/\/api-evm\.orderly\.org\/tv\/history\?symbol=PERP_BTC_USDC&resolution=60&from=\d+&to=\d+$/);
  assert.match(body.rule, /entry must trade/i);
});

test("route: unrelated paths fall through", async () => {
  assert.equal(await handleVerify(["verify", W], req(), env([])), null);
  assert.equal(await handleVerify(["sub", "verify"], req(), env([])), null);
});

test("source URL starts an hour before the post", () => {
  const u = orderlySourceUrl("PERP_ETH_USDC", T0, T0 + 1000);
  assert.ok(u.includes(`from=${t0 - 3600}`));
});
