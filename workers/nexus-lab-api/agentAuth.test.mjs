// Auth v2 step 3b: the agent + TWAP on a trading session (agentAuth.mjs), exec following the pointer to
// the stored key (nexus-agent-exec/agentKey.mjs), and source checks that every route took the new path.
// Real signatures (viem) and a real sealed key, so the pointer → key → signer chain is checked end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { agentOwnerRefusal, v2KeyPointer, twapFitsKey, TWAP_KEY_MARGIN_MS } from "./agentAuth.mjs";
import { newKeyMaterial, addKeyMessage, keyRecord, V2_KEY, orderlyKeyOf } from "./v2Keys.mjs";
import { aesGcmEncrypt, aesGcmDecrypt } from "./seedVault.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";
import { SESSIONS_AFTER_KEY } from "./routes-session.mjs";
import { recoverEthAddress } from "./shared.mjs";
import { resolveKeyRecord, isKeyPointer } from "../nexus-agent-exec/agentKey.mjs";

const T0 = 1_790_000_000_000;
const DAY = 86400000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const ENC = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const opts = { recover: recoverEthAddress, now: T0 };

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const envOn = () => ({ NEXUS_AGENT: kv(), AGENT_ENC_KEY: ENC, AUTH_V2_KEYS: "true" });
async function session(account, at = T0) {
  const s = newTradingSession({ address: account.address, now: at });
  return { session: s.session, issued: s.issued, expires: s.expires, sig: await account.signMessage({ message: s.message }) };
}
async function storeKey(env, at = T0) {
  const mat = await newKeyMaterial();
  const rec = keyRecord({ sealed: await aesGcmEncrypt(mat.secret, ENC), accountId: "0xacc", message: addKeyMessage({ orderlyKey: mat.orderlyKey, now: at }), now: at });
  await env.NEXUS_AGENT.put(V2_KEY(A), JSON.stringify(rec));
  return { mat, rec };
}

// ── owner check ──────────────────────────────────────────────────────────────────────────────
test("v1 walletSig still works, and only for its own wallet", async () => {
  const env = envOn();
  const sig = await alice.signMessage({ message: "nexus-trading-key-v1" });
  assert.equal(await agentOwnerRefusal(env, A, { walletSig: sig }, opts), null);
  assert.equal(await agentOwnerRefusal({ ...env, AUTH_V2_KEYS: undefined }, A, { walletSig: sig }, opts), null, "v1 needs no flag");
  const bad = await agentOwnerRefusal(env, A, { walletSig: await mallory.signMessage({ message: "nexus-trading-key-v1" }) }, opts);
  assert.equal(bad.status, 401);
  for (const b of [null, undefined, {}, { walletSig: 42 }]) assert.equal((await agentOwnerRefusal(env, A, b, opts)).status, 401);
});

test("a session proves the wallet in the URL when AUTH_V2_KEYS is on", async () => {
  const env = envOn();
  assert.equal(await agentOwnerRefusal(env, A, { session: await session(alice) }, opts), null);
  assert.equal(await agentOwnerRefusal(env, alice.address, { session: await session(alice) }, opts), null, "address case doesn't matter");
});

test("session refusals: flag off, both auths, someone else's session, expired, ended", async () => {
  const env = envOn();
  const sess = await session(alice);
  assert.equal((await agentOwnerRefusal({ ...env, AUTH_V2_KEYS: "false" }, A, { session: sess }, opts)).body.error, "v2_keys_off");
  assert.equal((await agentOwnerRefusal(env, A, { session: sess, walletSig: "0xab" }, opts)).body.error, "pick_one_auth");
  assert.equal((await agentOwnerRefusal(env, A, { session: await session(mallory) }, opts)).status, 401);
  assert.equal((await agentOwnerRefusal(env, A, { session: sess }, { ...opts, now: T0 + 25 * 3600000 })).status, 401);
  await env.NEXUS_AGENT.put(SESSIONS_AFTER_KEY(A), String(T0 + 1));
  assert.equal((await agentOwnerRefusal(env, A, { session: sess }, opts)).body.error, "session_required");
});

// ── the pointer ──────────────────────────────────────────────────────────────────────────────
test("v2KeyPointer: no key / expired key = 409, active = a pointer with no secret in it", async () => {
  const env = envOn();
  assert.equal((await v2KeyPointer(env, A, { now: T0 })).body.error, "key_required");
  const { rec } = await storeKey(env);
  assert.equal((await v2KeyPointer(env, A, { now: rec.expiresAt })).body.error, "key_expired");
  const ok = await v2KeyPointer(env, A, { now: T0 + DAY });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.record).sort(), ["accountId", "linkedAt", "orderlyKey", "ref", "v"]);
  assert.ok(isKeyPointer(ok.record));
  assert.ok(!JSON.stringify(ok.record).includes(rec.tradingKey), "the sealed secret never leaves v2key:{addr}");
  assert.equal(ok.keyExpiresInDays, 29);
});

test("end to end: exec follows the pointer and signs as the key registered at Orderly", async () => {
  const env = envOn();
  const { mat, rec } = await storeKey(env);
  const link = await v2KeyPointer(env, A, { now: T0 });
  await env.NEXUS_AGENT.put(`agent:key:${A}`, JSON.stringify(link.record));
  const stored = JSON.parse(await env.NEXUS_AGENT.get(`agent:key:${A}`));
  const kd = await resolveKeyRecord(stored, { address: A, kv: env.NEXUS_AGENT, decrypt: (s) => aesGcmDecrypt(s, ENC) });
  assert.equal(kd.v, 2);
  assert.equal(kd.tradingKey, mat.secret);
  assert.equal(await orderlyKeyOf(kd.tradingKey), rec.orderlyKey);
  assert.equal(kd.accountId, "0xacc");
  assert.equal(kd.expiresAt, rec.expiresAt);
});

test("a rotated key: the pointer follows the wallet's CURRENT key", async () => {
  const env = envOn();
  await storeKey(env);
  const link = await v2KeyPointer(env, A, { now: T0 });
  const { mat: fresh } = await storeKey(env, T0 + 20 * DAY);   // rotation replaces v2key:{addr}
  const kd = await resolveKeyRecord(link.record, { address: A, kv: env.NEXUS_AGENT, decrypt: (s) => aesGcmDecrypt(s, ENC) });
  assert.equal(kd.tradingKey, fresh.secret);
});

test("twapFitsKey: the whole schedule plus an hour's margin must end before expiry", () => {
  const exp = T0 + 10 * DAY;
  assert.equal(twapFitsKey({ now: T0, durationMin: 60, expiresAt: exp }), true);
  const edge = (exp - T0 - TWAP_KEY_MARGIN_MS) / 60000;
  assert.equal(twapFitsKey({ now: T0, durationMin: edge, expiresAt: exp }), false, "ending exactly at the margin isn't enough");
  assert.equal(twapFitsKey({ now: T0, durationMin: edge - 1, expiresAt: exp }), true);
  assert.equal(twapFitsKey({ now: T0, durationMin: NaN, expiresAt: exp }), false);
  assert.equal(twapFitsKey({ now: T0, durationMin: 60, expiresAt: undefined }), false);
});

// ── wiring ───────────────────────────────────────────────────────────────────────────────────
const api = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const exec = readFileSync(new URL("../nexus-agent-exec/index.js", import.meta.url), "utf8");

test("lab-api: every agent owner check passes the whole body (so a session can be read)", () => {
  assert.doesNotMatch(api, /requireOwner\(\w+\??\.walletSig\)/);
  assert.ok((api.match(/await requireOwner\(\w+\)/g) || []).length >= 15);
  assert.doesNotMatch(api, /twapOwns/);
});

test("lab-api: each live-key path has a v2 branch that stores the pointer", () => {
  const sites = [
    ["PUT /agent/:address — activate", "if (v2Link)"],
    ["POST /agent/:address/directive", 'mode === "AUTONOMOUS" && wantsV2(body)'],
    ["POST /agent/:address/bankr/activate", 'mode !== "PAPER" && wantsV2(body)'],
    ["POST /agent/:address/bankr/mode", 'mode !== "PAPER" && wantsV2(body)'],
    ["POST /twap/:address/start", "twapFitsKey("],
  ];
  for (const [marker, branch] of sites) {
    const start = api.indexOf(marker);
    assert.ok(start > 0, marker);
    const chunk = api.slice(start, start + 9000);
    assert.ok(chunk.includes(branch), `${marker}: ${branch}`);
    assert.ok(chunk.includes("v2KeyPointer(env, address)"), `${marker}: links the stored key`);
  }
});

test("lab-api: kill takes no per-request challenge (borst 2026-10-31)", () => {
  const start = api.indexOf('parts[2] === "kill"');
  const route = api.slice(start, api.indexOf("POST /agent/:address/directive", start));
  assert.doesNotMatch(route, /requireOwnerV2/);
  assert.match(route, /await requireOwner\(kbody\)/);
});

test("exec: every key read follows the pointer; entries check the key's expiry", () => {
  assert.doesNotMatch(exec, /decryptTradingKey\(keyData\.tradingKey/);
  assert.equal((exec.match(/resolveKeyRecord\(JSON\.parse\(keyRaw\), keyIo\(address, env\)\)/g) || []).length, 7);
  const enter = exec.slice(exec.indexOf("async function enterPosition("), exec.indexOf("Portfolio delta cap (PRO)"));
  assert.match(enter, /keyHoldRefusal\(/);
});
