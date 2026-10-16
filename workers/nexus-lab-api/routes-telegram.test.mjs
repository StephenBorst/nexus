// Run: node --test workers/nexus-lab-api/routes-telegram.test.mjs
// The Telegram link and webhook, end to end through the REAL route with REAL signatures and a fake
// Telegram (no network). The rules: a chat is linked to a wallet only through a one-time code the
// wallet signed for; a wallet address alone links nothing; once the worker has registered its secret
// with Telegram, a webhook request without it changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import bs58 from "bs58";
import {
  handleTelegram, secureTelegramWebhook, webhookSecret, TG_WEBHOOK_URL, LINK_CODE_TTL_SEC, LINK_CODE_RE,
} from "./routes-telegram.mjs";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";

const T0 = 1_792_000_000_000;
const now = () => T0 + 60_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const bob = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const solSk = new Uint8Array(32).fill(9);
const SOL = bs58.encode(ed25519.getPublicKey(solSk));
const auth = async (account, ts = T0) => ({ ts, sig: await account.signMessage({ message: labSaveMessage(account.address, ts) }) });
const solAuth = () => ({ ts: T0, signer: SOL, sig: "0x" + bytesToHex(ed25519.sign(utf8ToBytes(labSaveMessage(SOL, T0)), solSk)) });

function kv(init = {}) {
  const m = new Map(Object.entries(init));
  const opts = new Map();
  return {
    m, opts,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { m.set(k, v); opts.set(k, o); },
    async delete(k) { m.delete(k); },
  };
}

// A fake Telegram API: records every call, answers getWebhookInfo with `hook`.
function fakeTelegram({ hook = { url: TG_WEBHOOK_URL, allowed_updates: ["message"], max_connections: 40 }, setOk = true } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method, body });
    if (method === "getWebhookInfo") return new Response(JSON.stringify({ ok: true, result: hook }));
    if (method === "setWebhook") return new Response(JSON.stringify({ ok: setOk, result: setOk }));
    return new Response(JSON.stringify({ ok: true }));
  };
  return { f, calls, sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text) };
}

const envWith = (token = "123:abc") => ({ TELEGRAM_TOKEN: token, NEXUS_AGENT: kv(), LAB_STORE: kv() });
const call = async (env, tg, method, path, body, headers = {}) => {
  const r = new Request(`https://og.test${path}`, {
    method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleTelegram(path.split("/").filter(Boolean), r, env, { now, fetch: tg.f });
  const text = await res.text();
  let parsed = text; try { parsed = JSON.parse(text); } catch { /* "ok" */ }
  return { status: res.status, body: parsed };
};
const update = (chatId, text) => ({ update_id: 1, message: { chat: { id: chatId }, text } });
const linkFor = async (env, tg, wallet, labAuth) => call(env, tg, "POST", "/tg/link", { wallet, labAuth });

test("an unsigned or wrongly signed link request gets no code", async () => {
  const env = envWith(); const tg = fakeTelegram();
  const none = await linkFor(env, tg, A, undefined);
  assert.equal(none.status, 401); assert.equal(none.body.error, "sign_to_save"); assert.equal(none.body.reason, "missing");
  const bobsSig = await linkFor(env, tg, A, await auth(bob));
  assert.equal(bobsSig.status, 401); assert.equal(bobsSig.body.reason, "wrong_signer");
  assert.equal([...env.NEXUS_AGENT.m.keys()].filter((k) => k.startsWith("tg:linkcode:")).length, 0);
});

test("a signed code links the chat once, for 10 minutes, and the deep link carries no address", async () => {
  const env = envWith(); const tg = fakeTelegram();
  const r = await linkFor(env, tg, A, await auth(alice));
  assert.equal(r.status, 200);
  assert.match(r.body.code, LINK_CODE_RE);
  assert.equal(r.body.url, `https://t.me/nexustradinglabs_bot?start=${r.body.code}`);
  assert.ok(!r.body.url.toLowerCase().includes(A.slice(2, 12)));
  assert.equal(r.body.expiresInSec, 600);
  assert.equal(env.NEXUS_AGENT.opts.get(`tg:linkcode:${r.body.code}`).expirationTtl, LINK_CODE_TTL_SEC);

  await call(env, tg, "POST", "/tg/webhook", update(555, `/start ${r.body.code}`));
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${A}`), "555");
  assert.equal(env.NEXUS_AGENT.m.get("tg:wallet:555"), A);
  assert.match(tg.sent().at(-1), /^Linked to/);

  // The same code again, from another chat: nothing changes.
  await call(env, tg, "POST", "/tg/webhook", update(666, `/start ${r.body.code}`));
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${A}`), "555");
  assert.equal(env.NEXUS_AGENT.m.has("tg:wallet:666"), false);
  assert.match(tg.sent().at(-1), /wasn't found/);
});

test("the old deep link (/start <wallet>) links nothing", async () => {
  const env = envWith(); const tg = fakeTelegram();
  env.NEXUS_AGENT.m.set(`tg:chat:${A}`, "555"); // Alice is linked to her own chat
  await call(env, tg, "POST", "/tg/webhook", update(999, `/start ${A}`));
  await call(env, tg, "POST", "/tg/webhook", update(999, `/start ${SOL}`));
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${A}`), "555");
  assert.equal(env.NEXUS_AGENT.m.has(`tg:chat:${SOL.toLowerCase()}`), false);
  assert.equal(env.NEXUS_AGENT.m.has("tg:wallet:999"), false);
  assert.match(tg.sent().at(-1), /A wallet address alone can't link a chat/);
});

test("a Solana wallet links through its own signature", async () => {
  const env = envWith(); const tg = fakeTelegram();
  const r = await linkFor(env, tg, SOL, solAuth());
  assert.equal(r.status, 200);
  await call(env, tg, "POST", "/tg/webhook", update(777, `/start ${r.body.code}`));
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${SOL.toLowerCase()}`), "777");
});

test("/stop in an old chat doesn't unlink a wallet that moved to a new chat", async () => {
  const env = envWith(); const tg = fakeTelegram();
  for (const chat of [111, 222]) {
    const r = await linkFor(env, tg, A, await auth(alice));
    await call(env, tg, "POST", "/tg/webhook", update(chat, `/start ${r.body.code}`));
  }
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${A}`), "222");
  await call(env, tg, "POST", "/tg/webhook", update(111, "/stop"));
  assert.equal(env.NEXUS_AGENT.m.get(`tg:chat:${A}`), "222");
  await call(env, tg, "POST", "/tg/webhook", update(222, "/stop"));
  assert.equal(env.NEXUS_AGENT.m.has(`tg:chat:${A}`), false);
});

test("the cron registers the secret on OUR webhook, keeping its settings; then the header is required", async () => {
  const env = envWith(); const tg = fakeTelegram();
  // Before: no header needed (as before this change).
  assert.equal((await call(env, tg, "POST", "/tg/webhook", update(1, "/signals on"))).status, 200);

  const r = await secureTelegramWebhook(env, { fetch: tg.f, now });
  assert.equal(r.result, "secured");
  const set = tg.calls.find((c) => c.method === "setWebhook").body;
  assert.equal(set.url, TG_WEBHOOK_URL);
  assert.equal(set.secret_token, await webhookSecret(env));
  assert.match(set.secret_token, /^[0-9a-f]{64}$/);
  assert.deepEqual(set.allowed_updates, ["message"]);
  assert.equal(set.max_connections, 40);

  // A forged update: refused, nothing written.
  env.NEXUS_AGENT.m.delete("signals:sub:9");
  const forged = await call(env, tg, "POST", "/tg/webhook", update(9, "/signals on"));
  assert.equal(forged.status, 401);
  assert.equal(env.NEXUS_AGENT.m.has("signals:sub:9"), false);
  const wrong = await call(env, tg, "POST", "/tg/webhook", update(9, "/signals on"), { "X-Telegram-Bot-Api-Secret-Token": "nope" });
  assert.equal(wrong.status, 401);

  // Telegram's own update, with the header: works.
  const real = await call(env, tg, "POST", "/tg/webhook", update(9, "/signals on"), { "X-Telegram-Bot-Api-Secret-Token": await webhookSecret(env) });
  assert.equal(real.status, 200);
  assert.equal(env.NEXUS_AGENT.m.get("signals:sub:9"), "1");

  // Next hour: nothing to do, no Telegram call.
  const before = tg.calls.length;
  assert.equal((await secureTelegramWebhook(env, { fetch: tg.f, now })).result, "already_secured");
  assert.equal(tg.calls.length, before);

  // Status says secured and leaks nothing.
  const st = await call(env, tg, "GET", "/tg/status");
  assert.equal(st.body.secured, true);
  assert.ok(!JSON.stringify(st.body).includes(await webhookSecret(env)));
  assert.ok(!JSON.stringify(st.body).includes("123:abc"));
});

test("a webhook set somewhere else is left alone and nothing is enforced", async () => {
  const env = envWith(); const tg = fakeTelegram({ hook: { url: "https://elsewhere.example/hook" } });
  assert.equal((await secureTelegramWebhook(env, { fetch: tg.f, now })).result, "url_mismatch");
  assert.equal(tg.calls.some((c) => c.method === "setWebhook"), false);
  assert.equal((await call(env, tg, "POST", "/tg/webhook", update(1, "/signals on"))).status, 200);
  assert.equal((await call(env, tg, "GET", "/tg/status")).body.lastCheck.result, "url_mismatch");
});

test("if Telegram refuses the secret, nothing is enforced", async () => {
  const env = envWith(); const tg = fakeTelegram({ setOk: false });
  assert.equal((await secureTelegramWebhook(env, { fetch: tg.f, now })).result, "set_failed");
  assert.equal((await call(env, tg, "POST", "/tg/webhook", update(1, "/signals on"))).status, 200);
  assert.equal((await call(env, tg, "GET", "/tg/status")).body.secured, false);
});

test("a new bot token stops enforcement until the cron registers the new secret", async () => {
  const env = envWith("123:abc"); const tg = fakeTelegram();
  await secureTelegramWebhook(env, { fetch: tg.f, now });
  env.TELEGRAM_TOKEN = "456:def";
  // Telegram still sends the OLD secret until re-registered; the bot must keep working meanwhile.
  assert.equal((await call(env, tg, "POST", "/tg/webhook", update(1, "/signals on"))).status, 200);
  assert.equal((await secureTelegramWebhook(env, { fetch: tg.f, now })).result, "secured");
  assert.equal((await call(env, tg, "POST", "/tg/webhook", update(1, "/signals on"))).status, 401);
});

test("no bot token: nothing to register, webhook unchanged", async () => {
  const env = envWith(""); const tg = fakeTelegram();
  assert.equal((await secureTelegramWebhook(env, { fetch: tg.f, now })).result, "no_token");
  assert.equal(tg.calls.length, 0);
});
