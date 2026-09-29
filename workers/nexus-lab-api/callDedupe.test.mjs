// Run: node --test workers/nexus-lab-api/callDedupe.test.mjs
// One call, one wallet (callDedupe.mjs): calls copied between wallets are settled only on proof of
// who made them, report-only until CALL_DEDUPE_LIVE, and a marked copy counts nowhere but its owner.
import test from "node:test";
import assert from "node:assert/strict";
import { findCopies, houseProof, resolveDuplicates, REPORT_KEY, PROOF_KEY, THESIS_REGISTRY } from "./callDedupe.mjs";
import { thesisRegistrant, THESIS_REGISTERED_TOPIC, sealTheses } from "./callLock.mjs";
import { computeCallerStats } from "./grading.mjs";
import { publicLabView } from "../../app/lib/labAuth.mjs";

const HOUSE = "0x" + "fc".repeat(20), A = "0x" + "aa".repeat(20), B = "0x" + "bb".repeat(20), SOL = "82mmcjt8nqxs";
const TX = "0x" + "12".repeat(32);
const pad = (a) => "0x" + "0".repeat(24) + a.slice(2);
const receiptFor = (trader, { status = "0x1", id = 7 } = {}) => ({
  status, logs: [{ address: THESIS_REGISTRY, topics: [THESIS_REGISTERED_TOPIC, "0x" + id.toString(16).padStart(64, "0"), pad(trader)] }],
});

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
const call = (over = {}) => ({ id: "c", symbol: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, createdAt: Date.UTC(2026, 7, 1), isPublic: true, ...over });
const rec = (theses) => ({ theses, notes: {} });
const read = (env, w) => JSON.parse(env.LAB_STORE.m.get(`lab:${w}`)).theses;

test("findCopies: public calls held by 2+ wallets; private copies and one wallet's own repeats don't count", () => {
  const copies = findCopies([
    { wallet: A, theses: [call({ id: "x" }), call({ id: "x" }), call({ id: "p", isPublic: false })] },
    { wallet: B, theses: [call({ id: "x" }), call({ id: "p", isPublic: false }), call({ id: "solo" })] },
  ]);
  assert.deepEqual([...copies.keys()], ["x"]);
  assert.deepEqual(copies.get("x").map((c) => c.wallet), [A, B]);
});

test("houseProof: only ids the house generators mint, and only with the house address configured", () => {
  const env = { HOUSE_CALLER_ADDRESS: HOUSE.toUpperCase().replace("0X", "0x") };
  assert.equal(houseProof("nexus-HYPE-1787631434567", env).owner, HOUSE);
  assert.equal(houseProof("catalyst-BTC-LONG-1", env), null, "catalyst house address not set");
  assert.equal(houseProof("1787096377807", env), null);
  assert.equal(houseProof("nexus-X-1", {}), null);
});

test("thesisRegistrant: the registry's event, a successful tx, and a matching thesis id", () => {
  assert.equal(thesisRegistrant(receiptFor(A), THESIS_REGISTRY), A);
  assert.equal(thesisRegistrant(receiptFor(A, { id: 7 }), THESIS_REGISTRY, 7), A);
  assert.equal(thesisRegistrant(receiptFor(A, { id: 7 }), THESIS_REGISTRY, "8"), null, "another thesis in the same tx isn't this one");
  assert.equal(thesisRegistrant(receiptFor(A, { status: "0x0" }), THESIS_REGISTRY), null);
  assert.equal(thesisRegistrant(receiptFor(A), "0x" + "99".repeat(20)), null, "another contract");
  assert.equal(thesisRegistrant(receiptFor(A), THESIS_REGISTRY, "not-a-number"), A, "a garbled stored id doesn't block the proof");
});

test("report-only: the plan is written, the records aren't", async () => {
  const env = {
    HOUSE_CALLER_ADDRESS: HOUSE,
    LAB_STORE: kv({
      [`lab:${HOUSE}`]: rec([call({ id: "nexus-BTC-1" }), call({ id: "1787", onChainTxHash: TX, onChainId: 7 })]),
      [`lab:${A}`]: rec([call({ id: "nexus-BTC-1" }), call({ id: "1787", onChainTxHash: TX, onChainId: 7 }), call({ id: "own" })]),
      [`lab:${SOL}`]: rec([call({ id: "1787", onChainTxHash: TX, onChainId: 7 })]),
    }),
  };
  const before = JSON.stringify([...env.LAB_STORE.m].filter(([k]) => k.startsWith("lab:")));
  const r = await resolveDuplicates(env, { fetchReceipt: async (h) => (h === TX ? receiptFor(HOUSE) : null), now: 1 });
  assert.equal(r.live, false);
  assert.equal(r.duplicated, 2);
  assert.equal(r.resolved, 2);
  assert.equal(r.copiesToMark, 3, "A's two copies and the Solana wallet's one");
  assert.equal(r.marksWritten, 0);
  assert.deepEqual(r.perWallet[A], { publicNow: 3, publicAfter: 1, marked: 2 });
  assert.deepEqual(r.perWallet[HOUSE], { publicNow: 2, publicAfter: 2, marked: 0 }, "the owner keeps every call");
  assert.equal(JSON.stringify([...env.LAB_STORE.m].filter(([k]) => k.startsWith("lab:"))), before, "no record changed");
  assert.ok(env.LAB_STORE.m.has(REPORT_KEY));
  assert.match(JSON.parse(env.LAB_STORE.m.get(PROOF_KEY("1787"))).evidence, /registered on-chain by/);
});

test("no proof, or a proven owner that holds no copy: left alone and listed as unresolved", async () => {
  const env = { LAB_STORE: kv({
    [`lab:${A}`]: rec([call({ id: "u" }), call({ id: "chain", onChainTxHash: TX })]),
    [`lab:${B}`]: rec([call({ id: "u" }), call({ id: "chain", onChainTxHash: TX })]),
  }) };
  const r = await resolveDuplicates(env, { fetchReceipt: async () => receiptFor("0x" + "99".repeat(20)), live: true });
  assert.equal(r.resolved, 0);
  assert.deepEqual(r.plan.map((p) => p.unresolvedWhy).sort(), ["no proof of who made it", `proven owner 0x${"99".repeat(20)} holds no copy`]);
  assert.equal(r.marksWritten, 0);
  assert.ok(read(env, A).every((t) => !t.duplicateOf));
});

test("live: only the other wallets' copies are marked, the owner's is untouched, and a rerun changes nothing", async () => {
  const env = { HOUSE_CALLER_ADDRESS: HOUSE, LAB_STORE: kv({
    [`lab:${HOUSE}`]: rec([call({ id: "nexus-BTC-1" })]),
    [`lab:${A}`]: rec([call({ id: "nexus-BTC-1" }), call({ id: "own" })]),
  }) };
  let receipts = 0;
  const fetchReceipt = async () => { receipts++; return null; };
  const r = await resolveDuplicates(env, { fetchReceipt, live: true });
  assert.equal(r.marksWritten, 1);
  assert.equal(read(env, A)[0].duplicateOf, HOUSE);
  assert.equal(read(env, A)[1].duplicateOf, undefined);
  assert.equal(read(env, HOUSE)[0].duplicateOf, undefined, "the owner's copy is the call");
  assert.equal(env.LAB_STORE.m.get("callowner:nexus-BTC-1"), HOUSE);
  const again = await resolveDuplicates(env, { fetchReceipt, live: true });
  assert.equal(again.marksWritten, 0);
  assert.equal(again.resolved, 1, "a marked copy still shows in the plan");
  assert.equal(receipts, 0, "a house id never needs a receipt");
});

test("a proof is read once: the next pass uses the cached one", async () => {
  const env = { LAB_STORE: kv({
    [`lab:${A}`]: rec([call({ id: "chain", onChainTxHash: TX })]),
    [`lab:${B}`]: rec([call({ id: "chain", onChainTxHash: TX })]),
  }) };
  let receipts = 0;
  const fetchReceipt = async () => { receipts++; return receiptFor(A); };
  await resolveDuplicates(env, { fetchReceipt });
  await resolveDuplicates(env, { fetchReceipt });
  assert.equal(receipts, 1);
});

test("a marked copy counts for nobody but its owner: board, public view, and a client can't clear the mark", async () => {
  const m = (over) => call({ id: "dup", ...over });
  const env = { LAB_STORE: kv({ [`lab:${A}`]: rec([m({ duplicateOf: B })]), [`lab:${B}`]: rec([m()]) }) };
  // The board, on real candles (entry trades at the post, the target prints two hours later): the
  // owner is credited the WIN, the wallet holding a marked copy is credited nothing.
  const H = 3600, nowS = Math.floor(Date.now() / 1000), posted = nowS - 5 * 86400;
  env.LAB_STORE.m.set(`lab:${A}`, JSON.stringify(rec([m({ duplicateOf: B, createdAt: posted * 1000 })])));
  env.LAB_STORE.m.set(`lab:${B}`, JSON.stringify(rec([m({ createdAt: posted * 1000 })])));
  const px = (t) => (t < posted + 2 * H ? { h: 100.5, l: 99.5, c: 100 } : { h: 111, l: 105, c: 108 });
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams, from = Number(q.get("from")), to = Number(q.get("to"));
    const t = []; for (let x = Math.ceil(from / H) * H; x <= to; x += H) t.push(x);
    const b = t.map(px);
    return { status: 200, json: async () => ({ s: "ok", t, o: b.map((x) => x.c), h: b.map((x) => x.h), l: b.map((x) => x.l), c: b.map((x) => x.c) }) };
  };
  try {
    const stats = await computeCallerStats(env, 0);
    assert.equal(stats[B].calls, 1);
    assert.equal(stats[B].wins, 1);
    assert.equal(stats[A], undefined, "the copy is not A's call");
  } finally { globalThis.fetch = real; }
  assert.deepEqual(publicLabView(rec([m({ duplicateOf: B }), call({ id: "mine" })])).theses.map((t) => t.id), ["mine"]);
  // A save from A's device can neither set nor clear it.
  const prev = [m({ duplicateOf: B })];
  const cleared = sealTheses({ prev, incoming: [m()], registry: null, now: 1 }).theses[0];
  assert.equal(cleared.duplicateOf, B);
  const forged = sealTheses({ prev: [call({ id: "own", isPublic: false })], incoming: [call({ id: "own", isPublic: false, duplicateOf: A })], registry: null, now: 1 }).theses[0];
  assert.equal(forged.duplicateOf, undefined);
});
