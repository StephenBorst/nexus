// The weekly scorecard (borst 2026-11-16, pipeline-if-then.md "Weekly scorecard"; rules app/lib/weeklyScorecard.mjs).
// Hourly at WEEKLY_RUN_MINUTE: if the last complete week (Monday 00:00 UTC → Monday) has no snapshot yet, build it from
// what this worker already stores (the scoreboard, the Lab records, exec's paper state, the recorded judgments), write
// it ONCE under a lock, and add it to the index with its sha256. A written week is never rewritten. Reads only; the
// only writes are proof:weekly:{week} and proof:weekly:index in LAB_STORE. No route writes here.
//
// Public: GET /proof/weekly → the index + the latest week. GET /proof/weekly/:week → the stored bytes exactly, so
// `curl -s …/proof/weekly/2026-11-09 | sha256sum` matches the published hash.
import { lastCompletedWeek, weeklyCalls, weeklyPaper, weeklySnapshot } from "../../app/lib/weeklyScorecard.mjs";
import { isCurrentStamp } from "./grading.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";
import { lastGoodKey } from "./scoreboardCache.mjs";
import { withLock, LOCK_KEYS } from "./lock.mjs";

export const WEEKLY_KEY = (week) => `proof:weekly:${week}`;
export const WEEKLY_INDEX = "proof:weekly:index";
export const WEEKLY_RUN_MINUTE = 29; // away from :17, :41, :47, :49, :53
export const WEEKLY_KEEP = 104;      // two years in the index; every snapshot itself is kept

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const readJson = async (kv, key) => { try { const raw = await kv.get(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };

async function listAll(kv, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

export async function readIndex(env) {
  const idx = await readJson(env.LAB_STORE, WEEKLY_INDEX);
  return Array.isArray(idx) ? idx : [];
}

/** One run. Returns what it did; never throws for a missing input (it waits for the next run). */
export async function runWeekly(env, { now = Date.now(), scorecardKey, lock = (key, fn) => withLock(env, key, fn) } = {}) {
  const week = lastCompletedWeek(now);
  if (await env.LAB_STORE.get(WEEKLY_KEY(week.week))) return { week: week.week, skipped: "done" };
  const board = (scorecardKey && (await readJson(env.LAB_STORE, scorecardKey))) || (scorecardKey && (await readJson(env.LAB_STORE, lastGoodKey(scorecardKey))));
  if (!board?.pipeline) return { week: week.week, skipped: "board_unread" };

  const records = [];
  for (const name of await listAll(env.LAB_STORE, "lab:")) {
    const rec = await readJson(env.LAB_STORE, name);
    if (rec) records.push({ wallet: name.slice(4), theses: rec.theses || [] });
  }
  const calls = weeklyCalls(records, week, {
    exclude: [env.HOUSE_CALLER_ADDRESS, env.HOUSE_CATALYST_ADDRESS], engines: [env.ENGINE_CALLER_ADDRESSES],
    personFrom: [env.PERSON_FROM_ADDRESSES], isCurrent: isCurrentStamp,
  });
  const agentKv = env.NEXUS_AGENT || env.LAB_STORE;
  const paperIn = {};
  for (const r of board.pipeline.reads || []) {
    if (!r?.paperWallet) continue;
    const judged = await readJson(env.LAB_STORE, PJUDGE_KEY(r.axis));
    paperIn[r.axis] = { wallet: r.paperWallet, state: await readJson(agentKv, `agent:state:${String(r.paperWallet).toLowerCase()}`), verdict: judged?.verdict ?? null };
  }
  const index = await readIndex(env);
  const prev = index.length ? await readJson(env.LAB_STORE, WEEKLY_KEY(index[0].week)) : null;
  const snap = weeklySnapshot({ board, prev, calls, paper: weeklyPaper(paperIn, week), week, builtAt: now });
  if (!snap) return { week: week.week, skipped: "board_unread" };
  const text = JSON.stringify(snap);
  const sha256 = await sha256hex(text);

  return lock(LOCK_KEYS.proofWeekly(week.week), async () => {
    if (await env.LAB_STORE.get(WEEKLY_KEY(week.week))) return { week: week.week, skipped: "done" }; // another run won
    await env.LAB_STORE.put(WEEKLY_KEY(week.week), text);
    const next = [{ week: week.week, sha256, builtAt: snap.builtAt }, ...(await readIndex(env)).filter((x) => x.week !== week.week)]
      .sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, WEEKLY_KEEP);
    await env.LAB_STORE.put(WEEKLY_INDEX, JSON.stringify(next));
    return { week: week.week, written: true, sha256 };
  });
}

const headers = (extra = {}) => ({ "Access-Control-Allow-Origin": "*", ...extra });

/** GET /proof/weekly[/:week]. Read only. */
export async function handleWeekly(parts, request, env) {
  if (parts[0] !== "proof" || parts[1] !== "weekly") return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers({ "Access-Control-Allow-Methods": "GET" }) });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: headers({ "Content-Type": "application/json" }) });
  if (parts[2]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) return new Response(JSON.stringify({ error: "bad_week" }), { status: 400, headers: headers({ "Content-Type": "application/json" }) });
    const text = await env.LAB_STORE.get(WEEKLY_KEY(parts[2]));
    if (!text) return new Response(JSON.stringify({ error: "no_such_week" }), { status: 404, headers: headers({ "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }) });
    // The stored bytes exactly: hash them to check against the index.
    return new Response(text, { status: 200, headers: headers({ "Content-Type": "application/json", "Cache-Control": "public, max-age=86400", "X-Content-SHA256": await sha256hex(text) }) });
  }
  const weeks = await readIndex(env);
  const latest = weeks.length ? await readJson(env.LAB_STORE, WEEKLY_KEY(weeks[0].week)) : null;
  return new Response(JSON.stringify({ ok: true, weeks, latest }), { status: 200, headers: headers({ "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }) });
}
