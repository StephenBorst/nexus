// ── Backwards moves: a demoted read is promotion-LOCKED until it re-qualifies (borst, 2026-11-15) ──────────────
// docs/research/pipeline-if-then.md § "Backwards moves". On 2026-11-15 level_reclaim and oi_div_reversal_4h fell from
// PAPER to REGISTERED (halves disagree) and the page had no rule for it. borst's ruling:
//   • the paper wallets keep running (data collection; paper carries no capital);
//   • promotion is LOCKED: nothing a higher stage licenses is applied, and a live plan can't be signed;
//   • it re-qualifies only after TWO clean daily watcher reads at least 7 DAYS apart that serve the stage it lost (or
//     higher), PLUS at least 15 NEW out-of-sample events since the demotion. A failing read in between resets the count.
// The lock is recorded by the daily watcher in docs/research/pipeline-stages.json (`locks`), copied into the generated
// app/lib/promotionLocks.mjs so the worker can refuse in code. Two hourly rebuilds are the same data plus an hour, so
// passes count only on the watcher's daily reads, timed by the board's own asOf. Pure: no fetch, no KV.

export const LOCK_RULE = Object.freeze({ passes: 2, minDaysApart: 7, newEvents: 15 });
const DAY_MS = 86_400_000;

/** Stage order for "backwards". RETIRED is terminal, not a rank. */
export const STAGE_RANK = Object.freeze({ REGISTERED: 0, LEAD: 1, EDGE: 2, TRADEABLE: 3, PAPER: 4 });
/** The stages at which a live plan may be signed (with a PASS and no lock). */
export const PLAN_STAGES = Object.freeze(["TRADEABLE", "PAPER"]);

const rank = (s) => (Object.prototype.hasOwnProperty.call(STAGE_RANK, s) ? STAGE_RANK[s] : null);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** A move to a lower ranked stage (RETIRED and unknown stages are never a demotion). */
export function isDemotion(from, to) {
  const a = rank(from), b = rank(to);
  return a != null && b != null && b < a;
}

/** A fresh lock at a demotion. A second demotion while locked restarts it, keeping the highest stage ever lost. */
export function lockAtDemotion(prevLock, { from, events, asOf }) {
  const lost = prevLock && rank(prevLock.lostStage) > rank(from) ? prevLock.lostStage : from;
  return { lostStage: lost, demotedAt: asOf, eventsAtDemotion: Number.isFinite(events) ? events : 0, cleanPasses: 0, lastPassAt: null };
}

/** Events still needed after the demotion (0 = enough). */
export const eventsNeeded = (lock, events) => Math.max(0, (lock.eventsAtDemotion ?? 0) + LOCK_RULE.newEvents - (Number.isFinite(events) ? events : 0));

/**
 * One daily watcher read of a locked read.
 * @param {object} lock   the recorded lock
 * @param {{ stage: string, events: number }} served
 * @param {string} asOf   the board's asOf (ISO)
 * @returns {{ lock: object|null, event: null|"pass"|"reset"|"unlocked" }}  lock null = unlocked
 */
export function stepLock(lock, served, asOf) {
  const passing = rank(served?.stage) != null && rank(served.stage) >= rank(lock.lostStage);
  if (!passing) {
    if (!lock.cleanPasses) return { lock, event: null };
    return { lock: { ...lock, cleanPasses: 0, lastPassAt: null }, event: "reset" };
  }
  let next = lock, event = null;
  const t = ms(asOf), last = ms(lock.lastPassAt);
  const spaced = lock.cleanPasses === 0 || (t != null && last != null && t - last >= LOCK_RULE.minDaysApart * DAY_MS);
  if (lock.cleanPasses < LOCK_RULE.passes && spaced) {
    next = { ...lock, cleanPasses: lock.cleanPasses + 1, lastPassAt: asOf };
    event = "pass";
  }
  if (next.cleanPasses >= LOCK_RULE.passes && eventsNeeded(next, served.events) === 0) return { lock: null, event: "unlocked" };
  return { lock: next, event };
}

/** Plain words for a lock's progress (digest, PR bodies, the refusal). events null = not read here. */
export function lockProgress(lock, events) {
  const passes = `${lock.cleanPasses ?? 0} of ${LOCK_RULE.passes} clean daily reads at ${lock.lostStage}`;
  const spacing = lock.lastPassAt ? `, the next counts from ${new Date(ms(lock.lastPassAt) + LOCK_RULE.minDaysApart * DAY_MS).toISOString().slice(0, 10)}` : "";
  const need = events == null ? null : eventsNeeded(lock, events);
  const ev = need == null ? `, and ${LOCK_RULE.newEvents} new events since the demotion`
    : need ? `, ${need} more new events (${LOCK_RULE.newEvents} since the demotion)` : `, ${LOCK_RULE.newEvents}+ new events in`;
  return `promotion locked since ${String(lock.demotedAt || "").slice(0, 10)} (lost ${lock.lostStage}): ${passes}${spacing}${ev}`;
}

/**
 * Why a live plan can't be signed on the read's stage (null = the stage allows it).
 * @param {{ stage: string|null|undefined, lock: object|null }} p  stage undefined/null = the board is unread
 */
export function stageSignRefusal({ stage, lock }) {
  if (!stage) return { status: 503, error: "stage_unread", detail: "the scoreboard is unread right now: no signature on a guess" };
  if (!PLAN_STAGES.includes(stage)) return { status: 409, error: "read_demoted", detail: `the read is served ${stage}; a live plan needs TRADEABLE or PAPER` };
  if (lock) return { status: 409, error: "promotion_locked", detail: lockProgress(lock, null) };
  return null;
}
