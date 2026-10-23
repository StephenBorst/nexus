// Run: node --test workers/nexus-lab-api/socialAuth.test.mjs
// Comments, reactions, takes, follows and the notification list, end to end through the REAL
// routes (routes-feed.mjs, routes-social.mjs) with REAL signatures. The rule: nothing is written
// as a wallet without that wallet's Lab signature, a refused request has NO side effects (no write,
// no notification), and a notification names the author the server found in storage, never one the
// request typed.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import bs58 from "bs58";
import { handleFeed } from "./routes-feed.mjs";
import { handleSocial } from "./routes-social.mjs";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";

const T0 = 1_792_000_000_000;
const now = () => T0 + 60_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const bob = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const B = bob.address.toLowerCase();
const solSk = new Uint8Array(32).fill(9);
const SOL = bs58.encode(ed25519.getPublicKey(solSk));

const auth = async (account, ts = T0) => ({ ts, sig: await account.signMessage({ message: labSaveMessage(account.address, ts) }) });
const solAuth = () => ({ ts: T0, signer: SOL, sig: "0x" + bytesToHex(ed25519.sign(utf8ToBytes(labSaveMessage(SOL, T0)), solSk)) });

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
// Bob's record: one public call, one private, one copy of someone else's.
const bobLab = { theses: [
  { id: "pub1", symbol: "PERP_BTC_USDC", direction: "LONG", isPublic: true, createdAt: T0 },
  { id: "priv1", symbol: "ETH", direction: "SHORT", isPublic: false, createdAt: T0 },
  { id: "dup1", symbol: "SOL", direction: "LONG", isPublic: true, duplicateOf: "0xfc8c", createdAt: T0 },
], notes: {} };
const bobTake = { id: "t_1", wallet: B, direction: "BEAR", text: "fading this", sym: "PEPE", createdAt: T0 };
const envWith = (extra = {}) => ({
  LAB_STORE: kv({ [`lab:${B}`]: bobLab, "takes:base:0xpepe": [bobTake], ...extra }),
  NEXUS_AGENT: kv(),
});
const req = (method, path, body) => new Request(`https://og.test${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const parts = (path) => path.split("/").filter(Boolean);
const feed = async (env, method, path, body) => {
  const res = await handleFeed(parts(path), req(method, path, body), env, { now });
  return { status: res.status, body: await res.json() };
};
const social = async (env, method, path, body) => {
  const res = await handleSocial(parts(path), req(method, path, body), env, { now });
  return { status: res.status, body: await res.json() };
};
const stored = (env, k) => JSON.parse(env.LAB_STORE.m.get(k) || "null");
const notifs = (env, w) => stored(env, `notif:${w}`) || [];

// ── Comments ──────────────────────────────────────────────────────────────────────────────

test("comment without a signature: 401, nothing written, nobody notified", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/pub1", { wallet: A, text: "gm", authorWallet: B });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "sign_to_save");
  assert.equal(r.body.reason, "missing");
  assert.equal(env.LAB_STORE.m.has("comments:pub1"), false);
  assert.deepEqual(notifs(env, B), []);
});

test("comment as someone else's wallet (signed by Bob, claims Alice): 401 wrong_signer", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/pub1", { wallet: A, text: "gm", labAuth: await auth(bob) });
  assert.equal(r.status, 401);
  assert.equal(r.body.reason, "wrong_signer");
  assert.equal(env.LAB_STORE.m.has("comments:pub1"), false);
});

test("an expired signature is refused", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/pub1", { wallet: A, text: "gm", labAuth: await auth(alice, T0 - 25 * 3600e3) });
  assert.equal(r.status, 401);
  assert.equal(r.body.reason, "expired");
});

test("signed comment: stored under the signer, author notified with the STORED market and side", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/pub1", {
    wallet: alice.address, text: "nice level", authorWallet: B, symbol: "PERP_DOGE_USDC", direction: "SHORT", labAuth: await auth(alice),
  });
  assert.equal(r.status, 200);
  assert.equal(stored(env, "comments:pub1")[0].wallet, A);
  const n = notifs(env, B);
  assert.equal(n.length, 1);
  assert.equal(n[0].message, "New comment on your BTC LONG call"); // not the DOGE SHORT the request typed
  assert.equal(n[0].fromWallet, A);
});

test("a notification can't be aimed at a wallet that doesn't own the call", async () => {
  for (const [id, author, why] of [
    ["pub1", A, "Alice holds no such call"],
    ["priv1", B, "a private call"],
    ["dup1", B, "a copy of someone else's call"],
    ["nope", B, "no such id"],
  ]) {
    const env = envWith();
    const r = await feed(env, "POST", `/comments/${id}`, { wallet: alice.address, text: "x", authorWallet: author, labAuth: await auth(alice) });
    assert.equal(r.status, 200, why); // the comment itself is fine
    assert.deepEqual(notifs(env, author), [], why);
    assert.deepEqual(notifs(env, B), [], why);
  }
});

test("a take's author is read from the take list, not the request", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/t_1", {
    wallet: alice.address, text: "bold", authorWallet: A, take: { chain: "base", ca: "0xpepe" }, labAuth: await auth(alice),
  });
  assert.equal(r.status, 200);
  assert.equal(notifs(env, B)[0].message, "New comment on your PEPE BEAR take");
  assert.deepEqual(notifs(env, A), []);
  // Wrong token for the id → no author → no notification.
  const env2 = envWith({ "takes:base:0xother": [] });
  await feed(env2, "POST", "/comments/t_1", { wallet: alice.address, text: "x", take: { chain: "base", ca: "0xother" }, labAuth: await auth(alice) });
  assert.deepEqual(notifs(env2, B), []);
});

test("commenting on your own call notifies nobody", async () => {
  const env = envWith();
  await feed(env, "POST", "/comments/pub1", { wallet: bob.address, text: "my call", authorWallet: B, labAuth: await auth(bob) });
  assert.deepEqual(notifs(env, B), []);
});

test("a Solana wallet comments with its ed25519 Lab signature", async () => {
  const env = envWith();
  const r = await feed(env, "POST", "/comments/pub1", { wallet: SOL, text: "gm from solana", labAuth: solAuth() });
  assert.equal(r.status, 200);
  assert.equal(stored(env, "comments:pub1")[0].wallet, SOL.toLowerCase());
});

test("deleting a comment: unsigned 401; signed by someone else 403; by its author ok", async () => {
  const env = envWith({ "comments:pub1": [{ id: "c1", wallet: A, text: "x", createdAt: T0 }] });
  assert.equal((await feed(env, "DELETE", "/comments/pub1/c1", { wallet: A })).status, 401);
  assert.equal((await feed(env, "DELETE", "/comments/pub1/c1", { wallet: B, labAuth: await auth(bob) })).status, 403);
  assert.equal(stored(env, "comments:pub1").length, 1);
  assert.equal((await feed(env, "DELETE", "/comments/pub1/c1", { wallet: A, labAuth: await auth(alice) })).status, 200);
  assert.equal(stored(env, "comments:pub1").length, 0);
});

// ── Reactions ─────────────────────────────────────────────────────────────────────────────

test("reaction without a signature: 401, nothing written, nobody notified", async () => {
  const env = envWith();
  const r = await feed(env, "PUT", `/reactions/pub1/${encodeURIComponent("🔥")}`, { wallet: A, authorWallet: B });
  assert.equal(r.status, 401);
  assert.equal(env.LAB_STORE.m.has("reactions:pub1"), false);
  assert.deepEqual(notifs(env, B), []);
});

test("signed reaction toggles under the signer; only the add notifies, with the stored call", async () => {
  const env = envWith();
  const path = `/reactions/pub1/${encodeURIComponent("🔥")}`;
  assert.equal((await feed(env, "PUT", path, { wallet: A, authorWallet: B, symbol: "FAKE", labAuth: await auth(alice) })).status, 200);
  assert.deepEqual(stored(env, "reactions:pub1")["🔥"], [A]);
  assert.equal(notifs(env, B)[0].message, "🔥 reacted to your BTC LONG call");
  await feed(env, "PUT", path, { wallet: A, authorWallet: B, labAuth: await auth(alice) }); // remove
  assert.deepEqual(stored(env, "reactions:pub1")["🔥"], []);
  assert.equal(notifs(env, B).length, 1);
});

test("the batched counts read stays unsigned (it only reads public reaction lists)", async () => {
  const env = envWith({ "reactions:pub1": { "🔥": [A] } });
  const r = await feed(env, "POST", "/comments/counts", { ids: ["pub1"], wallet: A });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.counts.pub1.you, ["🔥"]);
});

// ── Takes ─────────────────────────────────────────────────────────────────────────────────

test("take: unsigned 401 and nothing written; signed → stored under the signer; delete needs the owner", async () => {
  const env = envWith();
  const body = { wallet: A, direction: "BULL", text: "sending it", sym: "PEPE" };
  const r0 = await feed(env, "POST", "/takes/base/0xpepe", body);
  assert.equal(r0.status, 401);
  assert.equal(stored(env, "takes:base:0xpepe").length, 1);
  const r1 = await feed(env, "POST", "/takes/base/0xpepe", { ...body, labAuth: await auth(alice) });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.take.wallet, A);
  const id = r1.body.take.id;
  assert.equal((await feed(env, "DELETE", `/takes/base/0xpepe/${id}`, { wallet: A })).status, 401);
  assert.equal((await feed(env, "DELETE", `/takes/base/0xpepe/${id}`, { wallet: B, labAuth: await auth(bob) })).status, 403);
  assert.equal((await feed(env, "DELETE", `/takes/base/0xpepe/${id}`, { wallet: A, labAuth: await auth(alice) })).status, 200);
  assert.deepEqual(stored(env, "takes:base:0xpepe").map((t) => t.id), ["t_1"]);
});

// ── Notifications ─────────────────────────────────────────────────────────────────────────

const list = [{ id: "n1", type: "copy", message: "x", createdAt: T0 }, { id: "n2", type: "follow", message: "y", createdAt: T0 }];

test("notifications are private: GET returns nothing, POST needs the owner's signature", async () => {
  const env = envWith({ [`notif:${A}`]: list });
  const get = await social(env, "GET", `/notifications/${A}`);
  assert.equal(get.status, 401);
  assert.equal(get.body.error, "sign_to_read");
  assert.ok(!Array.isArray(get.body), "a GET never returns the list");
  // unsigned, or the old "create" shape: refused, nothing read or written
  for (const body of [undefined, {}, { type: "x", message: "spam" }]) {
    const r = await social(env, "POST", `/notifications/${A}`, body);
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "sign_to_read");
  }
  // someone else's signature
  assert.equal((await social(env, "POST", `/notifications/${A}`, { labAuth: await auth(bob) })).status, 401);
  // an expired one
  assert.equal((await social(env, "POST", `/notifications/${A}`, { labAuth: await auth(alice, T0 - 25 * 3600_000) })).status, 401);
  // the owner
  const ok = await social(env, "POST", `/notifications/${A}`, { labAuth: await auth(alice) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.map((n) => n.id), ["n1", "n2"]);
  // a wallet with nothing stored reads an empty list, signed
  assert.deepEqual((await social(env, "POST", `/notifications/${B}`, { labAuth: await auth(bob) })).body, []);
  assert.equal(env.LAB_STORE.puts.length, 0, "a read writes nothing");
});

test("notifications: a Solana owner reads its own list with an ed25519 signature", async () => {
  const key = `notif:${SOL.toLowerCase()}`;
  const env = envWith({ [key]: list });
  assert.equal((await social(env, "POST", `/notifications/${SOL}`, { labAuth: solAuth() })).status, 200);
  assert.equal((await social(env, "POST", `/notifications/${SOL}`, {})).status, 401);
});

test("mark read: unsigned 401, someone else's signature 401, owner ok", async () => {
  const env = envWith({ [`notif:${A}`]: list });
  const before = env.LAB_STORE.m.get(`notif:${A}`);
  assert.equal((await social(env, "PUT", `/notifications/${A}/read`)).status, 401);
  assert.equal((await social(env, "PUT", `/notifications/${A}/read`, { labAuth: await auth(bob) })).status, 401);
  assert.equal(env.LAB_STORE.m.get(`notif:${A}`), before);
  assert.equal((await social(env, "PUT", `/notifications/${A}/read`, { labAuth: await auth(alice) })).status, 200);
  assert.ok(notifs(env, A).every((n) => n.readAt));
});

test("delete a notification: unsigned 401 and nothing removed; owner ok", async () => {
  const env = envWith({ [`notif:${A}`]: list });
  assert.equal((await social(env, "DELETE", `/notifications/${A}/n1`)).status, 401);
  assert.equal((await social(env, "DELETE", `/notifications/${A}/n1`, { labAuth: await auth(bob) })).status, 401);
  assert.equal(notifs(env, A).length, 2);
  assert.equal((await social(env, "DELETE", `/notifications/${A}/n1`, { labAuth: await auth(alice) })).status, 200);
  assert.deepEqual(notifs(env, A).map((n) => n.id), ["n2"]);
});

// ── Follows ───────────────────────────────────────────────────────────────────────────────

test("follow list: unsigned 401, no write, nobody told they were followed", async () => {
  const env = envWith();
  const r = await social(env, "PUT", `/follows/${A}`, { following: [B] });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "sign_to_save");
  assert.equal(env.LAB_STORE.m.has(`follows:${A}`), false);
  assert.deepEqual(notifs(env, B), []);
  // Bob can't rewrite Alice's list either.
  assert.equal((await social(env, "PUT", `/follows/${A}`, { following: [B], labAuth: await auth(bob) })).status, 401);
  assert.equal(env.LAB_STORE.m.has(`follows:${A}`), false);
});

test("follow list: the owner saves it, newly followed wallets are told, the read stays public", async () => {
  const env = envWith();
  assert.equal((await social(env, "PUT", `/follows/${A}`, { following: [bob.address], labAuth: await auth(alice) })).status, 200);
  assert.deepEqual(stored(env, `follows:${A}`), [B]);
  assert.equal(notifs(env, B)[0].type, "follow");
  assert.equal(notifs(env, B)[0].fromWallet, A);
  const r = await social(env, "GET", `/follows/${A}`);
  assert.deepEqual(r.body.following, [B]);
});

test("routes the social module doesn't own fall through", async () => {
  assert.equal(await handleSocial(["feed"], req("GET", "/feed"), envWith(), { now }), null);
});
