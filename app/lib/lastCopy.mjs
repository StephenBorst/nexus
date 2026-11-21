// ── The last copy, kept on this device (2026-11-21, speed: draw at once, then refresh) ────────────────────────────────
// The Wire and the market table keep the last board they read in localStorage and draw it on mount, before the network
// answers, so Lab home opens with content instead of "Reading…". The live read replaces it seconds later. Honest by
// construction: every stored board carries its own `builtAt` and the screen prints that age ("updated 12m ago"), so an
// older copy reads as older, never as now. A copy older than `maxAgeMs` (6h) isn't drawn. Storage failing (private mode,
// full, blocked) = no copy, never an error. Pure apart from the injected storage; tested (lastCopy.test.mjs).

export const LAST_COPY_MAX_AGE_MS = 6 * 3600_000;

const store = (s) => s ?? (typeof localStorage !== "undefined" ? localStorage : null);

/**
 * The stored board if it's younger than maxAgeMs and passes `valid`, else null.
 * @param {string} key
 * @param {{ now?: number, maxAgeMs?: number, valid?: (b: any) => boolean, storage?: any }} [o]
 * @returns {any}
 */
export function readLastCopy(key, { now = Date.now(), maxAgeMs = LAST_COPY_MAX_AGE_MS, valid = (_b) => true, storage } = {}) {
  try {
    const raw = store(storage)?.getItem(key);
    if (!raw) return null;
    const body = JSON.parse(raw);
    if (!body || !Number.isFinite(body.builtAt) || now - body.builtAt > maxAgeMs || body.builtAt > now + 60_000 || !valid(body)) return null;
    return body;
  } catch { return null; }
}

/**
 * Keep a board that passes `valid` (never an empty or error reply).
 * @param {string} key
 * @param {any} body
 * @param {{ valid?: (b: any) => boolean, storage?: any }} [o]
 * @returns {boolean}
 */
export function writeLastCopy(key, body, { valid = (_b) => true, storage } = {}) {
  try {
    if (!body || !Number.isFinite(body.builtAt) || !valid(body)) return false;
    store(storage)?.setItem(key, JSON.stringify(body));
    return true;
  } catch { return false; }
}
