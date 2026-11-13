// ── Why a flat agent isn't trading: the brain's last check, in one line (borst 2026-11-14) ─────────────
// The brain writes the sit-out reasons into agent:signal when no market fires (brain logic.mjs quietReason,
// 2026-11-13): "no signal · 11 of 11 markets: no extreme 4h move on falling OI this hour". Nothing showed it, so a
// quiet wallet and a dead one looked the same. This turns the stored signal into the line the agent card
// (AgentView) and the paper run page (/proof/paper/:axis, via GET /signals/paper-run/:axis) print.
//
// Display only. A signal older than BRAIN_STALE_MS says so instead of passing an old check off as current: the brain
// runs every 5 minutes, so 20 minutes without a check means it is down or skipping this wallet.

export const BRAIN_STALE_MS = 20 * 60_000;
const MAX_LEN = 240;

const clean = (s) => Array.from(String(s ?? ""), (ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("").replace(/\s+/g, " ").trim();

/**
 * @param {object|null} signal agent:signal as the brain wrote it (or state.last_signal from GET /agent/:a)
 * @param {number} [now]
 * @returns {null | { text: string, checkedAt: number, ageMin: number, stale: boolean }}
 *   null = nothing to say (no signal stored, or the brain DID pick a market: the card shows that instead)
 */
export function quietLine(signal, now = Date.now()) {
  if (!signal || typeof signal !== "object") return null;
  if (signal.direction && signal.direction !== "NONE") return null;
  const at = Number(signal.timestamp);
  if (!Number.isFinite(at) || at <= 0) return null;
  const ageMin = Math.max(0, Math.floor((now - at) / 60_000));
  const stale = now - at > BRAIN_STALE_MS;
  let text = clean(signal.reason) || "no signal";
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
  return { text, checkedAt: at, ageMin, stale };
}

/** "checked 3 min ago" · "no check for 47 min: the brain may be down" */
export function quietAgeText(q) {
  if (!q) return "";
  const age = q.ageMin < 1 ? "just now" : q.ageMin < 120 ? `${q.ageMin} min ago` : `${Math.floor(q.ageMin / 60)} h ago`;
  return q.stale ? `last check ${age}: the brain may be down` : `checked ${age}`;
}
