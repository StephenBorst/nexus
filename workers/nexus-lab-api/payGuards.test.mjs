// Run: node --test workers/nexus-lab-api/payGuards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_USDC, MIROSHARK_PAYTO, usdcUnits, checkServerPayment, pickServerPayment,
  redeemedAs, redeemOnce, alreadyRedeemedMsg, takeSimCredit, refundSimCredit, takeCapSlot, releaseCapSlot,
} from "./payGuards.mjs";

// MiroShark's published Base entry, verbatim from x402.miroshark.xyz/.well-known/x402 (2026-09-27).
const MIRO_BASE = { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", maxAmountRequired: "1000000", network: "eip155:8453", payTo: "0x6cab485fc28ec70d3845113b704d4824e4d2b24f", scheme: "exact" };
const MIRO_SOL = { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", maxAmountRequired: "1000000", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "9vWbPNMvt8ui1cNN8jWWPUWT5LPmeXzq7nr3vry1vMPH", scheme: "exact" };
const OPTS = { payTo: MIROSHARK_PAYTO, maxUnits: usdcUnits(1) };

// Async KV stand-in with the three calls the helpers use.
function kv(init = {}) {
  const m = new Map(Object.entries(init));
  const puts = [];
  return {
    m, puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { puts.push({ k, v, o }); m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

test("usdcUnits: dollars → 6-dp units, rounded; junk → 0", () => {
  assert.equal(usdcUnits(1), 1000000n);
  assert.equal(usdcUnits(1.005), 1005000n);
  assert.equal(usdcUnits("2"), 2000000n);
  for (const bad of [0, -1, NaN, undefined, "x"]) assert.equal(usdcUnits(bad), 0n, String(bad));
});

test("the terms MiroShark publishes pass, in both the v1 and v2 field names", () => {
  assert.deepEqual(checkServerPayment(MIRO_BASE, OPTS), { ok: true, units: 1000000n });
  const v2 = { scheme: "exact", network: "eip155:8453", amount: "1000000", asset: BASE_USDC, payTo: MIROSHARK_PAYTO.toUpperCase().replace("0X", "0x"), maxTimeoutSeconds: 300 };
  assert.equal(checkServerPayment(v2, OPTS).ok, true, "payTo compare is case-insensitive");
  assert.equal(checkServerPayment({ ...MIRO_BASE, network: "base" }, OPTS).ok, true, "short network name");
});

test("the key refuses to pay more than the user paid for the credit", () => {
  const twice = checkServerPayment({ ...MIRO_BASE, maxAmountRequired: "1000001" }, OPTS);
  assert.equal(twice.ok, false);
  assert.match(twice.reason, /asks 1\.000001 USDC per run, above the 1\.00 USDC cap/);
  const wallet = checkServerPayment({ ...MIRO_BASE, amount: "500000000" }, OPTS);
  assert.equal(wallet.ok, false, "a whole-wallet ask is refused");
  assert.match(wallet.reason, /500\.00 USDC per run/);
  assert.equal(checkServerPayment({ ...MIRO_BASE, maxAmountRequired: "2000000" }, { ...OPTS, maxUnits: usdcUnits(2) }).ok, true, "raising the cap is an explicit operator choice");
});

test("wrong receiver, token, chain or scheme is refused", () => {
  const cases = [
    [{ ...MIRO_BASE, payTo: "0x000000000000000000000000000000000000dead" }, /receiver .* is not MiroShark/],
    [{ ...MIRO_BASE, asset: "0x4200000000000000000000000000000000000006" }, /not Base USDC/],
    [{ ...MIRO_BASE, network: "eip155:1" }, /not Base/],
    [{ ...MIRO_BASE, scheme: "upto" }, /not "exact"/],
    [MIRO_SOL, /not Base/],
    [null, /no payment terms/],
  ];
  for (const [a, re] of cases) {
    const r = checkServerPayment(a, OPTS);
    assert.equal(r.ok, false, JSON.stringify(a));
    assert.match(r.reason, re);
  }
});

test("amounts that aren't a positive whole number of units are refused", () => {
  for (const amount of ["1e6", "-1", "", "1.5", "0x0f4240", "0"]) {
    assert.equal(checkServerPayment({ ...MIRO_BASE, maxAmountRequired: undefined, amount }, OPTS).ok, false, amount);
  }
});

test("pick: finds the Base entry wherever it sits, and names the failure that got furthest", () => {
  const p = pickServerPayment([MIRO_SOL, MIRO_BASE], OPTS);
  assert.equal(p.ok, true);
  assert.equal(p.accept, MIRO_BASE, "returns the entry itself — it's echoed verbatim in the v2 envelope");
  const pricey = pickServerPayment([MIRO_SOL, { ...MIRO_BASE, maxAmountRequired: "2000000" }], OPTS);
  assert.equal(pricey.ok, false);
  assert.match(pricey.reason, /2\.00 USDC per run/, "the price rise, not 'Solana is not Base'");
  assert.equal(pickServerPayment([], OPTS).ok, false);
  assert.equal(pickServerPayment(undefined, OPTS).ok, false);
});

test("one tx buys one product: a PRO payment can't also buy sim credits, or the reverse", async () => {
  const tx = "0x" + "ab".repeat(32);
  const store = kv();
  const sub = await redeemOnce(store, tx, "sub:redeemed:", "0xpayer", async () => "pro-granted");
  assert.deepEqual(sub, { ok: true, value: "pro-granted" });
  let simGranted = false;
  const sim = await redeemOnce(store, tx, "sim:redeemed:", "0xpayer", async () => { simGranted = true; });
  assert.deepEqual(sim, { ok: false, as: "sub:redeemed:" });
  assert.equal(simGranted, false);
  assert.equal(alreadyRedeemedMsg(sim.as), "this transaction was already redeemed for PRO");

  const tx2 = "0x" + "cd".repeat(32);
  await redeemOnce(store, tx2, "sim:redeemed:", "0xpayer", async () => 20);
  assert.equal(await redeemedAs(store, tx2), "sim:redeemed:");
  assert.equal((await redeemOnce(store, tx2, "sub:redeemed:", "0xpayer", async () => "pro")).ok, false);
  assert.equal(alreadyRedeemedMsg("sim:redeemed:"), "this transaction was already redeemed for sim credits");
});

test("the claim lands before the grant, and a failed grant releases it so the payer can retry", async () => {
  const tx = "0x" + "ef".repeat(32);
  const store = kv();
  await assert.rejects(redeemOnce(store, tx, "sim:redeemed:", "0xpayer", async () => {
    assert.equal(await store.get("sim:redeemed:" + tx), "0xpayer", "claimed before the grant runs");
    throw new Error("kv put failed");
  }), /kv put failed/);
  assert.equal(await redeemedAs(store, tx), null, "claim released");
  assert.deepEqual(await redeemOnce(store, tx, "sim:redeemed:", "0xpayer", async () => 5), { ok: true, value: 5 });
});

test("a replay guard that can't read refuses instead of granting", async () => {
  const broken = { async get() { throw new Error("kv down"); }, async put() {}, async delete() {} };
  await assert.rejects(redeemedAs(broken, "0x" + "00".repeat(32)), /kv down/);
  let granted = false;
  await assert.rejects(redeemOnce(broken, "0x" + "00".repeat(32), "sub:redeemed:", "0xp", async () => { granted = true; }));
  assert.equal(granted, false);
});

test("sim credit: taken before paying, so a second run started mid-payment is refused", async () => {
  const store = kv({ "sim:credits:0xw": "1" });
  const first = await takeSimCredit(store, "sim:credits:0xw");
  assert.deepEqual(first, { ok: true, left: 0 });
  // …the first run is still paying MiroShark here…
  const second = await takeSimCredit(store, "sim:credits:0xw");
  assert.equal(second.ok, false, "one credit, one run");
  await refundSimCredit(store, "sim:credits:0xw");
  assert.equal(await store.get("sim:credits:0xw"), "1", "a run that never queued gives the credit back");
  assert.equal((await takeSimCredit(kv(), "sim:credits:0xnew")).ok, false, "no balance = no run");
});

test("a credit that can't be written stops the run before any money moves", async () => {
  const store = kv({ k: "3" });
  store.put = async () => { throw new Error("kv write failed"); };
  await assert.rejects(takeSimCredit(store, "k"), /kv write failed/);
});

test("daily cap: slot taken up front with the TTL, released on a failed run", async () => {
  const store = kv();
  assert.deepEqual(await takeCapSlot(store, "miro:runs:d", 2, 172800), { ok: true, used: 1 });
  assert.deepEqual(await takeCapSlot(store, "miro:runs:d", 2, 172800), { ok: true, used: 2 });
  assert.deepEqual(await takeCapSlot(store, "miro:runs:d", 2, 172800), { ok: false, used: 2 });
  await releaseCapSlot(store, "miro:runs:d", 172800);
  assert.equal(await store.get("miro:runs:d"), "1");
  assert.ok(store.puts.every((p) => p.o && p.o.expirationTtl === 172800), "every cap write keeps the TTL");
  await releaseCapSlot(kv(), "miro:runs:x", 60); // never below zero
});
