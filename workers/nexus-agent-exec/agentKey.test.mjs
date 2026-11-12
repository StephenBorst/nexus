// Exec's half of auth v2 step 3b (agentKey.mjs): following a pointer, the expiry rule, the daily alert.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveKeyRecord, keyHoldRefusal, keyAlertDue, keyAlertText, isKeyPointer, KEY_ALERT_DAYS } from "./agentKey.mjs";

const T0 = 1_790_000_000_000;
const H = 3600000, DAY = 24 * H;
const A = "0x1111111111111111111111111111111111111111";
const kvOf = (init) => ({ get: async (k) => (k in init ? init[k] : null) });
const decrypt = async (s) => `open(${s})`;

test("v1 record: decrypted in place, as before", async () => {
  const kd = await resolveKeyRecord({ tradingKey: "v1:x:y", accountId: "0xacc", enc: "v1" }, { address: A, kv: kvOf({}), decrypt });
  assert.deepEqual([kd.v, kd.tradingKey, kd.accountId], [1, "open(v1:x:y)", "0xacc"]);
});

test("pointer: follows v2key:{addr}, address case-insensitive", async () => {
  const kv = kvOf({ [`v2key:${A}`]: JSON.stringify({ v: 2, tradingKey: "v1:a:b", accountId: "0xacc", orderlyKey: "ed25519:K", expiresAt: T0 + DAY }) });
  const kd = await resolveKeyRecord({ v: 2, ref: "v2key" }, { address: A.toUpperCase().replace("0X", "0x"), kv, decrypt });
  assert.deepEqual([kd.v, kd.tradingKey, kd.accountId, kd.expiresAt], [2, "open(v1:a:b)", "0xacc", T0 + DAY]);
});

test("a pointer with no key THROWS (never reads as 'no key', which would abandon a position)", async () => {
  for (const stored of [undefined, "not json", JSON.stringify({ v: 1, tradingKey: "x" }), JSON.stringify({ v: 2 })]) {
    const kv = kvOf(stored === undefined ? {} : { [`v2key:${A}`]: stored });
    await assert.rejects(resolveKeyRecord({ v: 2, ref: "v2key" }, { address: A, kv, decrypt }));
  }
  await assert.rejects(resolveKeyRecord({ accountId: "x" }, { address: A, kv: kvOf({}), decrypt }), "a v1 record without a key");
});

test("isKeyPointer: only the exact shape", () => {
  assert.equal(isKeyPointer({ v: 2, ref: "v2key" }), true);
  for (const r of [null, {}, { v: 2 }, { ref: "v2key" }, { v: "2", ref: "v2key" }, { v: 2, ref: "other" }]) assert.equal(isKeyPointer(r), false);
});

test("keyHoldRefusal: v1 always passes; v2 needs the max hold to end before expiry", () => {
  const v2 = { v: 2, expiresAt: T0 + 10 * H };
  assert.equal(keyHoldRefusal({ keyData: { v: 1 }, now: T0, maxHoldHours: 9999 }), null);
  assert.equal(keyHoldRefusal({ keyData: v2, now: T0, maxHoldHours: 4 }), null);
  assert.equal(keyHoldRefusal({ keyData: v2, now: T0, maxHoldHours: 10 }), null, "ending exactly at expiry is allowed");
  assert.match(keyHoldRefusal({ keyData: v2, now: T0, maxHoldHours: 11 }), /run past/);
  assert.match(keyHoldRefusal({ keyData: v2, now: T0 + 10 * H, maxHoldHours: 1 }), /expired/);
  for (const m of [undefined, null, 0, -1, "x"]) assert.match(keyHoldRefusal({ keyData: v2, now: T0, maxHoldHours: m }), /no max hold/);
  assert.match(keyHoldRefusal({ keyData: { v: 2 }, now: T0, maxHoldHours: 1 }), /expired/, "unknown expiry fails closed");
});

test("keyAlertDue: from 3 days out, once per UTC day, and after expiry", () => {
  const exp = T0 + 30 * DAY;
  assert.equal(keyAlertDue({ expiresAt: exp, now: T0, lastAlertDay: null }).due, false);
  const at = exp - KEY_ALERT_DAYS * DAY;
  const a = keyAlertDue({ expiresAt: exp, now: at, lastAlertDay: null });
  assert.equal(a.due, true);
  assert.equal(a.hoursLeft, 72);
  assert.equal(keyAlertDue({ expiresAt: exp, now: at + H, lastAlertDay: a.day }).due, a.day !== new Date(at + H).toISOString().slice(0, 10));
  assert.equal(keyAlertDue({ expiresAt: exp, now: at + DAY, lastAlertDay: a.day }).due, true, "next day, again");
  const gone = keyAlertDue({ expiresAt: exp, now: exp + H, lastAlertDay: a.day });
  assert.deepEqual([gone.expired, gone.hoursLeft], [true, 0]);
  assert.equal(keyAlertDue({ expiresAt: undefined, now: T0, lastAlertDay: null }).due, false);
});

test("keyAlertText: days, hours, expired", () => {
  assert.match(keyAlertText({ hoursLeft: 70, expired: false }), /about 3 days/);
  assert.match(keyAlertText({ hoursLeft: 20, expired: false }), /about 20h/);
  assert.match(keyAlertText({ hoursLeft: 0, expired: true }), /expired/);
});
