// Auth v2 step 3c: withdrawals with the stored random key (withdrawV2.mjs), against a fake Orderly and a
// fake Bankr, with REAL wallet signatures (EIP-712 Withdraw, the session, the challenge) and a real
// stored key. Plus the "no new v1 keys" switch (v1Registration.mjs) and GET /v2/session/new.
// Run: node --test workers/nexus-lab-api/withdrawV2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { bankrWithdrawV2, withdrawPrepareV2, withdrawSubmitV2, withdrawRefusal, withdrawMessage, withdrawTypedData, usdcUnits, answer, ORDERLY_BASE, WITHDRAW_VC } from "./withdrawV2.mjs";
import { storedKeySigner, v2Signer, hasV2Key } from "./tradingSigner.mjs";
import { newKeyMaterial, addKeyMessage, keyRecord, V2_KEY } from "./v2Keys.mjs";
import { BANKR_BASE } from "./routes-key.mjs";
import { aesGcmEncrypt } from "./seedVault.mjs";
import { buildChallenge } from "./logic.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";
import { handleSession, checkTradingSession } from "./routes-session.mjs";
import { v1RegisterOff, v1RegistrationRefusal, bankrRegisterV2Refusal, registerPageV2Html } from "./v1Registration.mjs";
import { revokedTradingRefusal, revokedWallets } from "./revokedTrading.mjs";
import { recoverEthAddress } from "./shared.mjs";

const T0 = 1_790_000_000_000;
const alice = privateKeyToAccount("0x" + "c3".repeat(32));
const mallory = privateKeyToAccount("0x" + "d4".repeat(32));
const A = alice.address.toLowerCase();
const ENC = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const envOn = () => ({ NEXUS_AGENT: kv(), AGENT_ENC_KEY: ENC, AUTH_V2_KEYS: "true" });
async function storeKey(env, at = T0) {
  const mat = await newKeyMaterial();
  const rec = keyRecord({ sealed: await aesGcmEncrypt(mat.secret, ENC), accountId: "0xacc", message: addKeyMessage({ orderlyKey: mat.orderlyKey, now: at }), now: at });
  await env.NEXUS_AGENT.put(V2_KEY(A), JSON.stringify(rec));
  return mat;
}
async function session(account, at = T0) {
  const s = newTradingSession({ address: account.address, now: at });
  return { session: s.session, issued: s.issued, expires: s.expires, sig: await account.signMessage({ message: s.message }) };
}
async function challenge(env, account, { action = "withdraw", amount = null, nonce = "n-" + Math.random().toString(16).slice(2), at = T0 } = {}) {
  const wallet = account.address.toLowerCase();
  const expires = at + 120e3;
  await env.NEXUS_AGENT.put(`auth:nonce:${nonce}`, JSON.stringify({ action, wallet, nonce, amount, expires }));
  return { nonce, v2Sig: await account.signMessage({ message: buildChallenge({ action, wallet, nonce, amount, expires }) }) };
}
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/** Fake Orderly + Bankr. `bankrAs` = who Bankr signs as; `answers` = withdraw_request replies in order. */
function world({ bankrAs = alice, answers = [{ success: true, data: { withdraw_id: 1 } }], freeUsdc = 0 } = {}) {
  const calls = [];
  let nonce = 7;
  const queue = [...answers];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const ok = (b) => ({ status: 200, json: async () => b });
    if (u === `${BANKR_BASE}/wallet/sign`) {
      const b = JSON.parse(init.body);
      if (b.signatureType !== "eth_signTypedData_v4") throw new Error("Bankr was asked for " + b.signatureType);
      return ok({ success: true, signature: await bankrAs.signTypedData(b.typedData) });
    }
    if (u === `${ORDERLY_BASE}/v1/withdraw_nonce`) return ok({ success: true, data: { withdraw_nonce: nonce++ } });
    if (u === `${ORDERLY_BASE}/v1/withdraw_request`) return ok(queue.shift() || { success: true });
    if (u === `${ORDERLY_BASE}/v1/settle_pnl`) return ok({ success: true });
    if (u === `${ORDERLY_BASE}/v1/client/holding`) return ok({ success: true, data: { holding: [{ token: "USDC", holding: freeUsdc }] } });
    throw new Error("unexpected " + u);
  };
  return { calls, fetchImpl };
}
const orderlyCalls = (w) => w.calls.filter((c) => c.url.startsWith(ORDERLY_BASE));
const withdrawCalls = (w) => w.calls.filter((c) => c.url.endsWith("/v1/withdraw_request"));
async function signedByKey(call, orderlyKey) {
  const h = call.init.headers;
  assert.equal(h["orderly-key"], orderlyKey);
  const path = call.url.slice(ORDERLY_BASE.length);
  const msg = new TextEncoder().encode(`${h["orderly-timestamp"]}${call.init.method}${path}${call.init.body || ""}`);
  return ed.verifyAsync(unb64url(h["orderly-signature"]), msg, bs58.decode(orderlyKey.slice("ed25519:".length)));
}
const deps = (w) => ({ fetchImpl: w.fetchImpl, clock: () => T0 + 1000, sleep: async () => {} });

// ── Bankr withdraw ─────────────────────────────────────────────────────────────────────────────

test("Bankr withdraw: signed by the stored key, Bankr signs only the Withdraw, paid to the wallet", async () => {
  const env = envOn();
  const mat = await storeKey(env);
  const signer = await storedKeySigner(env, A, { now: T0 });
  assert.equal(signer.ok, true);
  const w = world();
  const out = await answer(() => bankrWithdrawV2(signer, { bankrApiKey: "bk", amount: 1.76 }, deps(w)));
  assert.equal(out.status, 200);
  assert.deepEqual([out.body.ok, out.body.auth, out.body.amountUnits], [true, "v2", 1_760_000]);
  for (const c of orderlyCalls(w)) assert.ok(await signedByKey(c, mat.orderlyKey), "every Orderly call is signed by the stored key: " + c.url);
  const [wr] = withdrawCalls(w);
  const sent = JSON.parse(wr.init.body);
  assert.equal(sent.message.receiver, A);
  assert.equal(sent.userAddress, A);
  assert.equal(sent.verifyingContract, WITHDRAW_VC);
  assert.equal(sent.message.amount, 1_760_000);
  assert.ok(!JSON.stringify(w.calls).includes("nexus-trading-key-v1"), "never asks for the static trading message");
});

test("Bankr signs as another wallet: refused before anything is sent", async () => {
  const env = envOn();
  await storeKey(env);
  const signer = await storedKeySigner(env, A, { now: T0 });
  const w = world({ bankrAs: mallory });
  const out = await answer(() => bankrWithdrawV2(signer, { bankrApiKey: "bk", amount: 5 }, deps(w)));
  assert.deepEqual([out.status, out.body.error], [401, "signature_mismatch"]);
  assert.equal(withdrawCalls(w).length, 0);
});

test("code 78: settle, then withdraw what's free (less the buffer) with a fresh nonce and signature", async () => {
  const env = envOn();
  await storeKey(env);
  const signer = await storedKeySigner(env, A, { now: T0 });
  const w = world({ answers: [{ success: false, code: 78, message: "margin occupied" }, { success: true }], freeUsdc: 3 });
  const out = await answer(() => bankrWithdrawV2(signer, { bankrApiKey: "bk", amount: 10 }, deps(w)));
  assert.deepEqual([out.body.ok, out.body.autoSettled, out.body.withdrawnAmount], [true, true, 2.5]);
  const [first, second] = withdrawCalls(w).map((c) => JSON.parse(c.init.body));
  assert.equal(second.message.amount, 2_500_000);
  assert.notEqual(second.message.withdrawNonce, first.message.withdrawNonce);
  assert.notEqual(second.signature, first.signature);
  const none = world({ answers: [{ success: false, code: 78 }], freeUsdc: 0.3 });
  const r = await answer(() => bankrWithdrawV2(signer, { bankrApiKey: "bk", amount: 10 }, deps(none)));
  assert.deepEqual([r.status, r.body.error], [400, "insufficient_free_collateral"]);
  assert.equal(withdrawCalls(none).length, 1, "nothing re-sent when nothing is free");
});

test("a bad amount is refused; no key / an expired key answers key_required / key_expired", async () => {
  const env = envOn();
  assert.equal(await hasV2Key(env, A), false);
  assert.equal((await storedKeySigner(env, A, { now: T0 })).body.error, "key_required");
  await storeKey(env, T0);
  assert.equal(await hasV2Key(env, A), true);
  assert.equal((await storedKeySigner(env, A, { now: T0 + 31 * 86400000 })).body.error, "key_expired");
  const signer = await storedKeySigner(env, A, { now: T0 });
  for (const amount of [0, -1, "abc", null]) {
    const w = world();
    assert.equal((await answer(() => bankrWithdrawV2(signer, { bankrApiKey: "bk", amount }, deps(w)))).status, 400);
    assert.equal(w.calls.length, 0);
  }
  assert.equal(usdcUnits("1.76"), 1_760_000);
  assert.equal(usdcUnits(0.0000001), null);
});

// ── prepare / submit with a session ──────────────────────────────────────────────────────────────

async function prepared(env, amount = 4) {
  const signer = await v2Signer(env, { walletAddress: A, session: await session(alice) }, { now: T0 });
  assert.equal(signer.ok, true);
  const w = world();
  const p = await answer(() => withdrawPrepareV2(signer, { amount }, deps(w)));
  assert.equal(p.status, 200);
  return { signer, p: p.body, signature: await alice.signTypedData(p.body.typedData) };
}

test("prepare: the Withdraw typed data to the wallet, and the challenge bound to its units", async () => {
  const env = envOn();
  await storeKey(env);
  const { p } = await prepared(env, 4);
  assert.equal(p.message.receiver, A);
  assert.equal(p.message.amount, 4_000_000);
  assert.deepEqual([p.challenge.action, p.challenge.amount], ["withdraw", "4000000"]);
  assert.equal(p.typedData.domain.verifyingContract, WITHDRAW_VC);
  assert.equal(withdrawRefusal(p.message, A), null);
});

test("submit: needs the challenge for these exact units, once; then relays to Orderly", async () => {
  const env = envOn();
  const mat = await storeKey(env);
  const { signer, p, signature } = await prepared(env, 4);
  const body = (extra) => ({ walletAddress: A, message: p.message, signature, ...extra });

  let w = world();
  let r = await answer(() => withdrawSubmitV2(env, signer, body({}), deps(w)));
  assert.deepEqual([r.status, r.body.error], [401, "challenge_required"]);
  assert.equal(withdrawCalls(w).length, 0);

  const wrongAmount = await challenge(env, alice, { amount: "9000000" });
  r = await answer(() => withdrawSubmitV2(env, signer, body(wrongAmount), deps(w)));
  assert.deepEqual([r.status, r.body.error, r.body.reason], [401, "challenge_failed", "amount mismatch"]);

  const good = await challenge(env, alice, { amount: "4000000" });
  w = world();
  r = await answer(() => withdrawSubmitV2(env, signer, body(good), deps(w)));
  assert.deepEqual([r.status, r.body.ok, r.body.auth], [200, true, "v2"]);
  assert.equal(withdrawCalls(w).length, 1);
  assert.ok(await signedByKey(withdrawCalls(w)[0], mat.orderlyKey));

  r = await answer(() => withdrawSubmitV2(env, signer, body(good), deps(world())));
  assert.deepEqual([r.status, r.body.error], [401, "challenge_unknown_or_expired"], "a challenge works once");
});

test("submit: a redirected receiver, a stranger's signature or a tampered amount never reach Orderly or burn the challenge", async () => {
  const env = envOn();
  await storeKey(env);
  const { signer, p, signature } = await prepared(env, 4);
  const ch = await challenge(env, alice, { amount: "4000000" });
  const cases = [
    [{ ...p.message, receiver: mallory.address.toLowerCase() }, signature, 400, "receiver_mismatch"],
    [p.message, await mallory.signTypedData(p.typedData), 401, "signature_mismatch"],
    [{ ...p.message, amount: 40_000_000 }, signature, 401, "signature_mismatch"],
    [{ ...p.message, token: "WETH" }, signature, 400, "bad_withdraw_message"],
  ];
  for (const [message, sig, status, error] of cases) {
    const w = world();
    const r = await answer(() => withdrawSubmitV2(env, signer, { message, signature: sig, ...ch }, deps(w)));
    assert.deepEqual([r.status, r.body.error], [status, error]);
    assert.equal(withdrawCalls(w).length, 0);
  }
  assert.ok(await env.NEXUS_AGENT.get(`auth:nonce:${ch.nonce}`), "the challenge is still unused");
});

test("withdrawMessage / typed data: the shape Orderly takes, USDC to the wallet", () => {
  const m = withdrawMessage({ wallet: A, units: 1, withdrawNonce: 3, now: T0 });
  assert.deepEqual(Object.keys(m), ["brokerId", "chainId", "receiver", "token", "amount", "withdrawNonce", "timestamp"]);
  assert.equal(withdrawTypedData(m).primaryType, "Withdraw");
  assert.equal(withdrawRefusal({ ...m, chainId: 1 }, A), "wrong_chain");
  assert.equal(withdrawRefusal({ ...m, amount: "1" }, A), "bad_amount");
});

// ── wiring (source checks: index.js is too big to import in a test) ──────────────────────────────

const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const block = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

test("index.js: bankr-withdraw tries v2 first (flag + record) and keeps the v1 branch after it", () => {
  const b = block('parts[1] === "bankr-withdraw" && request.method === "POST"', "/withdraw/prepare + /withdraw/submit");
  const v2 = b.indexOf("bankrWithdrawV2(");
  assert.ok(v2 > 0 && b.indexOf('env.AUTH_V2_KEYS === "true"') < v2 && b.indexOf("hasV2Key(") < v2);
  assert.ok(b.indexOf('message: "nexus-trading-key-v1"') > v2, "v1 personal_sign only after the v2 branch");
});

test("index.js: withdraw/prepare|submit answer a session first, walletSig unchanged after", () => {
  const b = block('parts[0] === "withdraw" && (parts[1] === "prepare"', "/proxy/bankr-register");
  const v2 = b.indexOf("if (wantsV2(body))");
  assert.ok(v2 > 0 && v2 < b.indexOf("const { walletSig, walletAddress } = body;"));
  assert.ok(b.includes("withdrawSubmitV2(env, v2, body)") && b.includes("withdrawPrepareV2(v2, body)"));
});

test("index.js: the v1-registration switch sits in front of /derive-key, /proxy/register-key, bankr-register and the page", () => {
  assert.ok(src.indexOf("v1RegistrationRefusal(parts, request.method, env)") < src.indexOf('parts[0] === "derive-key" && request.method === "POST"'));
  assert.ok(src.indexOf("v1RegistrationRefusal(parts, request.method, env)") < src.indexOf("await handleAccount(parts, request, env)"));
  const reg = block('parts[1] === "bankr-register" && request.method === "POST"', "/proxy/registration-nonce");
  assert.ok(reg.indexOf("v1RegisterOff(env)") < reg.indexOf("let body;"));
  assert.ok(reg.includes('handleKey(["v2", "key", "bankr-register"], request, env)'));
  const page = block('parts[0] === "register-orderly-key" && request.method === "GET"', "</html>`;");
  assert.ok(page.indexOf("registerPageV2Html()") < page.indexOf("const html = `"));
});

// ── the switch itself ────────────────────────────────────────────────────────────────────────────

test("AUTH_V1_REGISTER_OFF: off by default; on, it retires exactly /derive-key and /proxy/register-key", () => {
  assert.equal(v1RegisterOff({}), false);
  assert.equal(v1RegistrationRefusal(["derive-key"], "POST", {}), null);
  const on = { AUTH_V1_REGISTER_OFF: "true" };
  assert.equal(v1RegistrationRefusal(["derive-key"], "POST", on).status, 410);
  assert.equal(v1RegistrationRefusal(["proxy", "register-key"], "POST", on).body.error, "v1_registration_off");
  for (const [parts, m] of [[["proxy", "register-account"], "POST"], [["derive-key", "x"], "POST"], [["derive-key"], "GET"], [["proxy", "bankr-register"], "POST"]]) {
    assert.equal(v1RegistrationRefusal(parts, m, on), null, parts.join("/"));
  }
  assert.equal(bankrRegisterV2Refusal({ AUTH_V2_KEYS: "true" }), null);
  assert.equal(bankrRegisterV2Refusal({}).status, 503, "v1 off + v2 off = nothing could register: say so");
});

test("the v2 register page: session → begin → AddOrderlyKey → challenge → complete; nothing derived", () => {
  const html = registerPageV2Html();
  const order = ["/v2/session/new", "/v2/key/begin", "eth_signTypedData_v4", "action=key.register", "/v2/key/complete"].map((s) => html.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "steps in order");
  for (const gone of ["nexus-trading-key-v1", "/derive-key", "/proxy/register-key"]) assert.ok(!html.includes(gone), gone);
});

test("GET /v2/session/new: an unsigned session that verifies once the wallet signs it", async () => {
  const env = { NEXUS_AGENT: kv() };
  const res = await handleSession(["v2", "session", "new"], new Request(`https://og.test/v2/session/new?wallet=${alice.address}`), env, { now: () => T0 });
  const s = await res.json();
  assert.equal(res.status, 200);
  const auth = { session: s.session, issued: s.issued, expires: s.expires, sig: await alice.signMessage({ message: s.message }) };
  assert.equal((await checkTradingSession(env, A, auth, { now: T0 + 60e3 })).ok, true);
  const strangerSig = { ...auth, sig: await mallory.signMessage({ message: s.message }) };
  assert.equal((await checkTradingSession(env, A, strangerSig, { now: T0 + 60e3 })).ok, false, "minting grants nothing");
  assert.equal((await handleSession(["v2", "session", "new"], new Request("https://og.test/v2/session/new?wallet=nope"), env, {})).status, 400);
  assert.equal((await handleSession(["v2", "session", "new"], new Request("https://og.test/v2/session/new", { method: "POST", body: "{}" }), env, {})).status, 405);
});

test("the revoked wallet's way back stays open: v2 Bankr registration and Bankr withdraw pass the gate", () => {
  const revoked = revokedWallets({ REVOKED_TRADING_WALLETS: A });
  const gate = (parts, body) => revokedTradingRefusal({ method: "POST", parts, body, revoked, recover: recoverEthAddress });
  assert.equal(gate(["v2", "key", "bankr-register"], { walletAddress: A, bankrApiKey: "bk" }), null);
  assert.equal(gate(["proxy", "bankr-withdraw"], { walletAddress: A, bankrApiKey: "bk", amount: 1.76 }), null);
  assert.equal(gate(["proxy", "bankr-register"], { walletAddress: A, bankrApiKey: "bk" }).status, 403, "the v1 Bankr registration stays shut");
});
