// ── The Lab's device copy, one per wallet ─────────────────────────────────────────────────────
// The Lab keeps a copy of a wallet's calls and journal on the device so it opens instantly and
// works before a signature. It used to keep ONE copy for the whole browser: connect wallet B after
// wallet A, and B's first save pushed A's calls into B's record. On 2026-09-28 the public feed held
// 114 such copies across 8 wallets (the double-count). Now every wallet has its own copy. The old
// shared keys are the GUEST copy (no wallet connected).
//
// Pure over a Storage-like object (getItem/setItem/removeItem/key/length) so it's testable in node.

export const GUEST_THESES_KEY = "lab_thesis_trades";
export const GUEST_NOTE_PREFIX = "lab_note_";
export const GUEST_BACKUP_KEY = "lab_thesis_trades:guest-backup";
export const thesesKey = (addr) => (addr ? `lab_thesis_trades:${addr}` : GUEST_THESES_KEY);
export const notePrefix = (addr) => (addr ? `lab_note:${addr}:` : GUEST_NOTE_PREFIX);

function parseList(raw) {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((t) => t && typeof t === "object") : []; } catch { return []; }
}

function keysWithPrefix(storage, prefix) {
  const out = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) out.push(k); }
  return out;
}

/**
 * A wallet's first session on this device (its copy doesn't exist yet): it takes the guest copy's
 * PRIVATE drafts and journal notes, once. The guest copy is where every wallet's calls used to
 * live, so its PUBLISHED calls belong to whichever wallet published them: they're never taken here
 * (they come back from that wallet's own server record). The guest copy is then emptied so a second
 * wallet can't take the same drafts; the first backup of it is kept under GUEST_BACKUP_KEY.
 * @returns {boolean} whether this call created the wallet's copy
 */
export function ensureWalletCache(storage, addr) {
  if (!addr || storage.getItem(thesesKey(addr)) !== null) return false;
  const guest = parseList(storage.getItem(GUEST_THESES_KEY));
  storage.setItem(thesesKey(addr), JSON.stringify(guest.filter((t) => t.id && t.isPublic !== true)));
  const noteKeys = keysWithPrefix(storage, GUEST_NOTE_PREFIX);
  for (const k of noteKeys) storage.setItem(notePrefix(addr) + k.slice(GUEST_NOTE_PREFIX.length), storage.getItem(k) || "");
  for (const k of noteKeys) storage.removeItem(k);
  if (guest.length) {
    if (storage.getItem(GUEST_BACKUP_KEY) === null) storage.setItem(GUEST_BACKUP_KEY, JSON.stringify(guest));
    storage.setItem(GUEST_THESES_KEY, "[]");
  }
  return true;
}

export function readTheses(storage, addr) {
  ensureWalletCache(storage, addr);
  return parseList(storage.getItem(thesesKey(addr)));
}

export function writeTheses(storage, addr, list) {
  storage.setItem(thesesKey(addr), JSON.stringify(Array.isArray(list) ? list : []));
}

export function readNotes(storage, addr) {
  ensureWalletCache(storage, addr);
  const prefix = notePrefix(addr), out = {};
  for (const k of keysWithPrefix(storage, prefix)) out[k.slice(prefix.length)] = storage.getItem(k) || "";
  return out;
}

export function writeNote(storage, addr, day, text) {
  storage.setItem(notePrefix(addr) + day, String(text ?? ""));
}
