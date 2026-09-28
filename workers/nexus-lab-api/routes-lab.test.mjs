// Run: node --test workers/nexus-lab-api/routes-lab.test.mjs
// Lab records end to end with REAL signatures: an EVM wallet (secp256k1 via viem) and a Solana
// wallet (ed25519). The rule under test: only the wallet can change or fully read its record, and a
// refused request has NO side effects (no write, no copy count, no notification, no autocopy stamp).
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import bs58 from "bs58";
import { handleLab, handleProfile } from "./routes-lab.mjs";
import { labSaveMessage, signLabAuth, LAB_AUTH_MAX_AGE_MS } from "../../app/lib/labAuth.mjs";

const T0 = 1_790_000_000_000;
const now = () => T0 + 60_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const solSk = new Uint8Array(32).fill(7);
const SOL = bs58.encode(ed25519.getPublicKey(solSk)); // as the wallet reports it (mixed case)

const evmAuth = async (account, ts = T0) => ({ ts, sig: await account.signMessage({ message: labSaveMessage(account.address, ts) }) });
const solAuth = (signer = SOL, sk = solSk, ts = T0) => ({ ts, signer, sig: "0x" + bytesToHex(ed25519.sign(utf8ToBytes(labSaveMessage(signer, ts)), sk)) });

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [];
  return {
    m, puts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { puts.push(k); m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const envWith = (lab = {}) => ({ LAB_STORE: kv(lab), NEXUS_AGENT: kv() });
const req = (method, path, body) => new Request(`https://og.test${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const parts = (path) => path.split("/").filter(Boolean);
const lab = (env, method, path, body) => handleLab(parts(path), req(method, path, body), env, { now });
const profile = (env, method, path, body) => handleProfile(parts(path), req(method, path, body), env, { now });
const stored = (env, key) => JSON.parse(env.LAB_STORE.m.get(key) || "null");

const record = {
  theses: [
    { id: "pub", symbol: "BTC", direction: "LONG", isPublic: true, createdAt: T0 },
    { id: "priv", symbol: "ETH", direction: "SHORT", isPublic: false, createdAt: T0 },
    { id: "hold", symbol: "SOL", direction: "LONG", isPublic: true, holdersOnly: true, createdAt: T0 },
  ],
  notes: { "2026-09-27": "journal" },
};

test("PUT without a signature: 401, and nothing happens", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const before = env.LAB_STORE.m.get(`lab:${A}`);
  const res = await lab(env, "PUT", `/lab/${A}`, { theses: [{ id: "x", symbol: "BTC", direction: "SHORT", isPublic: true, createdAt: T0 }], notes: {} });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "sign_to_save");
  assert.equal(env.LAB_STORE.m.get(`lab:${A}`), before, "record untouched");
  assert.deepEqual(env.LAB_STORE.puts, [], "no write of any kind (no notifications either)");
  assert.deepEqual(env.NEXUS_AGENT.puts, [], "no autocopy stamp");
});

test("PUT signed by a different wallet: 401, record untouched", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const res = await lab(env, "PUT", `/lab/${A}`, { theses: [], notes: {}, labAuth: await evmAuth(mallory) });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, "wrong_signer");
  assert.deepEqual(stored(env, `lab:${A}`), record);
});

test("PUT with the owner's signature saves, and the signature is not stored", async () => {
  const env = envWith();
  const next = { theses: [{ id: "n", symbol: "BTC", direction: "LONG", isPublic: false, createdAt: T0 }], notes: { d: "x" } };
  const res = await lab(env, "PUT", `/lab/${A}`, { ...next, labAuth: await evmAuth(alice) });
  assert.equal(res.status, 200);
  assert.deepEqual(stored(env, `lab:${A}`), next, "exactly the record; no labAuth");
});

test("a day-old signature expires", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const res = await handleLab(parts(`/lab/${A}`), req("PUT", `/lab/${A}`, { theses: [], notes: {}, labAuth: await evmAuth(alice) }), env, { now: () => T0 + LAB_AUTH_MAX_AGE_MS + 1 });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, "expired");
  assert.deepEqual(stored(env, `lab:${A}`), record);
});

test("GET is the public view: public calls only, holders-only and notes stay out", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const body = await (await lab(env, "GET", `/lab/${A}`)).json();
  assert.deepEqual(body.theses.map((t) => t.id), ["pub"]);
  assert.deepEqual(body.notes, {});
});

test("POST /read returns the full record to the owner only", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const refused = await lab(env, "POST", `/lab/${A}/read`, {});
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error, "sign_to_read");
  assert.equal((await lab(env, "POST", `/lab/${A}/read`, { labAuth: await evmAuth(mallory) })).status, 401);
  const ok = await lab(env, "POST", `/lab/${A}/read`, { labAuth: await evmAuth(alice) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), record);
  const empty = await lab(envWith(), "POST", `/lab/${A}/read`, { labAuth: await evmAuth(alice) });
  assert.deepEqual(await empty.json(), { theses: [], notes: {} });
});

test("DELETE needs the owner's signature", async () => {
  const env = envWith({ [`lab:${A}`]: record });
  const noBody = await lab(env, "DELETE", `/lab/${A}/thesis/priv`);
  assert.equal(noBody.status, 401);
  assert.equal((await lab(env, "DELETE", `/lab/${A}/thesis/priv`, { labAuth: await evmAuth(mallory) })).status, 401);
  assert.equal(stored(env, `lab:${A}`).theses.length, 3, "still there");
  const ok = await lab(env, "DELETE", `/lab/${A}/thesis/priv`, { labAuth: await evmAuth(alice) });
  assert.equal(ok.status, 200);
  assert.deepEqual(stored(env, `lab:${A}`).theses.map((t) => t.id), ["pub", "hold"]);
});

test("profile: GET stays public; PUT needs the owner's signature", async () => {
  const env = envWith({ [`profile:${A}`]: { pfp: null, displayName: "alice" } });
  const refused = await profile(env, "PUT", `/profile/${A}`, { displayName: "not alice" });
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error, "sign_to_save");
  assert.equal((await profile(env, "PUT", `/profile/${A}`, { displayName: "not alice", labAuth: await evmAuth(mallory) })).status, 401);
  assert.equal(stored(env, `profile:${A}`).displayName, "alice");
  const ok = await profile(env, "PUT", `/profile/${A}`, { displayName: "Alice ◆", labAuth: await evmAuth(alice) });
  assert.equal(ok.status, 200);
  assert.deepEqual(stored(env, `profile:${A}`), { pfp: null, displayName: "Alice ◆" }, "only the two profile fields are stored");
  assert.equal((await (await profile(env, "GET", `/profile/${A}`)).json()).displayName, "Alice ◆");
});

test("Solana: the record is keyed by the lowercased address; the signer keeps its case", async () => {
  const key = `lab:${SOL.toLowerCase()}`;
  const env = envWith({ [key]: record });
  const path = `/lab/${SOL.toLowerCase()}`;
  assert.equal((await lab(env, "PUT", path, { theses: [], notes: {} })).status, 401);
  // Lowercasing the signer breaks the key (base58 is case-sensitive) → can't verify → refused.
  assert.equal((await lab(env, "PUT", path, { theses: [], notes: {}, labAuth: { ...solAuth(), signer: SOL.toLowerCase() } })).status, 401);
  // Another Solana key's valid signature doesn't own this record.
  const otherSk = new Uint8Array(32).fill(9);
  const OTHER = bs58.encode(ed25519.getPublicKey(otherSk));
  assert.equal((await lab(env, "PUT", path, { theses: [], notes: {}, labAuth: solAuth(OTHER, otherSk) })).status, 401);
  // The same key signing a different timestamp than it claims → refused.
  assert.equal((await lab(env, "PUT", path, { theses: [], notes: {}, labAuth: { ...solAuth(), ts: T0 + 1 } })).status, 401);
  assert.deepEqual(stored(env, key), record);
  const ok = await lab(env, "PUT", path, { theses: [{ id: "s", isPublic: true, symbol: "SOL", direction: "LONG", createdAt: T0 }], notes: {}, labAuth: solAuth() });
  assert.equal(ok.status, 200);
  // The record's public calls are permanent (callLock.mjs): a save that leaves them out gets them back.
  assert.deepEqual(stored(env, key).theses.map((t) => t.id), ["s", "pub", "hold"]);
  // The full read works for the Solana owner too.
  assert.equal((await lab(env, "POST", `${path}/read`, { labAuth: solAuth() })).status, 200);
});

test("copy bookkeeping still works for a signed save, and can't be triggered unsigned", async () => {
  const B = "0x" + "cd".repeat(20);
  const env = envWith({ [`lab:${B}`]: { theses: [{ id: "orig", symbol: "BTC", direction: "LONG", isPublic: true }], notes: {} } });
  const copy = { theses: [{ id: "c1", symbol: "BTC", direction: "LONG", isPublic: false }], notes: {}, copiedFromWallet: B, copiedThesisId: "orig", copiedThesisSymbol: "PERP_BTC_USDC", copiedThesisDirection: "LONG" };
  await lab(env, "PUT", `/lab/${A}`, copy);
  assert.equal(stored(env, `lab:${B}`).theses[0].copyCount, undefined, "unsigned: no copy count");
  assert.equal(env.LAB_STORE.m.get(`notif:${B}`), undefined, "unsigned: no notification");
  const res = await lab(env, "PUT", `/lab/${A}`, { ...copy, labAuth: await evmAuth(alice) });
  assert.equal(res.status, 200);
  assert.equal(stored(env, `lab:${B}`).theses[0].copyCount, 1);
  assert.equal(JSON.parse(env.LAB_STORE.m.get(`notif:${B}`))[0].type, "copy");
  const saved = stored(env, `lab:${A}`);
  for (const k of ["labAuth", "copiedFromWallet", "copiedThesisId", "copiedThesisSymbol", "copiedThesisDirection"]) assert.ok(!(k in saved), `${k} not stored`);
});

test("a newly public call stamps the autocopy key only when the owner signed", async () => {
  const env = envWith();
  const pub = { theses: [{ id: "p1", symbol: "BTC", direction: "LONG", isPublic: true, createdAt: T0 }], notes: {} };
  await lab(env, "PUT", `/lab/${A}`, pub);
  assert.equal(env.NEXUS_AGENT.m.get(`caller:latest:${A}`), undefined);
  await lab(env, "PUT", `/lab/${A}`, { ...pub, labAuth: await evmAuth(alice) });
  assert.equal(JSON.parse(env.NEXUS_AGENT.m.get(`caller:latest:${A}`)).id, "p1");
});

// ── The wire: the BROWSER signer (app/lib/labAuth.mjs signLabAuth) against the worker's check ──

// An EIP-1193 provider that behaves like MetaMask: personal_sign signs the RAW bytes given as hex.
const evmProvider = (account, accounts = [account.address]) => ({
  async request({ method, params }) {
    if (method === "eth_accounts") return accounts;
    if (method === "personal_sign") return account.signMessage({ message: { raw: params[0] } });
    throw new Error(`unexpected ${method}`);
  },
});
// A Solana provider (Orderly's SolanaWalletProvider shape): signMessage(Uint8Array) → Uint8Array.
const solProvider = (sk, shape = "bytes") => ({
  async signMessage(bytes) { const sig = ed25519.sign(bytes, sk); return shape === "bytes" ? sig : { signature: sig }; },
});

test("wire, EVM: what the browser signs is what the worker verifies", async () => {
  const env = envWith();
  const auth = await signLabAuth(A, { provider: evmProvider(alice), address: alice.address }, { now: T0 });
  const res = await lab(env, "PUT", `/lab/${A}`, { theses: [], notes: { d: "ok" }, labAuth: auth });
  assert.equal(res.status, 200);
  assert.equal(stored(env, `lab:${A}`).notes.d, "ok");
});

test("wire, EVM: a wallet switched to another account refuses before signing", async () => {
  await assert.rejects(signLabAuth(A, { provider: evmProvider(mallory), address: mallory.address }, { now: T0 }), /Switch your wallet/);
  await assert.rejects(signLabAuth(A, { provider: null }, { now: T0 }), /Connect your wallet/);
});

test("wire, Solana: bytes or {signature} both verify; the record key stays lowercase", async () => {
  for (const shape of ["bytes", "object"]) {
    const env = envWith();
    const auth = await signLabAuth(SOL.toLowerCase(), { provider: solProvider(solSk, shape), address: SOL }, { now: T0 });
    assert.equal(auth.signer, SOL, "signed with the real (mixed-case) key");
    const res = await lab(env, "PUT", `/lab/${SOL.toLowerCase()}`, { theses: [], notes: { s: shape }, labAuth: auth });
    assert.equal(res.status, 200, shape);
    assert.equal(stored(env, `lab:${SOL.toLowerCase()}`).notes.s, shape);
  }
  // The connector reports no address, but the Lab knows the mixed-case one → still signs.
  const auth = await signLabAuth(SOL.toLowerCase(), { provider: solProvider(solSk) }, { fallbackSigner: SOL, now: T0 });
  assert.equal((await lab(envWith(), "PUT", `/lab/${SOL.toLowerCase()}`, { theses: [], notes: {}, labAuth: auth })).status, 200);
  await assert.rejects(signLabAuth(SOL.toLowerCase(), { provider: solProvider(solSk) }, { now: T0 }), /Switch your wallet/);
});

// ── Published calls are permanent (callLock.mjs), end to end through the real route ──────────
const draft = (over = {}) => ({ id: "c1", symbol: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: T0 - 7 * 86400e3, status: "ACTIVE", ...over });

test("publishing stamps the server's time, registers the call, and answers with what was kept", async () => {
  const env = envWith();
  const res = await lab(env, "PUT", `/lab/${A}`, { theses: [draft({ isPublic: true })], notes: {}, labAuth: await evmAuth(alice) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.published.length, 1);
  assert.equal(body.published[0].createdAt, now(), "posted now, not the week-old time the client sent");
  const t = stored(env, `lab:${A}`).theses[0];
  assert.equal(t.createdAt, now());
  assert.ok(stored(env, `callreg:${A}`).calls.c1, "registered");
  assert.equal(env.LAB_STORE.m.get("callowner:c1"), A, "owner index");
});

test("after publishing: moved levels, a self-written WIN, hiding and deleting all bounce off", async () => {
  const env = envWith();
  await lab(env, "PUT", `/lab/${A}`, { theses: [draft({ isPublic: true })], notes: {}, labAuth: await evmAuth(alice) });
  const kept = stored(env, `lab:${A}`).theses[0];
  const tamper = { ...kept, stopLoss: 50, takeProfit1: 101, gradedOutcome: "WIN", gradedR: 9, status: "HIT_TP", isPublic: false };
  assert.equal((await lab(env, "PUT", `/lab/${A}`, { theses: [tamper], notes: {}, labAuth: await evmAuth(alice) })).status, 200);
  let t = stored(env, `lab:${A}`).theses[0];
  assert.deepEqual([t.stopLoss, t.takeProfit1, t.gradedOutcome, t.status, t.isPublic], [95, 110, undefined, "ACTIVE", true]);
  // Left out of the save: back.
  await lab(env, "PUT", `/lab/${A}`, { theses: [], notes: {}, labAuth: await evmAuth(alice) });
  assert.deepEqual(stored(env, `lab:${A}`).theses.map((x) => x.id), ["c1"]);
  // The delete route refuses it.
  const del = await lab(env, "DELETE", `/lab/${A}/thesis/c1`, { labAuth: await evmAuth(alice) });
  assert.equal(del.status, 409);
  assert.equal((await del.json()).error, "published_permanent");
  t = stored(env, `lab:${A}`).theses[0];
  assert.equal(t.id, "c1");
});

test("a private call can still be deleted; a legacy public one can't, from the very first delete", async () => {
  const env = envWith({ [`lab:${A}`]: record });            // stored before the lock existed: no registry
  assert.equal((await lab(env, "DELETE", `/lab/${A}/thesis/priv`, { labAuth: await evmAuth(alice) })).status, 200);
  assert.equal((await lab(env, "DELETE", `/lab/${A}/thesis/pub`, { labAuth: await evmAuth(alice) })).status, 409);
  assert.deepEqual(stored(env, `lab:${A}`).theses.map((t) => t.id), ["pub", "hold"]);
  assert.ok(stored(env, `callreg:${A}`).calls.pub.legacy, "bootstrapped as legacy");
});

test("a call another wallet published can't be published again from a second wallet", async () => {
  const env = envWith();
  await lab(env, "PUT", `/lab/${A}`, { theses: [draft({ isPublic: true })], notes: {}, labAuth: await evmAuth(alice) });
  const M = mallory.address.toLowerCase();
  const res = await lab(env, "PUT", `/lab/${M}`, { theses: [draft({ isPublic: true })], notes: {}, labAuth: await evmAuth(mallory) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.refused.map((r) => r.id), ["c1"]);
  assert.equal(stored(env, `lab:${M}`).theses[0].isPublic, false, "kept private in the second wallet");
  assert.equal(env.LAB_STORE.m.get("callowner:c1"), A);
});

test("a refused (unsigned) save registers nothing", async () => {
  const env = envWith();
  assert.equal((await lab(env, "PUT", `/lab/${A}`, { theses: [draft({ isPublic: true })], notes: {} })).status, 401);
  assert.equal(env.LAB_STORE.m.has(`callreg:${A}`), false);
  assert.equal(env.LAB_STORE.m.has("callowner:c1"), false);
});
