// /sealed: a fire signed by the read's own wallet becomes one public call built from the public contract
// (docs/research/sealed-reads.md §2). Tests never touch the network: mark + ATR are injected.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { handleSealed, sealedLogKey, sealedDryKey } from "./routes-sealed.mjs";
import { sealedFireMessage, FIRE_WINDOW_MS } from "../../app/lib/sealedFire.mjs";
import { SEALED_READS } from "../../app/lib/sealedReads.mjs";

const H = 3600e3;
const house = privateKeyToAccount("0x" + "c3".repeat(32));
const other = privateKeyToAccount("0x" + "d4".repeat(32));
const READ = Object.freeze({ name: "house-t", label: "House signal", fingerprint: "ab".repeat(32), wallet: house.address,
  committedAt: "2026-11-20", xPost: { url: "https://x.com/borstxbt/status/1", at: "2026-11-20T15:00:00Z" }, posterLiveAt: "2026-11-20T16:00:00Z" });
const START = Date.parse("2026-11-21T00:00:00Z");
const FIRE = START + 30 * H;                  // a bar close after the start

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; } };
}
const env = () => ({ LAB_STORE: kv(), NEXUS_AGENT: kv() });
const noLock = (_e, _k, fn) => fn();
const go = (e, body, { at = FIRE + 60_000, mark = 2500, atr = 0.02, reads = [READ] } = {}) =>
  handleSealed(["sealed", "fire"], new Request("https://og.test/sealed/fire", { method: "POST", body: JSON.stringify(body) }), e,
    { now: () => at, lock: noLock, readMark: async () => (mark ? { px: mark, at, src: "orderly-mark" } : null), readAtr: async () => atr, reads });
const fire = async (account, { name = READ.name, coin = "ETH", side = "LONG", fireAt = FIRE, dryRun } = {}) =>
  ({ name, coin, side, fireAt, dryRun, sig: await account.signMessage({ message: sealedFireMessage(name, coin, side, fireAt) }) });

test("a fire signed by the read's wallet becomes one sealed public call on the frozen contract", async () => {
  const e = env();
  const res = await go(e, await fire(house));
  assert.equal(res.status, 200);
  const { call } = await res.json();
  assert.equal(call.entryPrice, 2500);
  assert.equal(call.stopLoss, 2440);                // 1.2 × 2% = 2.4% below
  assert.equal(call.takeProfit1, 2590);             // 1.5R = 3.6% above
  assert.equal(call.timeStopH, 168);
  const rec = JSON.parse(e.LAB_STORE.m.get(`lab:${house.address.toLowerCase()}`));
  const t = rec.theses.find((x) => x.id === call.id);
  assert.ok(t && t.isPublic && t.source === "sealed-read" && t.sealedRead === READ.name);
  assert.ok(e.LAB_STORE.m.get(`callreg:${house.address.toLowerCase()}`), "registered like any published call");
  const log = JSON.parse(e.LAB_STORE.m.get(sealedLogKey(READ.name)));
  assert.deepEqual(log.map((x) => x.status), ["POSTED"]);
});

test("only the read's own wallet can fire it, and the signature covers coin, side and time", async () => {
  const e = env();
  assert.equal((await go(e, await fire(other))).status, 401);
  const forged = { ...(await fire(house)), side: "SHORT" };
  assert.equal((await go(e, forged)).status, 401, "a LONG signature can't post a SHORT");
  assert.equal(e.LAB_STORE.m.size, 0, "nothing written");
});

test("before the X post is recorded, or before the start, nothing posts (a dry run still shows the call)", async () => {
  const e = env();
  const noPost = { ...READ, xPost: null };
  assert.equal((await go(e, await fire(house), { reads: [noPost] })).status, 409);
  const early = START - 2 * H;
  assert.equal((await go(e, await fire(house, { fireAt: early }), { at: early + 1000 })).status, 409);
  const dry = await go(e, await fire(house, { fireAt: early, dryRun: true }), { at: early + 1000, reads: [noPost] });
  assert.equal(dry.status, 200);
  assert.equal((await dry.json()).dryRun, true);
  assert.equal(e.LAB_STORE.m.get(`lab:${house.address.toLowerCase()}`), undefined, "a dry run posts no call");
  assert.equal(e.LAB_STORE.m.get(sealedLogKey(READ.name)), undefined, "and is no fire on the record");
  const dryLog = JSON.parse(e.LAB_STORE.m.get(sealedDryKey(READ.name)));
  assert.deepEqual(dryLog.map((x) => [x.coin, x.side, x.fireAt]), [["ETH", "LONG", early]], "only the dry-run log, so the poster can be checked");
  assert.equal(dryLog[0].stopLoss < dryLog[0].entryPrice, true);
  assert.equal((await go(e, { ...(await fire(house, { fireAt: early, dryRun: true })), sig: (await fire(other, { fireAt: early })).sig }, { at: early + 1000, reads: [noPost] })).status, 401, "an unsigned dry run logs nothing");
  assert.equal(JSON.parse(e.LAB_STORE.m.get(sealedDryKey(READ.name))).length, 1);
});

test("more than 5 minutes late = a recorded miss and no call; duplicates and the 24h cooldown refuse", async () => {
  const e = env();
  const late = await go(e, await fire(house), { at: FIRE + FIRE_WINDOW_MS + 1 });
  assert.equal(late.status, 409);
  assert.equal((await late.json()).error, "late");
  assert.equal(e.LAB_STORE.m.get(`lab:${house.address.toLowerCase()}`), undefined, "no call");
  assert.deepEqual(JSON.parse(e.LAB_STORE.m.get(sealedLogKey(READ.name))).map((x) => x.status), ["MISSED"]);

  const e2 = env();
  assert.equal((await go(e2, await fire(house))).status, 200);
  assert.equal((await go(e2, await fire(house))).status, 409, "the same fire twice");
  const next = FIRE + 5 * H;
  assert.equal((await go(e2, await fire(house, { fireAt: next }), { at: next + 1000 })).status, 409, "same coin + side inside 24h");
  assert.equal((await go(e2, await fire(house, { fireAt: next, side: "SHORT" }), { at: next + 1000 })).status, 200, "the other side is its own");
});

test("an unreadable mark or ATR posts nothing and leaves the fire retryable inside its window", async () => {
  const e = env();
  assert.equal((await go(e, await fire(house), { mark: null })).status, 503);
  assert.equal((await go(e, await fire(house), { atr: null })).status, 503);
  assert.equal(e.LAB_STORE.m.size, 0);
  assert.equal((await go(e, await fire(house))).status, 200, "a retry inside the window posts");
});

test("GET /sealed/:name is the public record; house-1 is served from the real registry", async () => {
  const e = env();
  await go(e, await fire(house));
  const r = await handleSealed(["sealed", READ.name], new Request("https://og.test/sealed/x"), e, { reads: [READ] });
  const b = await r.json();
  assert.equal(b.countsFrom, "2026-11-21T00:00:00.000Z");
  assert.equal(b.posted, 1);
  assert.deepEqual(b.dryRuns, []);
  const real = await (await handleSealed(["sealed", "house-1"], new Request("https://og.test/sealed/house-1"), env())).json();
  assert.equal(real.fingerprint, SEALED_READS[0].fingerprint);
  assert.ok(!("rule" in real) && !("params" in real), "nothing private is served");
});
