// lab-api's scheduled jobs leave a heartbeat (2026-11-16, borst: "a call missed the Lab and nobody was told"). The
// brain and exec already stamp ops:brain:heartbeat / ops:exec:heartbeat for the ops monitor; lab-api's own jobs (the
// minute grader, the on-chain watchdog, the paper tape check, the paper judge, the scoreboard rebuild) stamped nothing,
// so a job that kept throwing left only a log line. Each now stamps its own key after a run that finished; the daily
// digest names any that are late, and the ops monitor (nexus-ledger-anchor) alerts when the minute grader's stamp goes
// stale, which also means lab-api's scheduler itself stopped (the digest can't say that: it runs on the same cron).
// One key per job (KV has no compare-and-set: jobs finishing in the same minute must not overwrite each other).

export const BEAT_PREFIX = "ops:labapi:beat:";
export const JOBS = Object.freeze([
  { id: "m1", label: "minute grader", maxMin: 15 },          // stamped on every 5th minute's successful run
  { id: "regwatch", label: "on-chain watchdog", maxMin: 20 },
  { id: "tape", label: "paper tape check", maxMin: 150 },
  { id: "judge", label: "paper judge", maxMin: 150 },
  { id: "scoreboard", label: "scoreboard rebuild", maxMin: 150 },
]);

const kvOf = (env) => env.NEXUS_AGENT || env.LAB_STORE;

/** Stamp a job's heartbeat. Never throws: a failed stamp must not fail the job. */
export async function stampJob(env, id, now = Date.now()) {
  try { await kvOf(env).put(BEAT_PREFIX + id, String(now)); } catch (e) { console.error(`[beat] ${id}:`, String(e?.message || e)); }
}

/** Every job's last stamp ({ id: ms | null }), null when unread or never stamped. */
export async function readBeats(env) {
  const out = {};
  for (const j of JOBS) {
    try { const v = Number(await kvOf(env).get(BEAT_PREFIX + j.id)); out[j.id] = Number.isFinite(v) && v > 0 ? v : null; }
    catch { out[j.id] = null; }
  }
  return out;
}

/** Jobs whose last stamp is older than their limit. A job never stamped is left out (a first rollout isn't an outage). */
export function staleJobs(beats, now = Date.now()) {
  return JOBS.filter((j) => beats?.[j.id] && now - beats[j.id] > j.maxMin * 60_000)
    .map((j) => ({ id: j.id, label: j.label, ageMin: Math.round((now - beats[j.id]) / 60_000) }));
}

/** The digest's line. */
export function jobsLine(beats, now = Date.now()) {
  if (!beats) return "Job stamps unread right now.";
  const late = staleJobs(beats, now);
  const fmt = (m) => (m < 90 ? `${m} min` : `${Math.round(m / 60)}h`);
  const never = JOBS.filter((j) => !beats[j.id]).map((j) => j.label);
  const parts = [late.length ? `Late: ${late.map((j) => `${j.label} (last ran ${fmt(j.ageMin)} ago)`).join(", ")}. Check the lab-api logs.` : "All ran on time."];
  if (never.length) parts.push(`No stamp yet: ${never.join(", ")}.`);
  return parts.join(" ");
}
