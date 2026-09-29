// Run: node --test workers/nexus-lab-api/callLock.test.mjs
// Published calls are permanent (callLock.mjs). Each test is one way a caller used to be able to
// rewrite their own record: backdate, move levels, delete or hide a loser, write their own WIN.
import test from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  sealTheses, bootstrapRegistry, mergeUpdates, publishCandidates, readRegistry, isPublished,
  registeredBy, SERVER_FIELDS, MAX_PUBLISHED,
} from "./callLock.mjs";

const NOW = Date.UTC(2026, 8, 28, 20, 0, 0);
const H = 3600e3, D = 24 * H;
const call = (over = {}) => ({
  id: "c1", symbol: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, takeProfit2: 0,
  notes: "reclaim of the range low", createdAt: NOW - 2 * H, status: "ACTIVE", actualPnl: null, ...over,
});
// One save of `list` on top of a stored record `prev` and a registry `reg`.
const save = (prev, list, reg, now = NOW, ownedElsewhere) => sealTheses({ prev, incoming: list, registry: reg, now, ownedElsewhere });
// Publish c1 once, then return the state after that save.
function published(over = {}) {
  const r = save([], [call({ isPublic: true, ...over })], { v: 1, calls: {}, order: [] });
  return { prev: r.theses, reg: r.registry };
}

test("first publish: the server's clock is the post time; what the client claimed is kept for reference", () => {
  const r = save([], [call({ isPublic: true, createdAt: NOW - 7 * D })], { v: 1, calls: {}, order: [] });
  const t = r.theses[0];
  assert.equal(t.createdAt, NOW, "a call posted now can't be dated last week");
  assert.equal(t.publishedAt, NOW);
  assert.equal(t.clientCreatedAt, NOW - 7 * D);
  assert.equal(t.isPublic, true);
  assert.deepEqual(r.newlyPublished.map((x) => x.id), ["c1"]);
  assert.ok(r.registryChanged);
  assert.ok(isPublished(r.registry, "c1"));
});

test("levels, side, market and post time can't move after publish", () => {
  const { prev, reg } = published();
  const edited = { ...prev[0], stopLoss: 80, takeProfit1: 101, entryPrice: 99, direction: "SHORT", symbol: "ETH", createdAt: NOW - 30 * D, notes: "rewritten" };
  const r = save(prev, [edited], reg, NOW + H);
  const t = r.theses[0];
  for (const [k, v] of Object.entries({ stopLoss: 95, takeProfit1: 110, entryPrice: 100, direction: "LONG", symbol: "BTC", createdAt: NOW, notes: "reclaim of the range low" })) {
    assert.equal(t[k], v, `${k} stays as published`);
  }
  assert.equal(r.registryChanged, false);
});

test("a published call can't be deleted: a save that leaves it out gets it back", () => {
  const { prev, reg } = published();
  const r = save(prev, [call({ id: "c2" })], reg, NOW + H);
  assert.deepEqual(r.theses.map((t) => t.id), ["c2", "c1"]);
  assert.deepEqual(r.restored, ["c1"]);
  assert.equal(r.theses[1].isPublic, true);
});

test("a published call can't be hidden: private or holders-only both come back public", () => {
  const { prev, reg } = published();
  for (const vis of [{ isPublic: false }, { isPublic: false, holdersOnly: true }, { isPublic: true, holdersOnly: true }]) {
    const t = save(prev, [{ ...prev[0], ...vis }], reg, NOW + H).theses[0];
    assert.equal(t.isPublic, true, JSON.stringify(vis));
    assert.equal(t.holdersOnly, false, JSON.stringify(vis));
  }
});

test("a caller can't write their own WIN: grade fields and status come from the server only", () => {
  const { prev, reg } = published();
  const selfWin = { ...prev[0], gradedOutcome: "WIN", gradedR: 9, gradedAt: NOW, gradeV: 99, status: "HIT_TP", actualPnl: 500 };
  const t = save(prev, [selfWin], reg, NOW + H).theses[0];
  assert.equal(t.gradedOutcome, undefined);
  assert.equal(t.gradedR, undefined);
  assert.equal(t.gradeV, undefined);
  assert.equal(t.status, "ACTIVE", "status is derived from the server's grade");
  assert.equal(t.actualPnl, null, "the frozen copy keeps what it was published with");
  // INVALIDATED (abandon) is a self-mark too: a published call can't be walked away from.
  assert.equal(save(prev, [{ ...prev[0], status: "INVALIDATED" }], reg, NOW + H).theses[0].status, "ACTIVE");
});

test("the server's grade survives any save, and sets the status", () => {
  const { prev, reg } = published();
  const graded = [{ ...prev[0], gradedOutcome: "LOSS", gradedR: -1, gradedAt: NOW + H, gradeV: 2 }]; // what the cron wrote
  const t = save(graded, [{ ...prev[0] }], reg, NOW + 2 * H).theses[0];   // a stale client copy without it
  assert.equal(t.gradedOutcome, "LOSS");
  assert.equal(t.gradedR, -1);
  assert.equal(t.gradeV, 2);
  assert.equal(t.status, "STOPPED_OUT");
});

test("private calls stay the owner's to edit or delete; server fields still can't be written", () => {
  const prev = [call({ id: "p1", gradedOutcome: "LOSS", gradedR: -1 })];
  const r = save(prev, [call({ id: "p1", stopLoss: 90, gradedOutcome: "WIN", gradedR: 5, copyCount: 99 })], { v: 1, calls: {}, order: [] });
  assert.equal(r.theses[0].stopLoss, 90, "a private draft is editable");
  assert.equal(r.theses[0].gradedOutcome, "LOSS", "but not its server fields");
  assert.equal(r.theses[0].gradedR, -1);
  assert.equal(r.theses[0].copyCount, undefined);
  assert.deepEqual(save(prev, [], { v: 1, calls: {}, order: [] }).theses, [], "and a private call can be deleted");
  for (const k of SERVER_FIELDS) assert.ok(!(k in r.theses[0]) || prev[0][k] !== undefined, `${k} only from the stored copy`);
});

test("the timeline is append-only: new entries go on, stored ones can't be rewritten", () => {
  const { prev, reg } = published();
  const one = [{ at: NOW + H, kind: "NOTE", note: "holding" }];
  const withNote = save(prev, [{ ...prev[0], updates: one }], reg, NOW + 2 * H).theses;
  assert.deepEqual(withNote[0].updates, one);

  // An entry dated in the future is clamped to the server's clock.
  const future = save(withNote, [{ ...withNote[0], updates: [...one, { at: NOW + 99 * D, kind: "TRIM", sizePct: 50 }] }], reg, NOW + 3 * H).theses;
  assert.equal(future[0].updates[1].at, NOW + 3 * H);

  // Rewriting the stored note is refused: the stored timeline comes back.
  const rewrite = save(withNote, [{ ...withNote[0], updates: [{ ...one[0], note: "I sold the top" }] }], reg, NOW + 3 * H).theses;
  assert.deepEqual(rewrite[0].updates, one);
  // Dropping it too.
  assert.deepEqual(save(withNote, [{ ...withNote[0], updates: [] }], reg, NOW + 3 * H).theses[0].updates, one);
  // A made-up kind is skipped; a valid one after it still lands.
  const mixed = save(withNote, [{ ...withNote[0], updates: [...one, { at: NOW + 2 * H, kind: "DELETE_ME" }, { at: NOW + 2 * H, kind: "CLOSED" }] }], reg, NOW + 3 * H).theses;
  assert.deepEqual(mixed[0].updates.map((u) => u.kind), ["NOTE", "CLOSED"]);
});

test("mergeUpdates: never shrinks, never rewrites, clamps order", () => {
  const base = [{ at: 10, kind: "NOTE", note: "a" }];
  assert.deepEqual(mergeUpdates(base, [], 100), base);
  assert.deepEqual(mergeUpdates(base, undefined, 100), base);
  assert.deepEqual(mergeUpdates(base, [{ at: 10, kind: "NOTE", note: "b" }, { at: 20, kind: "NOTE", note: "c" }], 100), base);
  assert.deepEqual(mergeUpdates(base, [...base, { at: 5, kind: "NOTE", note: "c" }], 100).map((u) => u.at), [10, 10], "can't slot in before the last entry");
});

test("the owner's loss postmortem stays editable", () => {
  const { prev, reg } = published();
  const t = save(prev, [{ ...prev[0], lossReason: "stop_too_tight" }], reg, NOW + H).theses[0];
  assert.equal(t.lossReason, "stop_too_tight");
  assert.equal(save([t], [{ ...t, lossReason: undefined }], reg, NOW + 2 * H).theses[0].lossReason, "stop_too_tight", "omitted = unchanged");
  assert.equal(save([t], [{ ...t, lossReason: "" }], reg, NOW + 2 * H).theses[0].lossReason, undefined, "cleared on purpose");
});

test("a wallet with no registry is bootstrapped from what it has stored: legacy calls freeze as they are", () => {
  const stored = [call({ id: "old", isPublic: true, createdAt: NOW - 40 * D, gradedOutcome: "WIN", gradedR: 2 }), call({ id: "draft" })];
  const r = save(stored, [{ ...stored[0], stopLoss: 1 }, stored[1]], null, NOW);
  assert.deepEqual(r.bootstrapped, ["old"]);
  assert.ok(r.registryChanged);
  const t = r.theses[0];
  assert.equal(t.stopLoss, 95, "the first save after the lock can't move a legacy call either");
  assert.equal(t.createdAt, NOW - 40 * D, "a legacy call keeps its stored time (the server never saw it posted)");
  assert.equal(t.publishLegacy, true);
  assert.equal(t.gradedOutcome, "WIN", "its server fields ride along");
  assert.equal(readRegistry(r.registry).calls.old.legacy, true);
  assert.deepEqual(bootstrapRegistry([{ id: "x", isPublic: false }, { id: "x2", holdersOnly: true, isPublic: false }]).order, [], "only public calls");
});

test("a call another wallet already published can't be published here (the wallet-switch copy)", () => {
  const r = save([], [call({ id: "theirs", isPublic: true })], { v: 1, calls: {}, order: [] }, NOW, new Set(["theirs"]));
  assert.equal(r.theses[0].isPublic, false, "kept private in this wallet");
  assert.deepEqual(r.refused.map((x) => x.id), ["theirs"]);
  assert.equal(r.newlyPublished.length, 0);
  assert.equal(isPublished(r.registry, "theirs"), false);
});

test("publishCandidates: only ids this save would publish for the first time", () => {
  const { prev, reg } = published();
  const list = [prev[0], call({ id: "n1", isPublic: true }), call({ id: "n1", isPublic: true }), call({ id: "p", isPublic: false })];
  assert.deepEqual(publishCandidates(list, reg, prev), ["n1"]);
  assert.deepEqual(publishCandidates([call({ id: "old", isPublic: true })], null, [call({ id: "old", isPublic: true })]), [],
    "a legacy call bootstrapped on this save isn't a new publish");
});

test("one copy per id, and the cap on published calls", () => {
  const r = save([], [call({ id: "d" }), call({ id: "d", stopLoss: 1 })], { v: 1, calls: {}, order: [] });
  assert.equal(r.theses.length, 1);
  const full = { v: 1, calls: {}, order: [] };
  for (let i = 0; i < MAX_PUBLISHED; i++) { full.calls[`k${i}`] = { frozen: call({ id: `k${i}` }), publishedAt: NOW }; full.order.push(`k${i}`); }
  const capped = save([], [call({ id: "one-more", isPublic: true })], full);
  assert.equal(capped.refused[0].id, "one-more");
  assert.equal(capped.theses[0].isPublic, false);
});

test("registeredBy: the registry's own event, for this wallet, in a successful transaction", () => {
  // The contract's event isn't the ThesisRegistered(uint256,address) the Lab's ABI declared: a check
  // pinned to that hash refused every real registration. Any signature, read by its layout.
  const TOPIC = "0x" + bytesToHex(keccak_256(utf8ToBytes("ThesisRegistered(uint256,address,string)")));
  const REG = "0x2F4EdA890f96a7979d6f26bCB210cEDAD68346Bc", ME = "0x" + "ab".repeat(20), OTHER = "0x" + "cd".repeat(20);
  const pad = (a) => "0x" + "0".repeat(24) + a.slice(2);
  const log = (over = {}) => ({ address: REG, topics: [TOPIC, "0x" + "0".repeat(63) + "7", pad(ME)], ...over });
  const rc = (logs, status = "0x1") => ({ status, logs, from: "0x" + "99".repeat(20) }); // relayed: `from` is someone else
  assert.equal(registeredBy(rc([log()]), REG, ME), true, "a relayed (smart-account) registration still proves the wallet");
  assert.equal(registeredBy(rc([log({ topics: ["0x" + "11".repeat(32), "0x7", pad(ME)] })]), REG, ME), true, "whatever the event's signature");
  assert.equal(registeredBy(rc([log()]), REG.toLowerCase(), ME.toUpperCase().replace("0X", "0x")), true, "case doesn't matter");
  assert.equal(registeredBy(rc([log()]), REG, OTHER), false, "someone else's registration");
  assert.equal(registeredBy(rc([log()], "0x0"), REG, ME), false, "a failed transaction");
  assert.equal(registeredBy(rc([log({ address: OTHER })]), REG, ME), false, "another contract's event");
  assert.equal(registeredBy(rc([log({ topics: [TOPIC, pad(ME)] })]), REG, ME), false, "an event without an indexed trader");
  assert.equal(registeredBy(null, REG, ME), false);
  assert.equal(registeredBy(rc([log()]), REG, "not-an-address"), false);
});

test("a public call without an id is never dropped from the record: it stays, private", () => {
  const r = save([], [{ symbol: "BTC", direction: "LONG", isPublic: true, stopLoss: 1 }, call({ id: "ok" })], { v: 1, calls: {}, order: [] });
  assert.equal(r.theses.length, 2);
  assert.equal(r.theses[0].isPublic, false);
  assert.equal(r.theses[0].stopLoss, 1);
  assert.equal(r.refused[0].reason, "a published call needs an id");
});
