// ── The minute grader: open calls fill and settle within a minute or two of price trading the level ──
// Runs on lab-api's 1-minute cron (and once an hour as a FULL sweep after the hourly pass). For every
// open minute-graded call (app/lib/minuteGrade.mjs, listed from minuteIndex.mjs):
//   1. bring each market's 1-minute archive up to now (minuteCandles.mjs; ~one Orderly page a market);
//   2. TRIGGER: re-grade a call only when the minutes this run added or changed traded one of its levels
//      (entry, stop, TP1, TP2), it has never been stamped, or its declared time stop is due. Bars that
//      can't touch a level can't move a first-touch grade, so the rest are skipped without a read. A
//      minute re-read unchanged isn't news: a touch triggers once, not again on the next run (KV is
//      eventually consistent, so a re-trigger could read a copy from before the stamp);
//   3. SETTLE: re-grade it with the ONE grader (logic.mjs gradeCall) on its whole minute window, stamp
//      it the way the hourly pass does (grading.mjs applyGrade), write only the grade fields onto a
//      fresh read of the record, then announce fills and grades (the same notifiers as the hourly pass).
//
// The trigger only decides WHEN to look. The outcome is always gradeCall on archived public bars, so
// a third party re-running /verify on the same minutes gets the same answer.
//
// The full sweep re-grades every indexed call with no trigger: the safety net for a stamp that never
// landed or was lost (a run that died mid-write, an owner's save from a stale read). One run at a time
// (a NexusLock lease); a busy lock = skip. Each fill / grade is announced once (claimOnce).
import { gradeCall } from "./logic.mjs";
import { applyGrade, writePassFields, GRADE_FIELDS, isCurrentStamp } from "./grading.mjs";
import { notifyResolution, notifyFillEvent } from "./resolutions.mjs";
import { makeMinuteCandles, minuteNeededFrom } from "./minuteCandles.mjs";
import { listMinuteIndex, indexKey, indexMeta, putIndex, ownsCall } from "./minuteIndex.mjs";
import { gradeSymbol } from "./gradeCandles.mjs";
import { mapLimit } from "./orderlyGet.mjs";
import { withLock, LOCK_KEYS, LockBusy, claimOnce } from "./lock.mjs";

// One alert per call per event, across overlapping runs (the lease's longest hold).
const ANNOUNCE_TTL_MS = 10 * 60 * 1000;
const announceKey = (wallet, id, kind) => `minutegrade:sent:${wallet}:${id}:${kind}`;

/**
 * Whether new bars could move this call's grade. Pure. Conservative on purpose: a false "yes" costs
 * one read, a false "no" would leave a call unsettled until the hourly sweep.
 * @param {object} meta the index key's metadata (minuteIndex.mjs indexMeta)
 * @param {{ range: {lo:number, hi:number} | null, nowMs: number, full?: boolean }} ctx  range = what the
 *   bars this run added or changed traded (minuteCandles movedRange)
 */
export function needsRegrade(meta, { range, nowMs, full = false }) {
  if (full) return true;
  if (!(Number(meta?.c) > 0)) return true;
  if (!meta.g) return true;                                                // never stamped: its first stamp (WORKING / OPEN at the post)
  // A declared time stop: due once N hours have run from the fill's hour (its window ends within the hour after).
  if (Number(meta.ts) > 0 && Number(meta.f) > 0 && nowMs >= Math.floor(meta.f / 3600000) * 3600000 + meta.ts * 3600000) return true;
  if (!range) return false;
  return [meta.e, meta.sl, meta.t1, meta.t2].some((px) => Number(px) > 0 && range.lo <= px && px <= range.hi);
}

/**
 * One run. Returns counts for the log. deps: fetchJson (Orderly), nowMs, notify (false = no alerts),
 * lock (false = no lease, for tests).
 */
export async function runMinuteGrades(env, { full = false, lock = true, ...deps } = {}) {
  const run = () => minutePass(env, { full, ...deps });
  if (!lock || !env?.NEXUS_LOCK) return run();
  try {
    return await withLock(env, LOCK_KEYS.minuteGrade(), run, full ? { ttlMs: 240_000, waitMs: 30_000 } : { ttlMs: 55_000, waitMs: 0 });
  } catch (e) {
    if (e instanceof LockBusy) return { skipped: "busy" };
    // The lock itself unreachable: grading isn't money, so keep the tape moving (worst case a fill
    // alert is sent twice by two overlapping runs).
    console.error("[m1] lock unavailable, running unlocked:", String(e?.message || e));
    return run();
  }
}

async function minutePass(env, { full, fetchJson, nowMs = () => Date.now(), notify = true }) {
  const kv = env.LAB_STORE;
  const stats = { calls: 0, triggered: 0, graded: 0, fills: 0, dropped: 0, pages: 0, writeFailed: 0 };
  const entries = await listMinuteIndex(kv);
  stats.calls = entries.length;
  if (!entries.length) return stats;

  // 1. Each market's archive, from its oldest open call to now.
  const needs = {};
  for (const e of entries) {
    const sym = gradeSymbol(e.meta?.s), from = minuteNeededFrom(e.meta?.c);
    if (sym && from != null) needs[sym] = Math.min(needs[sym] ?? from, from);
  }
  const mc = makeMinuteCandles(env, { ...(fetchJson ? { fetchJson } : {}), nowMs });
  const syms = Object.keys(needs);
  await mapLimit(syms, 3, (sym) => mc.ensure(sym, needs[sym]));
  stats.pages = mc.pagesUsed();

  // 2. Which calls the new minutes could move.
  const now = nowMs();
  const byWallet = new Map();
  for (const e of entries) {
    const range = mc.movedRange(e.meta?.s);
    if (!needsRegrade(e.meta || {}, { range, nowMs: now, full })) continue;
    if (!byWallet.has(e.wallet)) byWallet.set(e.wallet, []);
    byWallet.get(e.wallet).push(e);
    stats.triggered++;
  }

  // 3. Re-grade and stamp, one record read + write per wallet.
  for (const [wallet, list] of byWallet) {
    const key = `lab:${wallet}`;
    let data;
    try { data = JSON.parse((await kv.get(key)) || "null"); } catch { data = null; }
    const theses = Array.isArray(data?.theses) ? data.theses : [];
    const touched = new Set(), drop = [], reindex = [], justFilled = [], justResolved = [];
    for (const e of list) {
      const t = theses.find((x) => x && x.id === e.id);
      // Not a public minute-graded call any more (or already graded): nothing for this grader to do.
      if (!ownsCall(t) || isCurrentStamp(t)) { drop.push(e); continue; }
      const cd = await mc.window(t.symbol, minuteNeededFrom(t.createdAt));
      if (!cd) continue;   // the archive doesn't cover the call yet: next run
      const g = gradeCall(t, cd);
      if (g.outcome === "INVALID") { drop.push(e); continue; }   // levels the grader can never grade
      const r = applyGrade(t, g, cd, now);
      if (r.changed) touched.add(t.id);
      if (r.resolved) justResolved.push({ t, ...r.resolved });
      for (const kind of r.fills) justFilled.push({ t, kind });
      if (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS") drop.push(e);
      else if (JSON.stringify(indexMeta(t)) !== JSON.stringify(e.meta)) reindex.push(t);
    }
    if (touched.size) {
      try { await writePassFields(env, key, data, (m) => (touched.has(m.id) ? GRADE_FIELDS : null)); }
      catch (err) { stats.writeFailed++; console.error("[m1] write", wallet, String(err?.message || err)); continue; }
      if (notify) {
        for (const ev of justFilled) {
          if (await claimOnce(env, announceKey(wallet, ev.t.id, ev.kind), ANNOUNCE_TTL_MS)) await notifyFillEvent(env, wallet, ev.t, ev.kind);
        }
        for (const rz of justResolved) {
          if (await claimOnce(env, announceKey(wallet, rz.t.id, "graded"), ANNOUNCE_TTL_MS)) await notifyResolution(env, wallet, rz.t, rz.outcome, rz.r);
        }
      }
      stats.graded += justResolved.length; stats.fills += justFilled.length;
    }
    for (const e of drop) { try { await kv.delete(indexKey(e.wallet, e.id)); stats.dropped++; } catch { /* next run */ } }
    for (const t of reindex) { try { await putIndex(kv, wallet, t); } catch { /* next run */ } }
  }

  // The archive is written last: if a grade didn't land, the next run fetches the same minutes again
  // and its trigger fires again.
  if (!stats.writeFailed) await mc.flush();
  return stats;
}
