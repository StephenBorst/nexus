// Auth v2 step 3b in lab-api: the agent (and /twap) prove the wallet with a session, run on the
// wallet's v2 key through a link, and take the §C challenge to arm AUTONOMOUS. REAL session and
// challenge signatures (viem); fake KV; no network. Plus source checks on the routes.
// Run: node --test workers/nexus-lab-api/agentAuthV2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { agentOwner, v2KeyReady, writeV2Link, configChallengeNeeded, armChallenge, Refused } from "./agentAuthV2.mjs";
import { keyInUse } from "./keyInUse.mjs";
import { V2_KEY } from "./v2Keys.mjs";
import { buildChallenge } from "./logic.mjs";
import { recoverEthAddress } from "./shared.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";
import { V2_KEY_LINK } from "../../app/lib/agentKeyExpiry.mjs";

const T0 = 1_790_000_000_000;
const H = 3600000, DAY = 24 * H;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const envOn = (extra = {}) => ({ NEXUS_AGENT: kv(), AUTH_V2_KEYS: "true", ...extra });
async function session(account, at = T0) {
  const s = newTradingSession({ address: account.address, now: at });
  return { session: s.session, issued: s.issued, expires: s.expires, sig: await account.signMessage({ message: s.message }) };
}
let seq = 0;
async function challenge(env, account, action, at = T0) {
  const nonce = `n${seq++}`;
  const record = { action, wallet: account.address.toLowerCase(), nonce, amount: null, expires: at + 120000 };
  await env.NEXUS_AGENT.put(`auth:nonce:${nonce}`, JSON.stringify(record));
  return { nonce, v2Sig: await account.signMessage({ message: buildChallenge(record) }) };
}
const putKey = (env, expiresAt) => env.NEXUS_AGENT.put(V2_KEY(A), JSON.stringify({ v: 2, tradingKey: "v1:a:b", accountId: "0xacc", orderlyKey: "ed25519:K", expiresAt }));
const owner = (env, body, now = T0) => agentOwner(env, A, body, { recover: recoverEthAddress, now });
const refusal = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof Refused, String(e)); return e; } assert.fail("expected a refusal"); };

test("owner: walletSig is still the v1 path, and a session only counts when AUTH_V2_KEYS is \"true\"", async () => {
  const sig = await alice.signMessage({ message: "nexus-trading-key-v1" });
  assert.deepEqual(await owner(envOn(), { walletSig: sig }), { ok: true, via: "v1" });
  assert.deepEqual(await owner({ ...envOn(), AUTH_V2_KEYS: undefined }, { walletSig: sig }), { ok: true, via: "v1" }, "v1 unchanged with the flag off");
  const bad = await owner(envOn(), { walletSig: await mallory.signMessage({ message: "nexus-trading-key-v1" }) });
  assert.deepEqual([bad.ok, bad.status, bad.body.error], [false, 401, "walletSig_required"]);
  assert.equal((await owner(envOn(), {})).status, 401);
  assert.equal((await owner(envOn(), null)).status, 401);
  const sess = await session(alice);
  for (const v of [undefined, "false", "1", "TRUE"]) {
    const r = await owner({ ...envOn(), AUTH_V2_KEYS: v }, { session: sess });
    assert.deepEqual([r.ok, r.status, r.body.error], [false, 400, "v2_keys_off"], String(v));
  }
  assert.deepEqual(await owner(envOn(), { session: sess }), { ok: true, via: "v2" });
});

test("owner (v2): another wallet's session, an expired one, or both kinds of auth are refused", async () => {
  assert.equal((await owner(envOn(), { session: await session(mallory) })).status, 401);
  assert.equal((await owner(envOn(), { session: await session(alice) }, T0 + 25 * H)).status, 401);
  const both = await owner(envOn(), { session: await session(alice), walletSig: "0xab" });
  assert.deepEqual([both.status, both.body.error], [400, "pick_one_auth"]);
});

test("key ready: none, expired, or a hold that runs past it → 409 with the step to take; never makes a key", async () => {
  const env = envOn();
  const none = await refusal(v2KeyReady(env, A, { now: T0 }));
  assert.deepEqual([none.status, none.body.error], [409, "key_required"]);
  assert.match(none.body.hint, /\/v2\/key\/begin/);
  assert.equal(env.NEXUS_AGENT.m.size, 0, "activation never makes a key");
  await putKey(env, T0 - 1);
  assert.equal((await refusal(v2KeyReady(env, A, { now: T0 }))).body.error, "key_expired");
  await putKey(env, T0 + 5 * DAY);
  assert.equal((await refusal(v2KeyReady(env, A, { holdHours: 168, now: T0 }))).body.error, "hold_runs_past_key");
  assert.equal((await refusal(v2KeyReady(env, A, { holdHours: undefined, now: T0 }))).body.error, "no_max_hold");
  assert.deepEqual(await v2KeyReady(env, A, { holdHours: 4, now: T0 }), { keyExpiresAt: T0 + 5 * DAY, keyExpiresInDays: 5 });
  assert.deepEqual(await v2KeyReady(env, A, { holdHours: null, now: T0 }), { keyExpiresAt: T0 + 5 * DAY, keyExpiresInDays: 5 }, "ASSISTED: no hold check");
});

test("the link is all an agent stores on the v2 path", async () => {
  const k = kv();
  await writeV2Link(k, `agent:key:${A}`, T0);
  assert.deepEqual(JSON.parse(k.m.get(`agent:key:${A}`)), V2_KEY_LINK(T0));
  assert.doesNotMatch(k.m.get(`agent:key:${A}`), /tradingKey|seed|secret/);
});

test("§C: arming AUTONOMOUS, or raising its size or leverage, needs the challenge; nothing else does", () => {
  const live = { mode: "AUTONOMOUS", capitalPerTrade: 30, leverage: 5 };
  assert.equal(configChallengeNeeded(null, live), true, "first activation live");
  assert.equal(configChallengeNeeded({ ...live, mode: "PAPER" }, live), true, "PAPER → AUTONOMOUS");
  assert.equal(configChallengeNeeded({ ...live, mode: "ASSISTED" }, live), true);
  assert.equal(configChallengeNeeded(live, live), false, "same values");
  assert.equal(configChallengeNeeded(live, { ...live, capitalPerTrade: 31 }), true);
  assert.equal(configChallengeNeeded(live, { ...live, leverage: 6 }), true);
  assert.equal(configChallengeNeeded({ mode: "AUTONOMOUS" }, live), true, "a value set for the first time is a raise");
  assert.equal(configChallengeNeeded(live, { ...live, capitalPerTrade: 10, leverage: 2 }), false, "lowering is free");
  assert.equal(configChallengeNeeded(live, { ...live, mode: "PAPER", capitalPerTrade: 999 }), false, "not live");
  assert.equal(configChallengeNeeded(live, { ...live, mode: "ASSISTED", leverage: 50 }), false);
});

test("the challenge: needs the right action from this wallet, once", async () => {
  const env = envOn();
  const go = (body, action = "agent.activate") => armChallenge(env, { action, address: A, body, now: T0 });
  assert.equal((await refusal(go({}))).body.error, "challenge_required");
  assert.equal((await refusal(go(await challenge(env, alice, "agent.config")))).status, 401, "another action's challenge");
  assert.equal((await refusal(go(await challenge(env, mallory, "agent.activate")))).status, 401, "another wallet");
  const ch = await challenge(env, alice, "agent.activate");
  await go(ch);
  assert.equal((await refusal(go(ch))).body.error, "challenge_unknown_or_expired", "burned on use");
  await go(await challenge(env, alice, "agent.mode"), "agent.mode");
  await go(await challenge(env, alice, "agent.config"), "agent.config");
});

test("/v2/key/remove waits while the key signs for a live agent position or a running TWAP", async () => {
  const k = kv();
  assert.equal(await keyInUse(k, A), null);
  await k.put(`agent:key:${A}`, JSON.stringify(V2_KEY_LINK(T0)));
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC", paper: false } }));
  assert.equal((await keyInUse(k, A)).error, "agent_position_open");
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC", paper: true } }));
  assert.equal(await keyInUse(k, A), null, "a paper position signs nothing");
  await k.put(`agent:key:${A}`, JSON.stringify({ tradingKey: "v1:a:b", accountId: "0x" }));
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC" } }));
  assert.equal(await keyInUse(k, A), null, "a v1 agent signs with its own key");
  await k.put(`twap:key:${A}`, JSON.stringify(V2_KEY_LINK(T0)));
  await k.put(`twap:${A}`, JSON.stringify({ status: "ACTIVE" }));
  assert.equal((await keyInUse(k, A)).error, "twap_active");
  await k.put(`twap:${A}`, JSON.stringify({ status: "COMPLETE" }));
  assert.equal(await keyInUse(k, A), null);
  const rk = readFileSync(new URL("./routes-key.mjs", import.meta.url), "utf8");
  const fn = rk.slice(rk.indexOf("export async function removeKey("));
  assert.ok(fn.indexOf("keyInUse(kv, wallet)") > 0 && fn.indexOf("keyInUse(kv, wallet)") < fn.indexOf("removeAtOrderly("), "checked before anything is removed");
});

// ── Source checks on the routes (index.js) ──────────────────────────────────────────────────────
const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const route = (start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a + 1);
  assert.ok(a > 0 && b > a, `${start} … ${end}`);
  return src.slice(a, b);
};

test("every agent owner check is awaited (it's async now) and none takes a bare walletSig", () => {
  assert.doesNotMatch(src, /[^t] requireOwner\(/, "always `await requireOwner(`");
  assert.doesNotMatch(src, /requireOwner\(\w+\??\.walletSig\)/);
  assert.equal((src.match(/await requireOwner\(/g) || []).length >= 10, true);
});

test("kill: walletSig or a session, no per-request challenge (borst 2026-10-31)", () => {
  const r = route('parts[2] === "kill"', "POST /agent/:address/directive");
  assert.match(r, /await requireOwner\(kbody\)/);
  assert.doesNotMatch(r, /requireOwnerV2|armChallenge/);
});

test("activation on the v2 path: key ready → challenge → link; never a key from the client or a signature", () => {
  for (const [start, end, action] of [
    ["// PUT /agent/:address — activate", "// PUT /agent/:address/config", "agent.activate"],
    ["POST /agent/:address/bankr/activate", "POST /agent/:address/bankr/mode", "agent.activate"],
    ["POST /agent/:address/bankr/mode", '"not found" }, request, 404);\n    }\n\n    // ── /agents/leaderboard', "agent.mode"],
    ["POST /agent/:address/directive", "DELETE /agent/:address/directive", "agent.activate"],
  ]) {
    const r = route(start, end);
    const ready = r.indexOf("v2KeyReady(env, address");
    const ch = r.indexOf(`armChallenge(env, { action: "${action}"`);
    const link = r.indexOf("writeV2Link(AGENT_KV, `agent:key:${address}`)");
    assert.ok(ready > 0 && ch > ready && link > ch, `${start}: ready → challenge → link`);
    assert.match(r, /viaV2/);
  }
  const put = route("// PUT /agent/:address — activate", "// PUT /agent/:address/config");
  assert.match(put, /if \(viaV2 && tradingKey\) return json\(\{ error: "no_client_key"/);
});

test("config: raising a live agent needs the agent.config challenge on the v2 path", () => {
  const r = route("// PUT /agent/:address/config", "// DELETE /agent/:address — deactivate");
  assert.match(r, /configChallengeNeeded\(prevCfg, config\)/);
  assert.match(r, /armChallenge\(env, \{ action: "agent\.config"/);
  assert.ok(r.indexOf("armChallenge(") < r.indexOf("AGENT_KV.put(`agent:config:"), "before the write");
});

test("/twap: a session runs it on the v2 key (no challenge), bounded by the key's expiry", () => {
  const r = route('if (parts[0] === "twap" && parts[1])', 'if (parts[0] === "agent" && parts[1])');
  assert.match(r, /v2KeyReady\(env, address, \{ holdHours: durationMin \/ 60 \}\)/);
  assert.match(r, /writeV2Link\(TWAP_KV, `twap:key:\$\{address\}`\)/);
  assert.doesNotMatch(r, /armChallenge|requireOwnerV2|twapOwns/);
  assert.equal((r.match(/await twapOwner\(body\)/g) || []).length, 2, "start and cancel");
});
