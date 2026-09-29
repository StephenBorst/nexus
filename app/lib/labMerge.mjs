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

// • AFTER A SAVE (withServerPublished): the server wins on every PUBLISHED call. Published calls
//   are permanent (workers/nexus-lab-api/callLock.mjs): the server keeps the post time it stamped,
//   the levels as published and the grade, and answers each save with those calls. The device takes
//   them as they are, gets back any it tried to delete or hide, and a call the server refused to
//   publish (another wallet published it first) goes back to private here. One exception: a timeline
//   note typed while the save was in flight is kept, and the next save sends it.
export function withServerPublished(local, response) {
  const list = asList(local);
  const pub = new Map(asList(response && response.published).map((t) => [t.id, t]));
  const refused = new Set((Array.isArray(response && response.refused) ? response.refused : []).map((r) => r && r.id).filter(Boolean));
  if (!pub.size && !refused.size) return { theses: list, changed: false };
  const seen = new Set();
  const theses = list.map((t) => {
    seen.add(t.id);
    const server = pub.get(t.id);
    if (server) {
      const mine = Array.isArray(t.updates) ? t.updates : [];
      const theirs = Array.isArray(server.updates) ? server.updates : [];
      return mine.length > theirs.length ? { ...server, updates: mine } : server;
    }
    return refused.has(t.id) ? { ...t, isPublic: false } : t;
  });
  for (const [id, t] of pub) if (!seen.has(id)) theses.push(t);
  return { theses, changed: true };
}
