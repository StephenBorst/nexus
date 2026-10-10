import { test } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import {
  pushEndpointOk, validSubscription, normTopics, topicForType, notifPayload,
  agentTransitions, agentSnapshot, agentEventMessage, saveSubscription, deleteSubscription,
  pushNotification, runAgentWatch, MAX_DEVICES,
} from "./push.mjs";
import { b64u } from "./webpush.mjs";

function fakeKV(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}
const jwk = JSON.stringify(nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }));
function sub(n = 1) {
  const e = nodeCrypto.createECDH("prime256v1"); e.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/dev${n}`, keys: { p256dh: b64u.encode(e.getPublicKey()), auth: b64u.encode(nodeCrypto.randomBytes(16)) } };
}
const W = "0x9a3012988d60d61b34660be06a321f7bf7bccb28";

test("endpoints: only real push services, https, no tricks", () => {
  assert.ok(pushEndpointOk("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(pushEndpointOk("https://updates.push.services.mozilla.com/wpush/v2/abc"));
  assert.ok(pushEndpointOk("https://wns2-par02p.notify.windows.com/w/?token=x"));
  assert.ok(pushEndpointOk("https://web.push.apple.com/abc"));
  assert.ok(!pushEndpointOk("http://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(!pushEndpointOk("https://fcm.googleapis.com.evil.com/x"));
  assert.ok(!pushEndpointOk("https://evil.com/fcm.googleapis.com"));
  assert.ok(!pushEndpointOk("https://user:pw@fcm.googleapis.com/x"));
  assert.ok(!pushEndpointOk("https://fcm.googleapis.com:8443/x"));
  assert.ok(!pushEndpointOk("https://og.nexustradinglabs.com/push/config"));
  assert.ok(!pushEndpointOk("not a url"));
  assert.ok(validSubscription(sub()));
  assert.ok(!validSubscription({ ...sub(), keys: { p256dh: "short", auth: "x" } }));
});

test("topics: calls + agent on, social off, by default", () => {
  assert.deepEqual(normTopics(undefined), { calls: true, agent: true, social: false });
  assert.deepEqual(normTopics({ agent: false, social: true, junk: 1 }), { calls: true, agent: false, social: true });
  assert.equal(topicForType("call_resolved"), "calls");
  assert.equal(topicForType("agent_trade"), "agent");
  assert.equal(topicForType("comment"), "social");
  assert.equal(topicForType("something_else"), null);
});

test("payload: a graded call opens the call, an agent alert opens the agent", () => {
  const p = notifPayload({ id: "n1", type: "call_resolved", message: "BTC LONG hit target — +1.5R", thesisId: "t9" }, W.toUpperCase());
  assert.deepEqual(p, { title: "Call graded", body: "BTC LONG hit target — +1.5R", url: `/feed/thesis/${W}/t9`, tag: "n1" });
  assert.equal(notifPayload({ type: "agent_trade", message: "m", url: "/lab?tab=agent" }, W).url, "/lab?tab=agent");
  assert.equal(notifPayload({ type: "agent_trade", message: "m", url: "https://evil.com" }, W).url, "/");
});

const pos = (o = {}) => ({ symbol: "PERP_BTC_USDC", direction: "LONG", entry_price: 63412.5, opened_at: 1000, paper: true, ...o });

test("agent: the first look records a baseline and announces nothing", () => {
  const { snap, events } = agentTransitions(null, { current_position: pos(), paper_trades: [{ id: "p1" }] });
  assert.deepEqual(events, []);
  assert.equal(snap.pos, "PERP_BTC_USDC|LONG|1000");
  assert.equal(snap.lastPaperId, "p1");
});

test("agent: open, then close with the paper P&L and exit", () => {
  const s0 = agentSnapshot({ current_position: null, paper_trades: [{ id: "p1" }] });
  const a = agentTransitions(s0, { current_position: pos(), paper_trades: [{ id: "p1" }] });
  assert.deepEqual(a.events, [{ kind: "open", symbol: "PERP_BTC_USDC", direction: "LONG", paper: true, entry: 63412.5 }]);
  assert.equal(agentEventMessage(a.events[0]), "Agent opened BTC LONG at 63,412.5 · paper");

  const closed = { current_position: null, paper_trades: [{ id: "p2", symbol: "PERP_BTC_USDC", direction: "LONG", pnl: 1.234, reason: "TP" }, { id: "p1" }] };
  const b = agentTransitions(a.snap, closed);
  assert.deepEqual(b.events, [{ kind: "close", symbol: "PERP_BTC_USDC", direction: "LONG", paper: true, pnl: 1.234, reason: "TP" }]);
  assert.equal(agentEventMessage(b.events[0]), "Agent closed BTC LONG · TP · +$1.23 · paper");
  // Nothing new next time.
  assert.deepEqual(agentTransitions(b.snap, closed).events, []);
});

test("agent: a live close names no number it doesn't have", () => {
  const prev = agentSnapshot({ current_position: pos({ paper: false }) });
  const r = agentTransitions(prev, { current_position: null });
  assert.equal(r.events.length, 1);
  assert.equal(agentEventMessage(r.events[0]), "Agent closed BTC LONG · result in your History tab");
});

test("agent: partial take-profits don't announce a close; open+close between looks does", () => {
  const prev = agentSnapshot({ current_position: pos(), paper_trades: [{ id: "p1" }] });
  const partial = { current_position: pos(), paper_trades: [{ id: "p2", reason: "TP_PARTIAL", symbol: "PERP_BTC_USDC", direction: "LONG", pnl: 0.5 }, { id: "p1" }] };
  assert.deepEqual(agentTransitions(prev, partial).events, []);

  const flat = agentSnapshot({ current_position: null, paper_trades: [{ id: "p1" }] });
  const quick = { current_position: null, paper_trades: [{ id: "p2", symbol: "PERP_ETH_USDC", direction: "SHORT", pnl: -0.8, reason: "SL" }, { id: "p1" }] };
  const r = agentTransitions(flat, quick);
  assert.equal(r.events.length, 1);
  assert.equal(agentEventMessage(r.events[0]), "Agent closed ETH SHORT · SL · −$0.80 · paper");
});

test("agent: a ledger reset replays nothing", () => {
  const prev = agentSnapshot({ current_position: null, paper_trades: [{ id: "p9" }, { id: "p8" }] });
  assert.deepEqual(agentTransitions(prev, { current_position: null, paper_trades: [] }).events, []);
  assert.deepEqual(agentTransitions(prev, { current_position: null, paper_trades: [{ id: "x1" }] }).events, []);
});

test("agent: close one and open another between looks = both", () => {
  const prev = agentSnapshot({ current_position: pos(), paper_trades: [] });
  const next = { current_position: pos({ symbol: "PERP_SOL_USDC", opened_at: 2000, entry_price: 148.12 }), paper_trades: [{ id: "p1", symbol: "PERP_BTC_USDC", direction: "LONG", pnl: -1, reason: "TIMEOUT" }] };
  const kinds = agentTransitions(prev, next).events.map((e) => `${e.kind}:${e.symbol}`);
  assert.deepEqual(kinds, ["close:PERP_BTC_USDC", "open:PERP_SOL_USDC"]);
});

test("store: devices per wallet, capped, moved between wallets, agent index kept", async () => {
  const env = { LAB_STORE: fakeKV(), VAPID_PRIVATE_JWK: jwk };
  for (let i = 1; i <= MAX_DEVICES + 2; i++) await saveSubscription(env, W, sub(i), undefined);
  const ids = JSON.parse(await env.LAB_STORE.get(`push:wallet:${W}`));
  assert.equal(ids.length, MAX_DEVICES);
  assert.equal([...env.LAB_STORE.m.keys()].filter((k) => k.startsWith("push:sub:")).length, MAX_DEVICES);
  assert.deepEqual(JSON.parse(await env.LAB_STORE.get("push:agentwatch")), [W]);

  // The same phone signs in with another wallet: it leaves the first wallet's list.
  const other = "0xa77ca113f39405b50617c2cc9ba5d6e3ced4a9a7";
  await saveSubscription(env, other, sub(MAX_DEVICES + 2), { agent: false });
  assert.equal(JSON.parse(await env.LAB_STORE.get(`push:wallet:${W}`)).length, MAX_DEVICES - 1);
  assert.deepEqual(JSON.parse(await env.LAB_STORE.get("push:agentwatch")), [W]);

  await deleteSubscription(env, sub(MAX_DEVICES + 2).endpoint);
  assert.equal(await env.LAB_STORE.get(`push:wallet:${other}`), null);
});

test("pushNotification: off without the secret (no KV read), topic switches respected, dead devices removed", async () => {
  let reads = 0;
  const off = await pushNotification({ LAB_STORE: { get: async () => { reads++; return null; } } }, W, { type: "call_resolved", message: "m" });
  assert.equal(off.skipped, "off");
  assert.equal(reads, 0);

  const env = { LAB_STORE: fakeKV(), VAPID_PRIVATE_JWK: jwk };
  await saveSubscription(env, W, sub(1), { calls: true });
  await saveSubscription(env, W, sub(2), { calls: false });
  const hits = [];
  const ok = await pushNotification(env, W, { type: "call_resolved", message: "m" }, { fetchImpl: async (u) => { hits.push(u); return { status: 201 }; } });
  assert.equal(ok.sent, 1);
  assert.deepEqual(hits, [sub(1).endpoint]);

  assert.equal((await pushNotification(env, W, { type: "unknown" })).skipped, "type");

  await pushNotification(env, W, { type: "call_resolved", message: "m" }, { fetchImpl: async () => ({ status: 410 }) });
  assert.deepEqual(JSON.parse(await env.LAB_STORE.get(`push:wallet:${W}`)).length, 1, "the gone device is dropped");
});

test("watcher: reads agent:state, writes only push:agentseen, baseline first", async () => {
  const agent = fakeKV({ [`agent:state:${W}`]: JSON.stringify({ current_position: null, paper_trades: [] }) });
  const env = { LAB_STORE: fakeKV({ "push:agentwatch": JSON.stringify([W]) }), NEXUS_AGENT: agent, VAPID_PRIVATE_JWK: jwk };
  const sent = [];
  const notify = async (w, n) => sent.push([w, n.type, n.message, n.url]);
  const before = JSON.stringify([...agent.m]);
  assert.deepEqual(await runAgentWatch(env, notify), { watched: 1, events: 0 });
  await agent.put(`agent:state:${W}`, JSON.stringify({ current_position: pos(), paper_trades: [] }));
  const snapAgent = JSON.stringify([...agent.m]);
  assert.deepEqual(await runAgentWatch(env, notify), { watched: 1, events: 1 });
  assert.deepEqual(sent, [[W, "agent_trade", "Agent opened BTC LONG at 63,412.5 · paper", "/lab?tab=agent"]]);
  assert.equal(JSON.stringify([...agent.m]), snapAgent, "never writes the engine's KV");
  assert.notEqual(before, snapAgent);
  assert.deepEqual(await runAgentWatch(env, notify), { watched: 1, events: 0 });
  assert.equal((await runAgentWatch({ ...env, VAPID_PRIVATE_JWK: undefined }, notify)).skipped, "off");
});
