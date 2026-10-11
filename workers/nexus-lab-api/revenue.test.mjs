// Run: node --test workers/nexus-lab-api/revenue.test.mjs
// The owner's revenue page: reads balances, prices them, answers only the Safe's owners (or
// OPS_WALLETS). Every RPC, NEAR and Orderly read here is a fake; nothing touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  hexToBig, decodeAddressArray, toUnits, isRevenueViewer, readRevenue, readNearIntents, readSafeOwners,
  withChanges, compareDay, toSnapshot, dayOf, NEAR_INTENTS, TREASURY_SAFE,
} from "./revenue.mjs";
import { handleRevenue, freshRevenue } from "./routes-revenue.mjs";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";

const T0 = 1_790_000_000_000;
const owner = privateKeyToAccount("0x" + "c3".repeat(32));
const stranger = privateKeyToAccount("0x" + "d4".repeat(32));
const OWNER = owner.address.toLowerCase();
const STRANGER = stranger.address.toLowerCase();

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const encodeOwners = (addrs) => "0x" + word(32) + word(addrs.length) + addrs.map((a) => a.slice(2).toLowerCase().padStart(64, "0")).join("");
const hex = (n) => "0x" + BigInt(n).toString(16);

/**
 * A fake network. `balances`: { "<token|native>:<chain>:<holder>": rawBigInt }. NEAR answers the
 * intents balances in token order; Orderly answers marks. Any failure flag makes that source fail.
 */
function fakeNet({ balances = {}, owners = [OWNER], near = null, marks = { ETH: 2500, SOL: 150, BTC: 60000 }, failEvm = false, failNear = false } = {}) {
  const calls = [];
  const res = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const chainOf = (url) => (url.includes("arb") ? "arb" : "base");
  const f = async (url, init = {}) => {
    calls.push(url);
    if (url.includes("orderly.org")) {
      const sym = url.match(/PERP_([A-Z]+)_USDC/)?.[1];
      return marks[sym] ? res({ success: true, data: { mark_price: marks[sym] } }) : res({ success: false });
    }
    const body = JSON.parse(init.body || "{}");
    if (url.includes("near")) {
      if (failNear) throw new Error("near down");
      const list = NEAR_INTENTS.tokens.map((t) => String(near?.[t.id] ?? 0));
      return res({ jsonrpc: "2.0", id: 1, result: { result: [...new TextEncoder().encode(JSON.stringify(list))] } });
    }
    if (failEvm) throw new Error("rpc down");
    const chain = chainOf(url);
    if (body.method === "eth_getBalance") return res({ result: hex(balances[`native:${chain}:${body.params[0].toLowerCase()}`] ?? 0n) });
    const { to, data } = body.params[0];
    if (data === "0xa0e67e2b") return res({ result: encodeOwners(owners) });
    const holder = "0x" + data.slice(-40);
    return res({ result: hex(balances[`${to.toLowerCase()}:${chain}:${holder}`] ?? 0n) });
  };
  f.calls = calls;
  return f;
}

const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const NEXUS = "0x3d958634ab725b627919ef8f2ed59227309fdba3";
const SUBS = "0x06cd9c281e6ab09906b46a10e059f2770efde49a";
const SAFE = TREASURY_SAFE.toLowerCase();

test("decoding: uint words, the Safe's owner list, units", () => {
  assert.equal(hexToBig("0x10"), 16n);
  assert.equal(hexToBig("0x"), 0n);
  assert.equal(hexToBig("nope"), 0n);
  assert.deepEqual(decodeAddressArray(encodeOwners([OWNER, STRANGER])), [OWNER, STRANGER]);
  assert.deepEqual(decodeAddressArray("0x"), []);
  assert.deepEqual(decodeAddressArray("0x" + word(32) + word(999)), [], "a length past the data is refused");
  assert.equal(toUnits(20_500_000n, 6), 20.5);
  assert.equal(toUnits(10n ** 18n * 3n, 18), 3);
});

test("isRevenueViewer: a Safe owner or an OPS_WALLETS address, nobody else", () => {
  assert.equal(isRevenueViewer(OWNER, [OWNER]), true);
  assert.equal(isRevenueViewer(OWNER.toUpperCase().replace("0X", "0x"), [OWNER]), true, "case doesn't matter");
  assert.equal(isRevenueViewer(STRANGER, [OWNER]), false);
  assert.equal(isRevenueViewer(STRANGER, [OWNER], ` ${STRANGER.toUpperCase().replace("0X", "0x")} , 0xabc`), true);
  assert.equal(isRevenueViewer("", [OWNER], ""), false);
  assert.equal(isRevenueViewer("0x" + "0".repeat(40), [], ""), false, "no owners read and no list: nobody");
});

test("readRevenue: prices each holding, leaves an unpriced one null (never 0), totals what isn't swept", async () => {
  const usdc = USDC_ARB.toLowerCase();
  const near = { [NEAR_INTENTS.tokens[0].id]: 1_500_000n, [NEAR_INTENTS.tokens.find((t) => t.sym === "BTC").id]: 1000n };
  const f = fakeNet({
    balances: {
      [`${usdc}:arb:${SUBS}`]: 40_000_000n,                       // 40 USDC of subs
      [`${NEXUS}:base:${SUBS}`]: 10n ** 18n * 1_000_000n,          // 1M $NEXUS
      [`${usdc}:arb:${SAFE}`]: 500_000_000n,                       // 500 USDC in the Safe
      [`native:arb:${SAFE}`]: 10n ** 17n,                          // 0.1 ETH
    },
    near,
  });
  const rev = await readRevenue({ fetchImpl: f, prices: { ETH: 2500, BTC: 60000, NEXUS: null }, now: T0 });
  const subs = rev.groups.find((g) => g.id === "subs");
  assert.equal(subs.rows.find((r) => r.key === "subs:usdcArb").usd, 40);
  const nx = subs.rows.find((r) => r.key === "subs:nexusBase");
  assert.equal(nx.amount, 1_000_000);
  assert.equal(nx.usd, null, "no $NEXUS price: the amount shows, the dollar value doesn't");
  const safe = rev.groups.find((g) => g.id === "treasury");
  assert.equal(safe.usd, 500 + 250);
  const nearG = rev.groups.find((g) => g.id === "near");
  assert.equal(nearG.usd, 1.5 + 0.00001 * 60000);
  assert.equal(nearG.unread, 0);
  assert.equal(rev.totals.treasury, 750);
  assert.equal(rev.totals.notSwept, 40 + nearG.usd, "the Safe isn't counted as unswept");
});

test("readRevenue: a source that can't be read says so (null amounts, unread count), never a zero", async () => {
  const rev = await readRevenue({ fetchImpl: fakeNet({ failEvm: true, failNear: true }), prices: { ETH: 2500 }, now: T0 });
  for (const g of rev.groups) {
    assert.equal(g.unread, g.rows.length, g.id);
    assert.ok(g.rows.every((r) => r.amount === null && r.usd === null));
  }
  assert.equal(await readNearIntents(fakeNet({ failNear: true })), null);
  assert.deepEqual(await readSafeOwners(fakeNet({ failEvm: true })), []);
});

test("changes: vs the newest snapshot at or before 7 / 30 days ago; a row with no past value says nothing", () => {
  const days = ["2026-08-01", "2026-09-01", "2026-09-10", "2026-10-03"];
  const at = Date.parse("2026-10-11T12:00:00Z");
  assert.equal(compareDay(days, at, 7), "2026-10-03");
  assert.equal(compareDay(days, at, 30), "2026-09-10");
  assert.equal(compareDay(["2026-10-10"], at, 7), null, "nothing old enough yet");

  const rev = { at, groups: [{ id: "subs", usd: 100, rows: [{ key: "subs:usdcArb", amount: 100 }, { key: "subs:nexusBase", amount: 5 }] }] };
  const snaps = {
    "2026-10-03": { usd: { subs: 60 }, rows: { "subs:usdcArb": 60 } },
    "2026-09-10": { usd: { subs: 10 }, rows: { "subs:usdcArb": 10, "subs:nexusBase": 9 } },
  };
  const out = withChanges(rev, snaps, [7, 30], days);
  const g = out.groups[0];
  assert.deepEqual(g.change, { 7: 40, 30: 90 });
  assert.deepEqual(g.rows[0].change, { 7: 40, 30: 90 });
  assert.deepEqual(g.rows[1].change, { 7: null, 30: -4 }, "a drop (a sweep) shows as negative");
  assert.deepEqual(out.history, { since: "2026-08-01", compareDays: { 7: "2026-10-03", 30: "2026-09-10" } });
  assert.deepEqual(toSnapshot({ at, groups: [{ id: "x", usd: 3, rows: [{ key: "x:a", amount: 3 }, { key: "x:b", amount: null }] }] }),
    { at, rows: { "x:a": 3 }, usd: { x: 3 } }, "an unread row isn't stored as a value");
});

// ── the route ──
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const auth = async (account, ts = T0) => ({ ts, sig: await account.signMessage({ message: labSaveMessage(account.address, ts) }) });
const call = (env, body, f, now = T0 + 60_000) => handleRevenue(["ops", "revenue"], new Request("https://og.test/ops/revenue", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), env, { now: () => now, fetchImpl: f, nexusPrice: async () => 0.00001 });

test("route: other paths aren't ours; GET is refused", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal(await handleRevenue(["ops", "other"], new Request("https://og.test/ops/other"), env), null);
  const r = await handleRevenue(["ops", "revenue"], new Request("https://og.test/ops/revenue"), env);
  assert.equal(r.status, 405);
});

test("route: no signature → 401; a signed stranger → 403; nothing is read or stored for them", async () => {
  const env = { LAB_STORE: kv() };
  const f = fakeNet();
  assert.equal((await call(env, { address: OWNER }, f)).status, 401);
  assert.equal((await call(env, { address: OWNER, labAuth: await auth(stranger) }, f)).status, 401, "someone else's signature");
  const r = await call(env, { address: STRANGER, labAuth: await auth(stranger) }, f);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).ownersRead, true);
  assert.ok(![...env.LAB_STORE.m.keys()].some((k) => k.startsWith("ops:rev:")), "no balances read for a stranger");
});

test("route: an owner gets the page; the read is cached 5 min and snapshotted once a day", async () => {
  const env = { LAB_STORE: kv() };
  const f = fakeNet({ balances: { [`${USDC_ARB}:arb:${SUBS}`]: 7_000_000n } });
  const r = await call(env, { address: OWNER, labAuth: await auth(owner) }, f);
  assert.equal(r.status, 200);
  const page = await r.json();
  assert.equal(page.groups.find((g) => g.id === "subs").usd, 7);
  assert.ok(env.LAB_STORE.m.has(`ops:rev:snap:${dayOf(T0 + 60_000)}`));
  assert.equal(page.history.since, dayOf(T0 + 60_000));
  assert.deepEqual(page.groups[0].change, { 7: null, 30: null }, "no week-old snapshot yet");

  const before = f.calls.length;
  await call(env, { address: OWNER, labAuth: await auth(owner) }, f, T0 + 120_000);
  assert.equal(f.calls.length, before, "within 5 minutes: served from the cache, owners cached too");
  await call(env, { address: OWNER, labAuth: await auth(owner), refresh: true }, f, T0 + 120_000);
  assert.ok(f.calls.length > before, "refresh reads again");
});

test("route: OPS_WALLETS lets a non-owner in", async () => {
  const env = { LAB_STORE: kv(), OPS_WALLETS: STRANGER };
  const r = await call(env, { address: STRANGER, labAuth: await auth(stranger) }, fakeNet());
  assert.equal(r.status, 200);
});

test("freshRevenue: an all-unread read stores no snapshot (a dead RPC isn't a zero balance)", async () => {
  const env = { LAB_STORE: kv() };
  await freshRevenue(env, { fetchImpl: fakeNet({ failEvm: true, failNear: true }), now: T0 });
  assert.equal(env.LAB_STORE.m.size, 0);
  await freshRevenue(env, { fetchImpl: fakeNet(), now: T0 });
  assert.ok(env.LAB_STORE.m.has(`ops:rev:snap:${dayOf(T0)}`));
  const first = env.LAB_STORE.m.get(`ops:rev:snap:${dayOf(T0)}`);
  await freshRevenue(env, { fetchImpl: fakeNet({ balances: { [`${USDC_ARB}:arb:${SUBS}`]: 9n } }), now: T0 + 3600e3 });
  assert.equal(env.LAB_STORE.m.get(`ops:rev:snap:${dayOf(T0)}`), first, "the day's first snapshot stands");
});
