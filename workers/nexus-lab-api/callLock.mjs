// ── Published calls are permanent ─────────────────────────────────────────────────────────────
// Product rule (borst, 2026-09-28): once a call is published it is published, like a post onchain.
// It can't be deleted, hidden from the feed, backdated, or have its levels moved, and its grade is
// written by the server only.
//
// The first time a save makes a call public, the server REGISTERS it in `callreg:{address}`, a key
// only the server writes: its own clock becomes the call's createdAt (the time it was posted) and
// the call as saved becomes the frozen copy. From then on every write to that wallet's Lab record
// goes through sealTheses(), which rebuilds each published call from the registry, whatever the
// save sent. Before this, the Lab record held whatever the client saved last: a caller could post a
// call dated last week, move a stop after the fact (the board re-grades the stored levels), delete
// or un-publish a loser, or write "WIN" onto their own call.
//
// What the owner can still change on a published call (neither touches the grade):
//   • `updates`, the lifecycle timeline, APPEND-ONLY: the stored entries must come back unchanged,
//     and new entries are re-checked by lifecycle.appendUpdate with the server clock as the ceiling;
//   • `lossReason`, the owner's own postmortem tag (private introspection, never graded).
// Everything else is the frozen copy, plus fields only the server writes (SERVER_FIELDS) and a
// status derived from the server's grade.
//
// Pure: the caller does the KV reads/writes. Tested in callLock.test.mjs.
import { appendUpdate, MAX_UPDATES } from "../../app/lib/lifecycle.mjs";

export const REGISTRY_KEY = (address) => `callreg:${address}`;
export const MAX_PUBLISHED = 2000;          // per wallet; a publish past this stays private
const MAX_LOSS_REASON = 40;

/** Fields only the server writes. A client save can't set them on ANY call, published or not. */
export const SERVER_FIELDS = [
  "gradedOutcome", "gradedR", "gradedAt", "gradeV",
  "planScore", "planFlags", "regimeTrend", "regimeVol", "regimeAlign",
  "copyCount", "publishedAt", "publishLegacy",
];
/** The only fields the owner may still change on a published call. */
export const OWNER_FIELDS = ["updates", "lossReason"];
const NOT_FROZEN = new Set([...SERVER_FIELDS, ...OWNER_FIELDS, "status", "isPublic", "holdersOnly"]);

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A valid registry, or null. */
export function readRegistry(raw) {
  try {
    const r = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isObj(r) && r.v === 1 && isObj(r.calls) && Array.isArray(r.order) ? r : null;
  } catch { return null; }
}

/** The frozen copy of a call: everything it was published with, minus what isn't frozen. */
function freeze(t) {
  const out = {};
  for (const [k, v] of Object.entries(clone(t))) if (!NOT_FROZEN.has(k)) out[k] = v;
  return out;
}

/**
 * The registry for a wallet that has none yet: every call already public in its stored record,
 * frozen as it is now. Their createdAt can't be checked (it was client-written), so they are
 * marked `legacy`; everything published from here on carries the server's own time.
 */
export function bootstrapRegistry(prevTheses) {
  const reg = { v: 1, calls: {}, order: [] };
  for (const t of Array.isArray(prevTheses) ? prevTheses : []) {
    if (!isObj(t) || t.isPublic !== true || !validId(t.id) || reg.calls[t.id]) continue;
    // A legacy call keeps the visibility it had (a few old records are public AND holders-only:
    // graded, but shown only in the Holders Room). Nothing new can be published that way.
    reg.calls[t.id] = { frozen: freeze(t), publishedAt: Number(t.createdAt) || null, legacy: true, ...(t.holdersOnly === true ? { holdersOnly: true } : {}) };
    reg.order.push(t.id);
  }
  return reg;
}

/** Only the timeline's stored entries, unchanged, plus valid new ones (server clock as ceiling). */
export function mergeUpdates(stored, incoming, now) {
  const base = Array.isArray(stored) ? stored : [];
  if (!Array.isArray(incoming) || incoming.length <= base.length) return base;
  for (let i = 0; i < base.length; i++) {
    if (JSON.stringify(incoming[i]) !== JSON.stringify(base[i])) return base; // a rewrite: refused
  }
  let acc = base;
  for (const e of incoming.slice(base.length)) {
    if (acc.length >= MAX_UPDATES || !isObj(e)) break;
    const at = Math.min(Number.isFinite(Number(e.at)) ? Number(e.at) : now, now);
    const r = appendUpdate({ updates: acc }, e, at);
    if (r.ok) acc = r.updates;
  }
  return acc;
}

function ownerLossReason(stored, incoming) {
  if (incoming === undefined || incoming === null || incoming === "") return incoming === undefined ? stored : undefined;
  return typeof incoming === "string" && incoming.length <= MAX_LOSS_REASON ? incoming : stored;
}

const statusFromGrade = (o) => (o === "WIN" ? "HIT_TP" : o === "LOSS" ? "STOPPED_OUT" : "ACTIVE");

function serverFieldsOf(t) {
  const out = {};
  if (isObj(t)) for (const k of SERVER_FIELDS) if (t[k] !== undefined) out[k] = t[k];
  return out;
}

/** A published call as every reader sees it: frozen copy + server fields + the owner's two fields. */
function publishedView(entry, stored, incoming, now) {
  const view = {
    ...clone(entry.frozen),
    ...serverFieldsOf(stored),
    isPublic: true,
    holdersOnly: entry.holdersOnly === true,
    publishedAt: entry.publishedAt,
  };
  if (entry.legacy) view.publishLegacy = true; else delete view.publishLegacy;
  const updates = mergeUpdates(stored?.updates, incoming ? incoming.updates : undefined, now);
  if (updates.length) view.updates = updates;
  const lr = ownerLossReason(stored?.lossReason, incoming ? incoming.lossReason : undefined);
  if (lr !== undefined) view.lossReason = lr;
  view.status = statusFromGrade(view.gradedOutcome);
  return view;
}

/**
 * Seal a save: rebuild every published call from the registry, register the calls this save
 * publishes, and keep server fields server-owned.
 *
 * @param {{ prev: object[], incoming: object[], registry: object|null, now: number,
 *            ownedElsewhere?: Set<string> }} p
 *   prev: the stored theses before this save · incoming: what the save sends (the client's list,
 *   or a server writer's) · registry: callreg, or null for a wallet that has none yet ·
 *   ownedElsewhere: ids another wallet already published (callowner index). Those can't be
 *   published here: the Lab's cache used to carry one wallet's calls into the next wallet it
 *   connected, and a lock would make every such copy permanent.
 * @returns {{ theses: object[], registry: object, registryChanged: boolean, bootstrapped: string[],
 *             newlyPublished: object[], refused: {id:string, reason:string}[], restored: string[] }}
 */
export function sealTheses({ prev, incoming, registry, now, ownedElsewhere = new Set() }) {
  const prevList = Array.isArray(prev) ? prev.filter(isObj) : [];
  let reg = readRegistry(registry);
  let registryChanged = false, bootstrapped = [];
  if (!reg) { reg = bootstrapRegistry(prevList); registryChanged = true; bootstrapped = [...reg.order]; }
  const prevById = new Map(prevList.filter((t) => validId(t.id)).map((t) => [t.id, t]));

  const out = [], seen = new Set(), newlyPublished = [], refused = [];
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (!isObj(t)) continue;
    const id = t.id;
    if (validId(id) && seen.has(id)) continue;            // one copy per id
    if (validId(id)) seen.add(id);

    const entry = validId(id) ? reg.calls[id] : null;
    if (entry) { out.push(publishedView(entry, prevById.get(id), t, now)); continue; }

    if (t.isPublic === true) {
      if (!validId(id)) {
        // Can't be locked without an id: kept in the record (never dropped), as a private call.
        refused.push({ id: String(id), reason: "a published call needs an id" });
        out.push({ ...stripServer(t), isPublic: false });
        continue;
      }
      const why = ownedElsewhere.has(id) ? "another wallet already published this call"
        : reg.order.length >= MAX_PUBLISHED ? `this wallet has ${MAX_PUBLISHED} published calls, the most one wallet can hold`
        : null;
      if (why) {
        refused.push({ id, reason: why });
        out.push({ ...stripServer(t), ...serverFieldsOf(prevById.get(id)), isPublic: false });
        continue;
      }
      // The first publish: the server's clock is the post time; what the client said is kept for reference.
      const frozen = freeze(t);
      frozen.clientCreatedAt = t.createdAt;
      frozen.createdAt = now;
      reg.calls[id] = { frozen, publishedAt: now };
      reg.order.push(id);
      registryChanged = true;
      const view = publishedView(reg.calls[id], null, t, now);
      out.push(view);
      newlyPublished.push(view);
      continue;
    }

    // Private (or holders-only, which the board never grades): the owner's own, except server fields.
    out.push({ ...stripServer(t), ...serverFieldsOf(validId(id) ? prevById.get(id) : null) });
  }

  // Published calls the save left out (deleted, or an old tab's copy) come back as they were.
  const restored = [];
  for (const id of reg.order) {
    if (seen.has(id)) continue;
    out.push(publishedView(reg.calls[id], prevById.get(id), null, now));
    restored.push(id);
  }
  return { theses: out, registry: reg, registryChanged, bootstrapped, newlyPublished, refused, restored };
}

function stripServer(t) {
  const out = { ...t };
  for (const k of SERVER_FIELDS) delete out[k];
  return out;
}

/**
 * The ids a save would publish for the first time (the ones whose owner index must be checked). A
 * wallet with no registry yet is bootstrapped from its stored record first, so those aren't new.
 */
export function publishCandidates(incoming, registry, prev) {
  const reg = readRegistry(registry) || bootstrapRegistry(prev);
  const out = [];
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (isObj(t) && t.isPublic === true && validId(t.id) && !reg?.calls?.[t.id] && !out.includes(t.id)) out.push(t.id);
  }
  return out;
}

export const OWNER_KEY = (id) => `callowner:${id}`;

/** Is this id a published call in the registry? (The delete route refuses those.) */
export const isPublished = (registry, id) => !!(readRegistry(registry)?.calls?.[id]);

// ThesisRegistered(uint256 indexed thesisId, address indexed trader): keccak256 of the signature
// (pinned; callLock.test.mjs recomputes it).
export const THESIS_REGISTERED_TOPIC = "0x479428a822b44ba9e2a872760d476bb00801bcf1f5cdd1b778afda41a4882998";

/**
 * Did this receipt register a thesis on the registry FOR `wallet`? The event's `trader` is the
 * registry's msg.sender, so this holds for a plain wallet and a smart-account wallet alike (a
 * relayed transaction's `from` is the relayer, not the wallet). The Bankr thesis route needs it:
 * the address it writes to arrives in the request body.
 */
export function registeredBy(receipt, registryAddress, wallet) {
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return false;
  const reg = String(registryAddress || "").toLowerCase(), who = String(wallet || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(who)) return false;
  return receipt.logs.some((l) => l && String(l.address || "").toLowerCase() === reg
    && Array.isArray(l.topics) && l.topics.length >= 3
    && String(l.topics[0]).toLowerCase() === THESIS_REGISTERED_TOPIC
    && ("0x" + String(l.topics[2]).slice(-40)).toLowerCase() === who);
}
