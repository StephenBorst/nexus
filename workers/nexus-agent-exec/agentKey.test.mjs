// Exec's key loader (auth v2 step 3b): a v1 record, or a link to the wallet's v2 key read fresh every
// time; and source checks that every key read in exec goes through it and every LIVE entry is gated
// by the expiry rule. Fake KV + a fake decrypt; no network.
// Run: node --test workers/nexus-agent-exec/agentKey.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadAgentKey, agentKeyMeta } from "./agentKey.mjs";
import { V2_KEY_LINK } from "../../app/lib/agentKeyExpiry.mjs";

const A = "0x" + "ab".repeat(20);
const T0 = 1_790_000_000_000;
function fakeKv(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const decrypt = async (s) => `plain(${s})`;
const v2rec = (sealed, exp, acct = "0xacc2") => JSON.stringify({ v: 2, enc: "v1", tradingKey: sealed, accountId: acct, orderlyKey: "ed25519:K", expiresAt: exp });

test("v1: the stored record, decrypted, exactly as exec read it before", async () => {
  const kv = fakeKv({ [`agent:key:${A}`]: JSON.stringify({ tradingKey: "v1:iv:ct", accountId: "0xacc1", registeredAt: 5, enc: "v1" }) });
  const k = await loadAgentKey(kv, A, { decrypt });
  assert.deepEqual(k, { tradingKey: "plain(v1:iv:ct)", accountId: "0xacc1", registeredAt: 5, enc: "v1", v: 1 });
  assert.deepEqual(await agentKeyMeta(kv, A), { v: 1 });
});

test("v2: the link reads the wallet's v2 record, fresh each time (a rotated key is used next tick)", async () => {
  const kv = fakeKv({ [`agent:key:${A}`]: JSON.stringify(V2_KEY_LINK(T0)), [`v2key:${A}`]: v2rec("v1:old:key", T0 + 1000) });
  const a = await loadAgentKey(kv, A, { decrypt });
  assert.deepEqual(a, { v: 2, tradingKey: "plain(v1:old:key)", accountId: "0xacc2", orderlyKey: "ed25519:K", expiresAt: T0 + 1000 });
  await kv.put(`v2key:${A}`, v2rec("v1:new:key", T0 + 9000));
  const b = await loadAgentKey(kv, A, { decrypt });
  assert.equal(b.tradingKey, "plain(v1:new:key)");
  assert.deepEqual(await agentKeyMeta(kv, A), { v: 2, expiresAt: T0 + 9000, orderlyKey: "ed25519:K" });
});

test("no record, or a link to a removed v2 key = no key (the same as a deleted v1 record)", async () => {
  assert.equal(await loadAgentKey(fakeKv(), A, { decrypt }), null);
  assert.equal(await agentKeyMeta(fakeKv(), A), null);
  const dangling = fakeKv({ [`agent:key:${A}`]: JSON.stringify(V2_KEY_LINK(T0)) });
  assert.equal(await loadAgentKey(dangling, A, { decrypt }), null);
  assert.equal(await agentKeyMeta(dangling, A), null);
  const corrupt = fakeKv({ [`agent:key:${A}`]: "{nope" });
  assert.equal(await loadAgentKey(corrupt, A, { decrypt }), null);
});

test("a TWAP reads its own record name the same way", async () => {
  const kv = fakeKv({ [`twap:key:${A}`]: JSON.stringify(V2_KEY_LINK(T0)), [`v2key:${A}`]: v2rec("v1:t:k", T0 + 5) });
  const k = await loadAgentKey(kv, A, { decrypt, recordKey: `twap:key:${A}` });
  assert.equal(k.tradingKey, "plain(v1:t:k)");
  assert.equal(await loadAgentKey(kv, A, { decrypt }), null, "the agent's record is separate");
});

test("deleting the agent's record (DEACTIVATE / KILL) deletes only the link: the wallet keeps its key", async () => {
  const kv = fakeKv({ [`agent:key:${A}`]: JSON.stringify(V2_KEY_LINK(T0)), [`v2key:${A}`]: v2rec("v1:x:y", T0 + 5) });
  await kv.delete(`agent:key:${A}`);
  assert.equal(await loadAgentKey(kv, A, { decrypt }), null);
  assert.ok(kv.m.has(`v2key:${A}`));
});

const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("exec: every key read goes through the loader (no raw agent:key / twap:key reads left)", () => {
  assert.doesNotMatch(src, /NEXUS_AGENT\.get\(`(agent|twap):key:/);
  assert.doesNotMatch(src, /JSON\.parse\(keyRaw\)/);
  assert.equal((src.match(/delete\(`agent:key:/g) || []).length, 1, "only the kill switch deletes it");
});

test("exec: every LIVE entry checks the key's expiry after loading it, before any order", () => {
  const fn = src.slice(src.indexOf("async function enterPosition("), src.indexOf("async function fetchGradedExitLevels("));
  const load = fn.indexOf("keyData = await loadKey(address, env);");
  const gate = fn.indexOf("keyEntryRefusal(keyData, { holdHours: config.maxHoldHours");
  const order = fn.indexOf('"/v1/order"');
  assert.ok(load > 0 && gate > load && order > gate, "load → expiry gate → order");
});

test("exec: AUTONOMOUS agents get the expiry alert; it never blocks the tick", () => {
  assert.match(src, /if \(config\.mode === "AUTONOMOUS"\) await alertKeyExpiry\(address, state, env\);/);
  const fn = src.slice(src.indexOf("async function alertKeyExpiry("), src.indexOf("async function processUser("));
  assert.match(fn, /try \{/);
  assert.match(fn, /keyAlertDue\(/);
  assert.match(fn, /state\.key_alert_at = now;/);
});
