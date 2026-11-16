import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stampJob, readBeats, staleJobs, jobsLine, JOBS, BEAT_PREFIX } from "./jobBeats.mjs";

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }
const MIN = 60_000;

test("each job stamps its own key; a failed stamp never throws", async () => {
  const env = { NEXUS_AGENT: kv() };
  await stampJob(env, "tape", 1000);
  assert.equal(env.NEXUS_AGENT.m.get(`${BEAT_PREFIX}tape`), "1000");
  await stampJob({ NEXUS_AGENT: { put: async () => { throw new Error("kv down"); } } }, "m1");
  const beats = await readBeats(env);
  assert.equal(beats.tape, 1000);
  assert.equal(beats.m1, null);
});

test("late jobs by their own limit; never-stamped ones aren't an outage", () => {
  const now = 10_000 * MIN;
  const beats = { m1: now - 20 * MIN, regwatch: now - 5 * MIN, tape: now - 200 * MIN, judge: null, scoreboard: now - 30 * MIN };
  assert.deepEqual(staleJobs(beats, now).map((j) => j.id), ["m1", "tape"]);
  assert.equal(jobsLine(beats, now), "Late: minute grader (last ran 20 min ago), paper tape check (last ran 3h ago). Check the lab-api logs. No stamp yet: paper judge.");
  const fresh = Object.fromEntries(JOBS.map((j) => [j.id, now - MIN]));
  assert.equal(jobsLine(fresh, now), "All ran on time.");
  assert.equal(jobsLine(null), "Job stamps unread right now.");
});

test("stamps sit after each job's work, inside its try; the digest and the ops monitor read them", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  for (const [job, after] of [["tape", "await runPaperTape(env)"], ["judge", "await runPaperJudge(env)"], ["scoreboard", "await rebuildScoreboard("], ["regwatch", "await runRegWatch(env, {"], ["m1", "await runMinuteGrades(env)"]]) {
    const i = src.indexOf(after), j = src.indexOf(`await stampJob(env, "${job}")`, i);
    assert.ok(i > 0 && j > i && src.slice(i, j).indexOf("catch") === -1, `${job}: stamped only when its run finished`);
  }
  const dig = readFileSync(new URL("./opsDigest.mjs", import.meta.url), "utf8");
  assert.match(dig, /jobsLine\(await readBeats\(env\), nowMs\)/);
  const mon = readFileSync(new URL("../nexus-ledger-anchor/index.js", import.meta.url), "utf8");
  assert.match(mon, /env\.NEXUS_AGENT\.get\("ops:labapi:beat:m1"\)/);
  assert.equal(JOBS.find((j) => j.id === "m1").maxMin, 15, "the monitor's 15-min limit matches");
});
