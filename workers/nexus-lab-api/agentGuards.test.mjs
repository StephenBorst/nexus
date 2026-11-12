// Auth v2 step 3b follow-ups: §C on the session path (arming AUTONOMOUS or raising its size / leverage
// needs the challenge, always on), and /v2/key/remove refusing while the key signs for a live agent
// position or an active TWAP. Fake KV, real challenge signatures (viem); no network.
// Run: node --test workers/nexus-lab-api/agentGuards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { configChallengeNeeded, KEY_POINTER_REF } from "./agentAuth.mjs";
import { keyInUse } from "./keyInUse.mjs";
import { checkChallenge, Refused } from "./routes-key.mjs";
import { buildChallenge } from "./logic.mjs";

const T0 = 1_790_000_000_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const POINTER = JSON.stringify({ v: 2, ref: KEY_POINTER_REF, accountId: "0xacc", linkedAt: T0 });
function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

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
  assert.equal(configChallengeNeeded(live, { ...live, capitalPerTrade: undefined }), false, "unset isn't a raise");
  assert.equal(configChallengeNeeded(live, { ...live, mode: "PAPER", capitalPerTrade: 999 }), false, "not live");
  assert.equal(configChallengeNeeded(live, { ...live, mode: "ASSISTED", leverage: 50 }), false, "ASSISTED places nothing");
});

test("the challenge the session path calls: this wallet, this action, once (no AUTH_V2 flag needed)", async () => {
  const env = { NEXUS_AGENT: kv() }; // no AUTH_V2, no AUTH_V2_KEYS: checkChallenge is always on
  let seq = 0;
  const mint = async (account, action) => {
    const nonce = `n${seq++}`;
    const record = { action, wallet: account.address.toLowerCase(), nonce, amount: null, expires: T0 + 120000 };
    await env.NEXUS_AGENT.put(`auth:nonce:${nonce}`, JSON.stringify(record));
    return { nonce, v2Sig: await account.signMessage({ message: buildChallenge(record) }) };
  };
  const go = (b, action = "agent.activate") => checkChallenge(env, { action, wallet: A, nonce: b.nonce, v2Sig: b.v2Sig, now: T0 });
  const refused = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof Refused); return e; } assert.fail("expected a refusal"); };
  assert.equal((await refused(go({}))).body.error, "challenge_required");
  assert.equal((await refused(go(await mint(alice, "agent.config")))).status, 401, "another action's challenge");
  assert.equal((await refused(go(await mint(mallory, "agent.activate")))).status, 401, "another wallet");
  const ch = await mint(alice, "agent.activate");
  await go(ch);
  assert.equal((await refused(go(ch))).body.error, "challenge_unknown_or_expired", "burned on use");
  await go(await mint(alice, "agent.mode"), "agent.mode");
  await go(await mint(alice, "agent.config"), "agent.config");
});

test("/v2/key/remove waits while the key signs for a live agent position or an active TWAP", async () => {
  const k = kv();
  assert.equal(await keyInUse(k, A), null);
  await k.put(`agent:key:${A}`, POINTER);
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC", paper: false } }));
  assert.equal((await keyInUse(k, A)).error, "agent_position_open");
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC", paper: true } }));
  assert.equal(await keyInUse(k, A), null, "a paper position signs nothing");
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: null }));
  assert.equal(await keyInUse(k, A), null, "flat");
  await k.put(`agent:key:${A}`, JSON.stringify({ tradingKey: "v1:a:b", accountId: "0x" }));
  await k.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC" } }));
  assert.equal(await keyInUse(k, A), null, "a v1 agent signs with its own key");
  await k.put(`twap:key:${A}`, POINTER);
  await k.put(`twap:${A}`, JSON.stringify({ status: "ACTIVE" }));
  assert.equal((await keyInUse(k, A)).error, "twap_active");
  await k.put(`twap:${A}`, JSON.stringify({ status: "COMPLETE" }));
  assert.equal(await keyInUse(k, A), null);
  assert.equal(await keyInUse(k, A.toUpperCase().replace("0X", "0x")), null, "address case doesn't matter");
});

test("removeKey checks keyInUse before it removes anything at Orderly", () => {
  const rk = readFileSync(new URL("./routes-key.mjs", import.meta.url), "utf8");
  const fn = rk.slice(rk.indexOf("export async function removeKey("));
  const guard = fn.indexOf("await keyInUse(kv, wallet)");
  assert.ok(guard > 0 && guard < fn.indexOf("removeAtOrderly("), "guard first");
  assert.match(fn, /if \(busy\) throw new Refused\(409, busy\);/);
});

// ── Source checks on the routes (index.js) ──────────────────────────────────────────────────────
const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const route = (start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a + 1);
  assert.ok(a > 0 && b > a, `${start} … ${end}`);
  return src.slice(a, b);
};

test("session path: key checked → challenge → pointer written, in every route that arms live trading", () => {
  for (const [start, end, action] of [
    ["POST /agent/:address/bankr/activate", "POST /agent/:address/bankr/mode", "agent.activate"],
    ["POST /agent/:address/bankr/mode", "// ── /agents/leaderboard", "agent.mode"],
    ['parts[2] === "directive"', "DELETE /agent/:address/directive", "agent.activate"],
  ]) {
    const r = route(start, end);
    const at = r.indexOf("wantsV2(body)) {\n          const link = await v2KeyPointer(env, address);");
    assert.ok(at > 0, start);
    const block = r.slice(at);
    const ch = block.indexOf(`sessionChallenge(body, "${action}")`);
    const put = block.indexOf("await AGENT_KV.put(`agent:key:${address}`, JSON.stringify(link.record))");
    assert.ok(ch > 0 && put > ch, `${start}: challenge before the pointer`);
    assert.match(r, /if \(mode === "AUTONOMOUS" && !wantsV2\(body\)\) \{[^]*?requireOwnerV2/, `${start}: requireOwnerV2 is the v1 path's`);
  }
});

test("PUT /agent and PUT /agent/config: the challenge comes before the config write", () => {
  const act = route("// PUT /agent/:address — activate", "// PUT /agent/:address/config");
  assert.ok(act.indexOf('sessionChallenge(body, "agent.activate")') < act.indexOf("AGENT_KV.put(`agent:config:"));
  assert.match(act, /if \(v2Live && configChallengeNeeded\(await storedConfig\(\), config\)\)/);
  const cfg = route("// PUT /agent/:address/config", "// DELETE /agent/:address — deactivate");
  assert.ok(cfg.indexOf('sessionChallenge(body, "agent.config")') > 0);
  assert.ok(cfg.indexOf('sessionChallenge(body, "agent.config")') < cfg.indexOf("AGENT_KV.put(`agent:config:"));
  assert.match(cfg, /if \(wantsV2\(body\) && configChallengeNeeded\(await storedConfig\(\), config\)\)/);
});

test("sessionChallenge is always on: no AUTH_V2 check in it", () => {
  const r = route("const sessionChallenge = async", "const storedConfig");
  assert.match(r, /checkChallenge\(env, \{ action, wallet: address/);
  assert.doesNotMatch(r, /AUTH_V2/);
});
