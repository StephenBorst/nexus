// ── Merging a device's Lab with the server's copy ─────────────────────────────────────────────
// The Lab keeps a local cache and a server record. Two merges, with opposite winners:
//
// • ON OPEN (mergeOnOpen): the server copy wins. The local cache may be stale; anything only this
//   device has (a call made offline) is kept.
//
// • BEFORE THE FIRST SAVE of a session (foldInBeforeSave): the device wins. The user just edited, so
//   their edits stand, and anything only the server has (private calls saved from another device) is
//   added back. That second half is the point: a page opened without a signature only sees the PUBLIC
//   view, and writing that back would drop every private call held elsewhere. Calls deleted on this
//   device this session ("tombstones") are NOT added back, or a delete would undo itself.
//
// Notes are a day → text map: a key only one side has is kept; on a clash the winning side's text
// stands (an emptied note is text too, so a cleared note stays cleared).

const ids = (list) => new Set(list.map((t) => t && t.id).filter(Boolean));
const asList = (x) => (Array.isArray(x) ? x.filter((t) => t && t.id) : []);
const asNotes = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

export function mergeOnOpen(local, remote) {
  const r = asList(remote?.theses), have = ids(r);
  return {
    theses: [...r, ...asList(local?.theses).filter((t) => !have.has(t.id))],
    notes: { ...asNotes(local?.notes), ...asNotes(remote?.notes) },
  };
}

export function foldInBeforeSave(local, remote, tombstones = new Set()) {
  const l = asList(local?.theses), have = ids(l);
  return {
    theses: [...l, ...asList(remote?.theses).filter((t) => !have.has(t.id) && !tombstones.has(t.id))],
    notes: { ...asNotes(remote?.notes), ...asNotes(local?.notes) },
  };
}

/** Ids present before a save and gone after it: this device deleted them. */
export function removedIds(before, after) {
  const keep = ids(asList(after));
  return asList(before).map((t) => t.id).filter((id) => !keep.has(id));
}
