// The Lab pulse: how many public calls are live right now and how many the grader scored this week,
// people and our engine callers counted SEPARATELY. One rule for the server (`GET /calls/pulse`, lab-api
// routes-pulse.mjs), the app's strip (LabPulseChip.tsx) and the Lab home Calls panel (LabCallsPanel.tsx).
// The landing page mirrors `pulseLine` by hand (nexus-landing index.html). Display only: nothing here
// grades a call or changes a stamp.
//
// What counts (borst, 2026-11-05: "split, named"):
//   - a PUBLIC call: isPublic, not holders-only, not a marked copy (`duplicateOf`), same as isPublicCall;
//   - house callers (HOUSE_CALLER_ADDRESS, HOUSE_CATALYST_ADDRESS) are left out entirely (`exclude`): both are
//     off, and their old calls are neither a person nor an engine on the record;
//   - ENGINES = our bot callers (worker var ENGINE_CALLER_ADDRESSES: Engine A, Engine B "Ember", the Engine B
//     variant). Counted in their own block, never mixed into the people's numbers. Agent trades never get
//     here (they live in agent:feed:, not lab:);
//   - OPEN = the entry traded and the call isn't graded (callLifecycle "OPEN"). A resting order that never
//     filled isn't a position, so it isn't counted: it could sit unfilled forever and pad the number.
//   - GRADED THIS WEEK = a current grader stamp (WIN or LOSS) whose resolution (`exitedAt`, else
//     `gradedAt`) falls in the last 7 days.
// Top-level fields are PEOPLE (so a reader that only knows the old shape shows people, never bots as people);
// `engines` carries the same fields for the engine wallets. `last` = the most recent graded call of all time
// (a quiet week still reads true: "last graded 21d ago"). Lists = the newest few (PULSE_LIST_MAX), each row
// tagged `engine` and carrying its `wallet` so the server can attach the caller's display name.

import { callLifecycle } from "./callLifecycle.mjs";

export const PULSE_WINDOW_MS = 7 * 86400000;
export const PULSE_LIST_MAX = 3;

const bare = (s) => {
  const m = /^PERP_([^_]+)_USDC(?:_.*)?$/.exec(String(s || ""));
  return (m ? m[1] : String(s || "").replace("PERP_", "").replace("_USDC", "")).toUpperCase();
};
const isPublic = (t) => !!t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf;
const isGraded = (t) => t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS";
const addrSet = (list) => new Set((list || []).flatMap((a) => String(a || "").split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean));

const emptyBlock = () => ({ open: 0, gradedWeek: 0, graded: [], opened: [] });
const finish = (b) => {
  b.graded.sort((x, y) => y.at - x.at);
  b.opened.sort((x, y) => y.at - x.at);
  return { open: b.open, gradedWeek: b.gradedWeek, last: b.graded[0] || null, openCalls: b.opened.slice(0, PULSE_LIST_MAX), recentGraded: b.graded.slice(0, PULSE_LIST_MAX) };
};

/**
 * @param {Array<{wallet:string, theses:object[]}>} records one entry per lab:{wallet}
 * @param {number} now ms
 * @param {{ exclude?: string[], engines?: string[], isCurrent?: (t:object)=>boolean }} [opts]
 *   exclude   wallets left out entirely (the house callers), any case; comma-separated strings are split
 *   engines   our engine callers' wallets, counted in `engines`, never in the people's numbers
 *   isCurrent the grader's "stamp is current" check (grading.mjs isCurrentStamp); a stale stamp counts nowhere
 * @returns {PulseBlock & { engines: PulseBlock }}
 * @typedef {{ open:number, gradedWeek:number, last: PulseGraded|null, openCalls: PulseOpen[], recentGraded: PulseGraded[] }} PulseBlock
 * @typedef {{ symbol:string, direction:string, at:number, path:string, wallet:string, engine:boolean }} PulseOpen
 * @typedef {PulseOpen & { outcome:"WIN"|"LOSS", r:number|null }} PulseGraded
 */
export function callPulse(records, now, opts = {}) {
  const exclude = addrSet(opts.exclude);
  const engineSet = addrSet(opts.engines);
  const isCurrent = typeof opts.isCurrent === "function" ? opts.isCurrent : isGraded;
  const people = emptyBlock(), engines = emptyBlock();
  for (const rec of records || []) {
    const wallet = String(rec?.wallet || "");
    const w = wallet.toLowerCase();
    if (!wallet || exclude.has(w)) continue;
    const engine = engineSet.has(w);
    const b = engine ? engines : people;
    for (const t of rec.theses || []) {
      if (!isPublic(t)) continue;
      const head = { symbol: bare(t.symbol), direction: String(t.direction || "").toUpperCase(), path: `/feed/thesis/${wallet}/${encodeURIComponent(String(t.id))}`, wallet, engine };
      if (isGraded(t)) {
        if (!isCurrent(t)) continue;
        const at = Number(t.exitedAt) || Number(t.gradedAt) || 0;
        if (!(at > 0) || at > now + 10 * 60000) continue;
        if (now - at <= PULSE_WINDOW_MS) b.gradedWeek += 1;
        const r = Number(t.gradedR);
        b.graded.push({ ...head, outcome: t.gradedOutcome, r: Number.isFinite(r) ? Math.round(r * 100) / 100 : null, at });
        continue;
      }
      if (callLifecycle(t) === "OPEN") {
        b.open += 1;
        b.opened.push({ ...head, at: Number(t.filledAt) || Number(t.createdAt) || 0 });
      }
    }
  }
  return { ...finish(people), engines: finish(engines) };
}

/** "45m" · "6h" · "3d" — how long ago, coarse on purpose. */
export function agoShort(at, now) {
  const ms = Math.max(0, Number(now) - Number(at));
  if (ms < 3600000) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (ms < 48 * 3600000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const validBlock = (b) => !!b && Number.isFinite(b.open) && Number.isFinite(b.gradedWeek);
const hasAny = (b) => validBlock(b) && (b.open > 0 || b.gradedWeek > 0 || !!b.last);
/** "11 graded this week" — or, in a quiet week, "last graded 21d ago" (never a bare 0 when there is a past). */
export function gradedText(b, now = Date.now()) {
  if (b.gradedWeek === 0 && b.last && Number(b.last.at) > 0) return `last graded ${agoShort(b.last.at, now)} ago`;
  return `${b.gradedWeek} graded this week`;
}
const gradedShort = (b, now) =>
  b.gradedWeek === 0 && b.last && Number(b.last.at) > 0 ? `graded ${agoShort(b.last.at, now)} ago` : `${b.gradedWeek} graded/wk`;

/**
 * The strip's words, people and engines as separate labelled segments. Real numbers always; a quiet week
 * names the last grade's age. The engine segment appears only when the engines have any record. Unread
 * pulse = no numbers, no claim.
 * @returns {{ segments: { label:string, text:string, short:string }[] | null, title: string }}
 */
export function pulseLine(p, now = Date.now()) {
  if (!p || !validBlock(p)) return { segments: null, title: "How calls are graded" };
  const open = (n) => `${n} open`;
  const segments = [{ label: "People", text: `${open(p.open)} · ${gradedText(p, now)}`, short: `${open(p.open)} · ${gradedShort(p, now)}` }];
  if (hasAny(p.engines)) segments.push({ label: "Our engines", text: `${open(p.engines.open)} · ${gradedText(p.engines, now)}`, short: gradedShort(p.engines, now) });
  return { segments, title: "Every call is scored from public price. People and our engine callers are counted apart. See the record." };
}
