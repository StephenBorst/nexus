import { test } from "node:test";
import assert from "node:assert/strict";
import { addToDay, flashFillTotals, parseFillReport, verifyFill, bookFill, logFlashOrder, settleFlashOrders, spotSummary, DAY_KEY, FILL_KEY, FLASH_PENDING, dayOf } from "./spotLedger.mjs";

function kv(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", limit = 1000 } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }; },
  };
}
const unlocked = (_k, fn) => fn();
const T = Date.UTC(2026, 9, 28, 12);
const HASH = "0x" + "ab".repeat(32);
const SIG = "5".repeat(88);
const ID = "40d5fec8-1659-4cdf-9185-c31690543cb5";
const io = (o = {}) => ({
  evmRpc: async () => o.receipt ?? { status: "0x1" },
  solRpc: async () => o.sol ?? { value: [{ err: null, confirmationStatus: "confirmed" }] },
  fetchImpl: async () => new Response(JSON.stringify(o.near ?? { status: "SUCCESS" }), { status: 200 }),
});

test("addToDay accumulates per route", () => {
  let d = addToDay(null, "jupiter");
  d = addToDay(d, "jupiter");
  d = addToDay(d, "flash", { trades: 1, feeUsd: 0.005, notionalUsd: 5 });
  assert.deepEqual(d, { jupiter: { trades: 2, feeUsd: 0, notionalUsd: 0 }, flash: { trades: 1, feeUsd: 0.005, notionalUsd: 5 } });
});

test("flashFillTotals sums notional + our fee, takes the last fill time", () => {
  const t = flashFillTotals([{ notional: "3", integratorFeeNotional: "0.003", filledAt: "2026-10-27T01:00:00Z" }, { notional: "2", integratorFeeNotional: "0.002", filledAt: "2026-10-28T01:00:00Z" }]);
  assert.equal(t.notionalUsd, 5);
  assert.ok(Math.abs(t.feeUsd - 0.005) < 1e-12);
  assert.equal(dayOf(t.lastAt), "2026-10-28");
  assert.equal(flashFillTotals(null).fills, 0);
});

test("reports are shape-checked per route", () => {
  assert.deepEqual(parseFillReport({ route: "spandex", id: HASH.toUpperCase().replace("0X", "0x"), chainId: 8453 }), { route: "spandex", id: HASH, chainId: 8453 });
  assert.equal(parseFillReport({ route: "spandex", id: HASH, chainId: 10 }).error, "bad_report"); // chain we don't swap on
  assert.equal(parseFillReport({ route: "jupiter", id: "short" }).error, "bad_report");
  assert.equal(parseFillReport({ route: "flash", id: ID }).error, "bad_report"); // Flash is booked server-side only
  assert.equal(parseFillReport({ route: "near", id: "0x" + "1".repeat(40) }).route, "near");
  assert.deepEqual(parseFillReport({ route: "woofi" }), { route: "woofi", id: "" });
});

test("verifyFill: only a proven trade counts", async () => {
  assert.equal(await verifyFill({ route: "spandex", id: HASH, chainId: 8453 }, io()), true);
  assert.equal(await verifyFill({ route: "spandex", id: HASH, chainId: 8453 }, io({ receipt: { status: "0x0" } })), false);
  assert.equal(await verifyFill({ route: "spandex", id: HASH, chainId: 8453 }, { ...io(), evmRpc: async () => null }), false);
  assert.equal(await verifyFill({ route: "jupiter", id: SIG }, io({ sol: { value: [{ err: { InstructionError: [] }, confirmationStatus: "confirmed" }] } })), false);
  assert.equal(await verifyFill({ route: "jupiter", id: SIG }, io({ sol: { value: [{ err: null, confirmationStatus: "processed" }] } })), false);
  assert.equal(await verifyFill({ route: "near", id: "x".repeat(10) }, io({ near: { status: "REFUNDED" } })), false);
  assert.equal(await verifyFill({ route: "near", id: "x".repeat(10) }, io()), true);
});

test("bookFill: books once, refuses unproven, never stores a wallet", async () => {
  const env = { LAB_STORE: kv() };
  const rep = { route: "jupiter", id: SIG };
  assert.equal(await bookFill(env, rep, io(), { lock: unlocked, now: T }), "booked");
  assert.equal(await bookFill(env, rep, io(), { lock: unlocked, now: T }), "already");
  assert.deepEqual(JSON.parse(env.LAB_STORE.m.get(DAY_KEY("2026-10-28"))).jupiter.trades, 1);
  assert.deepEqual(JSON.parse(env.LAB_STORE.m.get(FILL_KEY("jupiter", SIG))), { day: "2026-10-28" });
  assert.equal(await bookFill(env, { route: "spandex", id: HASH, chainId: 8453 }, io({ receipt: { status: "0x0" } }), { lock: unlocked, now: T }), "unproven");
  assert.equal(env.LAB_STORE.m.has(FILL_KEY("spandex", HASH)), false);
});

test("bookFill: two identical reports at once → booked once (same lease key)", async () => {
  const env = { LAB_STORE: kv() };
  const held = new Map();
  const lock = async (k, fn) => { while (held.get(k)) await held.get(k); let done; held.set(k, new Promise((r) => { done = r; })); try { return await fn(); } finally { held.delete(k); done(); } };
  const slowIo = { ...io(), solRpc: async () => { await new Promise((r) => setTimeout(r, 5)); return { value: [{ err: null, confirmationStatus: "finalized" }] }; } };
  const r = await Promise.all([bookFill(env, { route: "jupiter", id: SIG }, slowIo, { lock, now: T }), bookFill(env, { route: "jupiter", id: SIG }, slowIo, { lock, now: T })]);
  assert.deepEqual(r.sort(), ["already", "booked"]);
  assert.equal(JSON.parse(env.LAB_STORE.m.get(DAY_KEY("2026-10-28"))).jupiter.trades, 1);
});

test("woofi counts opens", async () => {
  const env = { LAB_STORE: kv() };
  await bookFill(env, { route: "woofi", id: "" }, io(), { lock: unlocked, now: T });
  await bookFill(env, { route: "woofi", id: "" }, io(), { lock: unlocked, now: T });
  assert.equal(JSON.parse(env.LAB_STORE.m.get(DAY_KEY("2026-10-28"))).woofi.trades, 2);
});

test("logFlashOrder keeps the id + funder only for an accepted order", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal(await logFlashOrder(env, JSON.stringify({ orderId: ID }), JSON.stringify({ funderAddress: "0x" + "12".repeat(20) }), T), true);
  assert.deepEqual(JSON.parse(env.LAB_STORE.m.get(FLASH_PENDING(ID))), { funder: "0x" + "12".repeat(20), at: T });
  assert.equal(await logFlashOrder(env, "not json", "{}", T), false);
  assert.equal(await logFlashOrder(env, JSON.stringify({ orderId: "nope" }), "{}", T), false);
});

function flashFetch(byId) {
  return async (url) => {
    const id = url.match(/orders\/([0-9a-f-]{36})/)[1];
    const b = byId[id];
    if (b === 404) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(b), { status: 200 });
  };
}

test("settleFlashOrders: books filled orders with fee + notional on the fill day, waits on open ones, drops dead ones", async () => {
  const OPEN = "11111111-1111-4111-8111-111111111111", GONE = "22222222-2222-4222-8222-222222222222", NOFILL = "33333333-3333-4333-8333-333333333333";
  const funder = "0x" + "12".repeat(20);
  const env = {
    FLASH_API_KEY: "k",
    LAB_STORE: kv({
      [FLASH_PENDING(ID)]: JSON.stringify({ funder, at: T - 3600_000 }),
      [FLASH_PENDING(OPEN)]: JSON.stringify({ funder, at: T - 3600_000 }),
      [FLASH_PENDING(GONE)]: JSON.stringify({ funder, at: T - 2 * 3600_000 }),
      [FLASH_PENDING(NOFILL)]: JSON.stringify({ funder, at: T - 3600_000 }),
    }),
  };
  const fetchImpl = flashFetch({
    [ID]: { order: { status: "ORDER_STATUS_FILLED" }, fills: [{ notional: "5", integratorFeeNotional: "0.005", filledAt: "2026-10-28T03:00:00Z" }] },
    [OPEN]: { order: { status: "ORDER_STATUS_ACCEPTED" }, fills: [] },
    [GONE]: 404,
    [NOFILL]: { order: { status: "ORDER_STATUS_CANCELLED" }, fills: [] },
  });
  const r = await settleFlashOrders(env, { fetchImpl, lock: unlocked, now: T });
  assert.deepEqual(r, { seen: 4, booked: 1, waiting: 1, dropped: 1, failed: 0 });
  const day = JSON.parse(env.LAB_STORE.m.get(DAY_KEY("2026-10-28")));
  assert.deepEqual(day.flash, { trades: 1, feeUsd: 0.005, notionalUsd: 5 });
  assert.equal(env.LAB_STORE.m.has(FLASH_PENDING(ID)), false, "booked → pending dropped (funder forgotten)");
  assert.equal(env.LAB_STORE.m.has(FLASH_PENDING(OPEN)), true);
  assert.equal(env.LAB_STORE.m.has(FLASH_PENDING(NOFILL)), false, "cancelled with no fills → dropped, nothing booked");
  // Running again books nothing twice.
  env.LAB_STORE.m.set(FLASH_PENDING(ID), JSON.stringify({ funder, at: T }));
  await settleFlashOrders(env, { fetchImpl, lock: unlocked, now: T });
  assert.equal(JSON.parse(env.LAB_STORE.m.get(DAY_KEY("2026-10-28"))).flash.trades, 1);
});

test("settleFlashOrders without a key does nothing", async () => {
  assert.deepEqual(await settleFlashOrders({ LAB_STORE: kv() }, { lock: unlocked }), { seen: 0, booked: 0, waiting: 0, dropped: 0, failed: 0 });
});

test("spotSummary: totals + per-day rows over the window", () => {
  const s = spotSummary({ "2026-10-28": { jupiter: { trades: 2 }, flash: { trades: 1, feeUsd: 0.005, notionalUsd: 5 } }, "2026-10-01": { jupiter: { trades: 9 } } }, 7, T);
  assert.equal(s.rows.length, 7);
  assert.equal(s.total.jupiter.trades, 2, "outside the window is left out");
  assert.equal(s.total.flash.feeUsd, 0.005);
});
