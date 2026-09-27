// ── Paid sim runs outlive the card that started them ─────────────────────────────────────────
// A MiroShark run costs the user a credit and takes minutes. Its status URL lived only in the
// card's React state, so leaving the page, switching coin in the composer (which remounts the
// card) or a slow run lost a report someone paid for, and "check back" had nowhere to check.
// The run is now kept per wallet + scenario for a day; reopening the card resumes the poll.

export const SIM_RUN_TTL_MS = 24 * 3600 * 1000;

// The scenario's identity, not its live numbers: bodies carry mark price, funding and crowd odds
// that tick, and a key built from those would lose the run on the next refresh. The label keeps
// a fade sim and a pressure-test on the same coin apart.
export function simRunKey(wallet, label, body) {
  if (!wallet) return null;
  const b = body || {};
  const id = b.kind === "macro" ? `macro:${b.question}` : b.kind === "thesis" ? `thesis:${b.coin}:${b.direction}` : `q:${b.query ?? ""}`;
  let h = 5381;
  for (const ch of `${label}|${id}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return `nx_sim_run:${String(wallet).toLowerCase()}:${(h >>> 0).toString(36)}`;
}

export function loadSimRun(storage, key, now = Date.now()) {
  if (!key || !storage) return null;
  try {
    const r = JSON.parse(storage.getItem(key) || "null");
    return r && typeof r.statusUrl === "string" && Number.isFinite(r.startedAt) && now - r.startedAt < SIM_RUN_TTL_MS ? r : null;
  } catch { return null; }
}

// Private mode / full storage: the run still works, it just won't resume.
export function saveSimRun(storage, key, run) {
  if (!key || !storage) return;
  try { storage.setItem(key, JSON.stringify(run)); } catch { /* best-effort */ }
}
