import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followersOf, alertableCalls, notifyFollowersOfCalls, MAX_CALLS } from "./followAlerts.mjs";
import { topicForType, normTopics, notifPayload, DEFAULT_TOPICS } from "./push.mjs";

const A = "0xaaaa000000000000000000000000000000000001";
const kv = (entries, pageSize = 2) => {
  const m = new Map(Object.entries(entries));
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix, cursor }) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const s = cursor ? Number(cursor) : 0;
      const done = s + pageSize >= all.length;
      return { keys: all.slice(s, s + pageSize).map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(s + pageSize) };
    },
  };
};
const call = (id, extra) => ({ id, isPublic: true, symbol: "PERP_BTC_USDC", direction: "LONG", ...extra });

test("followers: every page scanned, case-insensitive, the author never notifies themself", async () => {
  const store = kv({
    [`follows:0xf1`]: JSON.stringify([A.toUpperCase().replace("0X", "0x")]),
    [`follows:0xf2`]: JSON.stringify(["0xother"]),
    [`follows:0xf3`]: JSON.stringify(["0xother", A]),
    [`follows:${A}`]: JSON.stringify([A]),
    [`follows:0xf4`]: "not json",
  });
  assert.deepEqual((await followersOf(store, A)).sort(), ["0xf1", "0xf3"]);
});

test("only public calls with a market and side; no holders-only, no copies; capped per save", () => {
  const list = alertableCalls([
    call("a"), call("b", { holdersOnly: true }), call("c", { duplicateOf: "x" }), call("d", { isPublic: false }),
    call("e", { symbol: null }), call("f"), call("g"), call("h"),
  ]);
  assert.deepEqual(list.map((t) => t.id), ["a", "f", "g"].slice(0, MAX_CALLS));
});

test("fan-out: names the author from their profile, the stored market/side, links the author's call", async () => {
  const env = { LAB_STORE: kv({ [`follows:0xf1`]: JSON.stringify([A]), [`follows:0xf2`]: JSON.stringify([A]), [`profile:${A}`]: JSON.stringify({ displayName: "kai" }) }) };
  const sent = [];
  const r = await notifyFollowersOfCalls(env, A, [call("t1", { direction: "SHORT", symbol: "PERP_ETH_USDC" })], { notify: async (e, to, n) => sent.push({ to, n }), now: () => 1 });
  assert.equal(r.sent, 2);
  assert.deepEqual(sent.map((x) => x.to).sort(), ["0xf1", "0xf2"]);
  const n = sent[0].n;
  assert.equal(n.type, "followed_call");
  assert.equal(n.message, "kai posted a call: ETH SHORT");
  assert.deepEqual([n.thesisId, n.thesisWallet, n.fromWallet], ["t1", A, A]);
  // the push opens the AUTHOR's call page, not the follower's
  assert.equal(notifPayload(n, "0xf1").url, `/feed/thesis/${A}/t1`);
});

test("no profile name = short address; no followers or no calls = nothing sent; a failing notify never throws", async () => {
  const env = { LAB_STORE: kv({ [`follows:0xf1`]: JSON.stringify([A]) }) };
  const sent = [];
  await notifyFollowersOfCalls(env, A, [call("t1")], { notify: async (e, to, n) => sent.push(n.message) });
  assert.deepEqual(sent, ["0xaaaa…0001 posted a call: BTC LONG"]);
  assert.equal((await notifyFollowersOfCalls(env, A, [])).sent, 0);
  assert.equal((await notifyFollowersOfCalls({ LAB_STORE: kv({}) }, A, [call("t1")])).sent, 0);
  const r = await notifyFollowersOfCalls(env, A, [call("t1")], { notify: async () => { throw new Error("kv down"); } });
  assert.equal(r.sent, 0);
});

test("push: its own topic, OFF by default; existing devices stay off until they opt in", () => {
  assert.equal(topicForType("followed_call"), "following");
  assert.equal(DEFAULT_TOPICS.following, false);
  assert.equal(normTopics({ calls: true, agent: true, social: true }).following, false);
  assert.equal(normTopics({ following: true }).following, true);
});

test("both publish paths fire it after the write commits", () => {
  const lab = readFileSync(new URL("./routes-lab.mjs", import.meta.url), "utf8");
  assert.match(lab, /await commit\(dataToSave\);[\s\S]{0,300}notifyFollowersOfCalls\(env, address, sealed\.newlyPublished\)/);
  const reg = readFileSync(new URL("./routes-thesisreg.mjs", import.meta.url), "utf8");
  assert.match(reg, /await prep\.commit\(record\);\s*await notifyFollowersOfCalls\(env, wallet, prep\.sealed\.newlyPublished\)/);
});
