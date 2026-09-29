// Run: node --test app/lib/labCache.test.mjs
// One device copy per wallet (labCache.mjs). The bug these pin: the Lab kept one copy for the whole
// browser, so a second wallet's first save pushed the first wallet's calls into its record.
import test from "node:test";
import assert from "node:assert/strict";
import {
  readTheses, writeTheses, readNotes, writeNote, ensureWalletCache,
  thesesKey, GUEST_THESES_KEY, GUEST_BACKUP_KEY,
} from "./labCache.mjs";

// A Storage-like map (localStorage's interface).
function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}
const A = "0x" + "aa".repeat(20), B = "0x" + "bb".repeat(20);

test("two wallets on one device never see each other's calls", () => {
  const s = storage();
  writeTheses(s, A, [{ id: "a1", isPublic: true }, { id: "a2" }]);
  assert.deepEqual(readTheses(s, B), [], "B starts empty, not with A's calls");
  writeTheses(s, B, [{ id: "b1" }]);
  assert.deepEqual(readTheses(s, A).map((t) => t.id), ["a1", "a2"]);
  assert.deepEqual(readTheses(s, B).map((t) => t.id), ["b1"]);
  writeNote(s, A, "2026-09-29", "A's day");
  assert.deepEqual(readNotes(s, B), {});
  assert.deepEqual(readNotes(s, A), { "2026-09-29": "A's day" });
});

test("the old shared copy: the first wallet takes its private drafts and notes, once; published calls stay out", () => {
  const legacy = [{ id: "draft", stopLoss: 1 }, { id: "pub", isPublic: true }, { id: "held", holdersOnly: true, isPublic: false }, { notAnId: 1 }];
  const s = storage({ [GUEST_THESES_KEY]: JSON.stringify(legacy), "lab_note_2026-09-01": "old note" });
  assert.deepEqual(readTheses(s, A).map((t) => t.id), ["draft", "held"], "only private drafts (and holders-only drafts) move in");
  assert.deepEqual(readNotes(s, A), { "2026-09-01": "old note" });
  // The guest copy is emptied (a backup is kept), so the next wallet takes nothing.
  assert.equal(s.getItem(GUEST_THESES_KEY), "[]");
  assert.equal(s.getItem("lab_note_2026-09-01"), null);
  assert.deepEqual(JSON.parse(s.getItem(GUEST_BACKUP_KEY)).map((t) => t.id), ["draft", "pub", "held", undefined]);
  assert.deepEqual(readTheses(s, B), []);
  assert.deepEqual(readNotes(s, B), {});
});

test("the move happens once: a wallet that already has a copy never takes the guest's again", () => {
  const s = storage({ [thesesKey(A)]: JSON.stringify([{ id: "mine" }]) });
  writeTheses(s, "", [{ id: "guest-draft" }]);                 // drafted later with no wallet connected
  assert.equal(ensureWalletCache(s, A), false);
  assert.deepEqual(readTheses(s, A).map((t) => t.id), ["mine"]);
  assert.deepEqual(readTheses(s, B).map((t) => t.id), ["guest-draft"], "a wallet new to this device takes it");
  assert.equal(s.getItem(GUEST_BACKUP_KEY), JSON.stringify([{ id: "guest-draft" }]));
});

test("no wallet = the guest copy; garbage in a copy never throws", () => {
  const s = storage({ [GUEST_THESES_KEY]: "{not json", "lab_note_x": "n" });
  assert.deepEqual(readTheses(s, ""), []);
  assert.deepEqual(readNotes(s, ""), { x: "n" });
  writeTheses(s, "", [{ id: "g" }]);
  assert.deepEqual(readTheses(s, "").map((t) => t.id), ["g"]);
  assert.equal(ensureWalletCache(s, ""), false);
});
