// The paid feed's CLEARED gate (borst 2026-11-27): a registered read is sold only while isCleared is true for it.
// Run: node --test app/lib/soldRead.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { soldReadGate, soldGrade, soldRows, judgmentFromRecord, SOLD_READS, SOLD_COINS } from "./soldRead.mjs";
import { HOLDOUT_COINS } from "./recordedUniverse.mjs";

const reg = (over = {}) => ({ axis: "btc_lead_lag", stage: "PAPER", failing: null, numbers: { events: 150, meanR: 0.45, beatsRandomPct: 96.8 }, ...over });
const board = (r = reg()) => ({ asOf: "2026-12-30T00:00:00Z", pipeline: { reads: [r] } });
const PASS = { verdict: "PASS", randomCheck: { verdict: "BEAT", pctBeaten: 93 }, wallet: "0x1f74e1ec61427c9ba3f95d7f406a195b7fbdeeeb" };

test("only btc_lead_lag is sold, on the 11 main coins, never a holdout coin", () => {
  assert.deepEqual([...SOLD_READS], ["btc_lead_lag"]);
  assert.deepEqual([...SOLD_COINS], ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "WLD"]);
  for (const c of HOLDOUT_COINS) assert.ok(!SOLD_COINS.includes(c), c);
  assert.equal(soldReadGate({ axis: "level_reclaim", scoreboard: board(), judgment: judgmentFromRecord(PASS) }).error, "not_sold");
});

test("not cleared = refused: today's TRADEABLE with no paper verdict, a FAIL, a PASS that didn't beat random, failing, locked", () => {
  const today = soldReadGate({ axis: "btc_lead_lag", scoreboard: board(reg({ stage: "TRADEABLE" })), judgment: null });
  assert.equal(today.ok, false); assert.equal(today.status, 403); assert.equal(today.error, "not_cleared"); assert.equal(today.stage, "TRADEABLE");
  assert.match(today.line, /only a CLEARED read is sold/);
  const refused = [
    { judgment: judgmentFromRecord({ ...PASS, verdict: "FAIL" }) },
    { judgment: judgmentFromRecord({ ...PASS, randomCheck: { verdict: "DIDNT_BEAT" } }) },
    { judgment: judgmentFromRecord({ verdict: "PASS" }) },
    { judgment: { verdict: "PASS", randomCheck: { verdict: "BEAT" } } }, // not recorded
    { judgment: judgmentFromRecord(PASS), scoreboard: board(reg({ failing: ["main card: 120 events, mean R -0.02"] })) },
    { judgment: judgmentFromRecord(PASS), locks: { btc_lead_lag: { since: "2026-12-01" } } },
    { judgment: judgmentFromRecord(PASS), scoreboard: board(reg({ stage: "EDGE" })) },
  ];
  for (const [i, o] of refused.entries()) {
    const g = soldReadGate({ axis: "btc_lead_lag", scoreboard: board(), ...o });
    assert.equal(g.ok, false, `case ${i}`); assert.equal(g.error, "not_cleared", `case ${i}`);
  }
});

test("an unread board sells nothing", () => {
  assert.equal(soldReadGate({ axis: "btc_lead_lag", scoreboard: null, judgment: judgmentFromRecord(PASS) }).status, 503);
  assert.equal(soldReadGate({ axis: "btc_lead_lag", scoreboard: { pipeline: { reads: [] } }, judgment: judgmentFromRecord(PASS) }).status, 503);
});

test("cleared = sold, with the live grade from the scoreboard's own row", () => {
  const g = soldReadGate({ axis: "btc_lead_lag", scoreboard: board(), judgment: judgmentFromRecord(PASS) });
  assert.equal(g.ok, true);
  const grade = soldGrade("btc_lead_lag", g.reg, judgmentFromRecord(PASS), "2026-12-30T00:00:00Z");
  assert.equal(grade.cleared, true);
  assert.equal(grade.events, 150); assert.equal(grade.meanR, 0.45); assert.equal(grade.beatsRandomPct, 96.8);
  assert.deepEqual(grade.paper, { verdict: "PASS", beatRandomPct: 93 });
  assert.equal(grade.proof, "https://trade.nexustradinglabs.com/proof/paper/btc_lead_lag");
});

test("rows: one per sold coin; unread or uncomputed says so, never a side", () => {
  const rows = soldRows({ ETH: { side: "LONG", t: Date.UTC(2026, 11, 30, 5), reason: "btc_lead_lag · x" }, SOL: { side: null, t: null, reason: "no event" } }, ["XRP"]);
  assert.equal(rows.length, SOLD_COINS.length);
  assert.deepEqual(rows.find((r) => r.symbol === "ETH"), { symbol: "ETH", side: "LONG", event_at: "2026-12-30T05:00:00.000Z", reason: "btc_lead_lag · x" });
  assert.equal(rows.find((r) => r.symbol === "SOL").side, null);
  assert.deepEqual(rows.find((r) => r.symbol === "XRP"), { symbol: "XRP", side: null, event_at: null, reason: "history read failed" });
  assert.equal(rows.find((r) => r.symbol === "BTC").reason, "not computed");
});
