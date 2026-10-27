// Run: node --test workers/nexus-lab-api/routes-session.test.mjs
// The "end all sessions" switch with real signatures and a fake KV: a fresh session ends every older
// one and keeps itself, and the stamp never moves backwards (so a leaked older session can't undo it).
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { handleSession, checkTradingSession, SESSIONS_AFTER_KEY } from "./routes-session.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";

const owner = privateKeyToAccount("0x" + "77".repeat(32));
const W = owner.address.toLowerCase();
const T0 = 1_792_000_000_000;
const H = 3600e3;

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
async function session(acct, issuedAt) {
  const s = newTradingSession({ address: acct.address, now: issuedAt });
  return { session: s.session, issued: s.issued, expires: s.expires, sig: await acct.signMessage({ message: s.message }) };
}
const req = (body, method = "POST") => new Request("https://og.test/v2/session/end-all", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
const endAll = async (env, body, now) => {
  const res = await handleSession(["v2", "session", "end-all"], req(body), env, { now: () => now });
  return { status: res.status, body: await res.json() };
};

test("a fresh session ends every older one and keeps itself", async () => {
  const env = { NEXUS_AGENT: kv() };
  const leaked = await session(owner, T0);
  const fresh = await session(owner, T0 + 2 * H);
  assert.equal((await checkTradingSession(env, W, leaked, { now: T0 + 3 * H })).ok, true, "before the switch, the leaked one works");
  const r = await endAll(env, { wallet: owner.address, session: fresh }, T0 + 3 * H);
  assert.deepEqual([r.status, r.body.ok, r.body.sessionsAfter, r.body.kept], [200, true, fresh.issued, fresh.session]);
  assert.equal(env.NEXUS_AGENT.m.get(SESSIONS_AFTER_KEY(W)), String(fresh.issued));
  assert.equal((await checkTradingSession(env, W, leaked, { now: T0 + 3 * H })).reason, "ended");
  assert.equal((await checkTradingSession(env, W, fresh, { now: T0 + 3 * H })).ok, true);
});

test("the stamp only moves forward: an older session can't undo it", async () => {
  const env = { NEXUS_AGENT: kv() };
  const older = await session(owner, T0);
  const newer = await session(owner, T0 + 2 * H);
  await endAll(env, { wallet: owner.address, session: newer }, T0 + 3 * H);
  const r = await endAll(env, { wallet: owner.address, session: older }, T0 + 3 * H);
  assert.equal(r.status, 401, "the older session is already ended");
  assert.equal(env.NEXUS_AGENT.m.get(SESSIONS_AFTER_KEY(W)), String(newer.issued));
});

test("no session, someone else's, or the wrong method: refused, nothing written", async () => {
  const env = { NEXUS_AGENT: kv() };
  assert.equal((await endAll(env, { wallet: owner.address }, T0)).status, 401);
  const stranger = privateKeyToAccount("0x" + "88".repeat(32));
  assert.equal((await endAll(env, { wallet: owner.address, session: await session(stranger, T0) }, T0 + H)).status, 401);
  assert.equal(env.NEXUS_AGENT.m.size, 0);
  const get = await handleSession(["v2", "session", "end-all"], req(null, "GET"), env, {});
  assert.equal(get.status, 405);
  assert.equal(await handleSession(["v2", "session", "other"], req({}), env, {}).then((r) => r.status), 404);
  assert.equal(await handleSession(["agent"], req({}), env, {}), null, "other paths pass through");
});
