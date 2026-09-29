// Run: node --test app/lib/labMerge.test.mjs
// The merge rules that decide whether a save can lose a call. See labMerge.mjs for the why.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeOnOpen, foldInBeforeSave, removedIds, withServerPublished } from "./labMerge.mjs";

const t = (id, extra = {}) => ({ id, ...extra });

test("on open: the server copy wins a clash; device-only calls are kept", () => {
  const local = { theses: [t("a", { v: "stale" }), t("offline")], notes: { d1: "local", d2: "only here" } };
  const remote = { theses: [t("a", { v: "server" }), t("b")], notes: { d1: "server" } };
  const m = mergeOnOpen(local, remote);
  assert.deepEqual(m.theses, [t("a", { v: "server" }), t("b"), t("offline")]);
  assert.deepEqual(m.notes, { d1: "server", d2: "only here" });
});

test("first save: the device wins, and private calls only the server holds come back", () => {
  const local = { theses: [t("pub", { v: "just edited" })], notes: { d1: "edited" } };
  // The full record: a private call saved from another device + the public one at its old value.
  const remote = { theses: [t("pub", { v: "old" }), t("priv-other-device", { isPublic: false })], notes: { d1: "old", d0: "journal" } };
  const m = foldInBeforeSave(local, remote);
  assert.deepEqual(m.theses, [t("pub", { v: "just edited" }), t("priv-other-device", { isPublic: false })], "nothing the server holds is dropped");
  assert.deepEqual(m.notes, { d1: "edited", d0: "journal" });
});

test("first save: a call deleted on this device stays deleted", () => {
  const local = { theses: [t("keep")], notes: {} };
  const remote = { theses: [t("keep"), t("deleted-here"), t("from-elsewhere")], notes: {} };
  const m = foldInBeforeSave(local, remote, new Set(["deleted-here"]));
  assert.deepEqual(m.theses.map((x) => x.id), ["keep", "from-elsewhere"]);
});

test("a cleared note stays cleared (empty text is still the device's answer)", () => {
  assert.equal(foldInBeforeSave({ theses: [], notes: { d: "" } }, { theses: [], notes: { d: "old" } }).notes.d, "");
});

test("garbage in either copy never throws and never invents calls", () => {
  for (const [a, b] of [[null, null], [{}, { theses: "x", notes: [] }], [{ theses: [null, { nope: 1 }] }, undefined]]) {
    assert.deepEqual(mergeOnOpen(a, b), { theses: [], notes: {} });
    assert.deepEqual(foldInBeforeSave(a, b), { theses: [], notes: {} });
  }
});

test("removedIds: what a save took away", () => {
  assert.deepEqual(removedIds([t("a"), t("b"), t("c")], [t("a"), t("c"), t("new")]), ["b"]);
  assert.deepEqual(removedIds([], [t("a")]), []);
  assert.deepEqual(removedIds(null, undefined), []);
});

test("after a save: the server's published calls win, deleted ones come back, refused ones go private", () => {
  const local = [
    { id: "pub", isPublic: true, stopLoss: 1, createdAt: 5 },          // edited here after publishing
    { id: "new", isPublic: true, createdAt: 9 },                       // just published from this device
    { id: "theirs", isPublic: true },                                  // another wallet published it first
    { id: "draft", isPublic: false, stopLoss: 7 },
  ];
  const response = {
    published: [
      { id: "pub", isPublic: true, stopLoss: 95, createdAt: 2 },
      { id: "new", isPublic: true, createdAt: 1000 },                   // the server's post time
      { id: "gone", isPublic: true },                                   // deleted here: it's back
    ],
    refused: [{ id: "theirs", reason: "another wallet already published this call" }],
  };
  const { theses, changed } = withServerPublished(local, response);
  assert.equal(changed, true);
  assert.deepEqual(theses.map((t) => t.id), ["pub", "new", "theirs", "draft", "gone"]);
  assert.equal(theses[0].stopLoss, 95);
  assert.equal(theses[1].createdAt, 1000);
  assert.equal(theses[2].isPublic, false);
  assert.equal(theses[3].stopLoss, 7, "private calls are the device's");
});

test("after a save: a timeline note typed during the save is kept; an old worker's { ok } changes nothing", () => {
  const note = { at: 1, kind: "NOTE", note: "a" }, note2 = { at: 2, kind: "NOTE", note: "b" };
  const { theses } = withServerPublished([{ id: "p", isPublic: true, updates: [note, note2] }], { published: [{ id: "p", isPublic: true, updates: [note] }] });
  assert.deepEqual(theses[0].updates, [note, note2]);
  const same = [{ id: "x" }];
  assert.deepEqual(withServerPublished(same, { ok: true }), { theses: same, changed: false });
  assert.deepEqual(withServerPublished(same, null), { theses: same, changed: false });
});
