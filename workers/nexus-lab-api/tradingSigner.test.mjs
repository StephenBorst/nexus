// Auth v2 step 3a: the trading routes' v2 path (tradingSigner.mjs) with a REAL session signature and a
// real stored key, plus source checks that each route kept its v1 branch and gained the v2 one.
// Run: node --test workers/nexus-lab-api/tradingSigner.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { v2Signer, wantsV2 } from "./tradingSigner.mjs";
import { newKeyMaterial, addKeyMessage, keyRecord, V2_KEY } from "./v2Keys.mjs";
import { aesGcmEncrypt } from "./seedVault.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";
import { SESSIONS_AFTER_KEY } from "./routes-session.mjs";
import { revokedTradingRefusal } from "./revokedTrading.mjs";
import { recoverEthAddress } from "./shared.mjs";

const T0 = 1_790_000_000_000;
const DAY = 86400000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const ENC = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

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
  return mat;
}
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

test("wantsV2: only a body carrying a session", () => {
  assert.equal(wantsV2({ session: { session: "x" } }), true);
  for (const b of [null, undefined, {}, { walletSig: "0x1" }, { session: null }, "session"]) assert.equal(wantsV2(b), false);
});

test("off unless AUTH_V2_KEYS is \"true\": a session gets v2_keys_off and the caller keeps walletSig", async () => {
  const env = { ...envOn(), AUTH_V2_KEYS: undefined };
  const r = await v2Signer(env, { walletAddress: A, session: await session(alice) }, { now: T0 });
  assert.deepEqual([r.ok, r.status, r.body.error], [false, 400, "v2_keys_off"]);
});

test("refusals: bad wallet, both kinds of auth, another wallet's session, an ended session", async () => {
  const env = envOn();
  await storeKey(env);
  const sess = await session(alice);
  assert.equal((await v2Signer(env, { walletAddress: "nope", session: sess }, { now: T0 })).status, 400);
  assert.equal((await v2Signer(env, { walletAddress: A, session: sess, walletSig: "0xab" }, { now: T0 })).body.error, "pick_one_auth");
  assert.equal((await v2Signer(env, { walletAddress: A, session: await session(mallory) }, { now: T0 })).status, 401);
  assert.equal((await v2Signer(env, { walletAddress: A, session: sess }, { now: T0 + 25 * 3600000 })).status, 401, "expired session");
  await env.NEXUS_AGENT.put(SESSIONS_AFTER_KEY(A), String(T0 + 1));
  assert.equal((await v2Signer(env, { walletAddress: A, session: sess }, { now: T0 + 10 })).body.reason, "ended", "end-all kills it");
});

test("no key → key_required; an expired key → key_expired (409, with the step to take)", async () => {
  const env = envOn();
  const sess = await session(alice);
  const none = await v2Signer(env, { walletAddress: A, session: sess }, { now: T0 });
  assert.deepEqual([none.status, none.body.error], [409, "key_required"]);
  assert.match(none.body.hint, /\/v2\/key\/begin/);
  await storeKey(env, T0 - 31 * DAY);
  const old = await v2Signer(env, { walletAddress: A, session: sess }, { now: T0 });
  assert.deepEqual([old.status, old.body.error], [409, "key_expired"]);
});

test("the route's own signing call, on the key v2Signer returns, makes a signature that verifies against the stored orderlyKey", async () => {
  const env = envOn();
  const mat = await storeKey(env);
  const r = await v2Signer(env, { wallet: A, session: await session(alice) }, { now: T0 + DAY });
  assert.equal(r.ok, true);
  assert.equal(r.orderlyKey, mat.orderlyKey);
  assert.equal(r.accountId, "0xacc");
  assert.equal(r.keyExpiresInDays, 29);
  // exactly what the routes do: crypto.subtle.sign("Ed25519", key, ts+method+path+body), base64url
  const msg = new TextEncoder().encode(`${T0}GET/v1/positions`);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", r.signingKey, msg));
  const b64 = btoa(String.fromCharCode(...sig)).replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/=+$/, "");
  assert.equal(await ed.verifyAsync(unb64url(b64), msg, bs58.decode(mat.orderlyKey.slice(8))), true);
  await assert.rejects(crypto.subtle.exportKey("pkcs8", r.signingKey), "the key can't be read back out");
});

test("a revoked wallet's session request passes the revoke gate (it carries no walletSig): v2 is its way back", () => {
  const out = revokedTradingRefusal({ method: "POST", parts: ["trade"], body: { walletAddress: A, session: {} }, revoked: new Set([A]), recover: recoverEthAddress });
  assert.equal(out, null);
});

// ── the routes ──────────────────────────────────────────────────────────────────────────────────
const SRC = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const routeBody = (marker) => {
  const a = SRC.indexOf(marker);
  assert.ok(a > 0, `route ${marker} not found`);
  const next = SRC.slice(a + marker.length).search(/\n {4}if \(\(?parts\[0\] === "/);
  return SRC.slice(a, a + marker.length + next);
};
const ROUTES = [
  'parts[0] === "trade" && request.method === "POST"',
  'parts[0] === "set-sl-tp" && request.method === "POST"',
  'parts[0] === "close-position" && request.method === "POST"',
  'parts[0] === "order-history" && request.method === "POST"',
  'parts[0] === "cancel" && request.method === "POST"',
  'parts[0] === "order-status" && request.method === "POST"',
  'parts[0] === "positions" || parts[0] === "balance"',
  'parts[0] === "set-leverage" && request.method === "POST"',
  'parts[0] === "settle-pnl" && request.method === "POST"',
];

test("each trading route asks v2Signer first and still has its v1 derivation in the other branch", () => {
  for (const r of ROUTES) {
    const body = routeBody(r);
    const v2 = body.indexOf("v2Signer(env,");
    const v1 = body.indexOf('crypto.subtle.digest("SHA-256"');
    assert.ok(v2 > 0, `${r}: no v2 branch`);
    assert.ok(v1 > v2, `${r}: the v1 derivation must stay, after the v2 branch`);
    assert.match(body.slice(0, v2), /wantsV2\(/, `${r}: v2 only when the body carries a session`);
  }
});

test("/trade no longer asks for a per-trade challenge (borst, 2026-10-31)", () => {
  assert.doesNotMatch(routeBody(ROUTES[0]), /requireOwnerV2/);
});

test("a session in the URL is refused like a walletSig", () => {
  assert.match(routeBody(ROUTES[6]), /qp\.has\("session"\)/);
});
