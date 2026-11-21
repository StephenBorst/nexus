// GET /intel/bell — the Signals bell (on top of every DEX page) in ONE request, each row with its grade
// (app/lib/signals.mjs v2, 2026-11-14). Reads, through the worker's own handler in-process: /signals,
// /theses/consensus, /smart/xray/events, the stored scoreboard (/intel/axis-backtest: grades + served pipeline
// stages) and /signals/paper-run/:axis for each registered read with a paper wallet. Read-only, 60 s cache.
// A board that fails drops its rows (fail-soft); the scoreboard unread = funding rows say their grade is unread.

import { swrServe } from "./swrCache.mjs";
import { buildSignals } from "../../app/lib/signals.mjs";
import { json } from "./shared.mjs";

export const BELL_CACHE_KEY = "intel:bell:v1";
export const BELL_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 8_000;

async function readBoard(dispatch, path, timeoutMs) {
  let timer;
  try {
    const res = await Promise.race([dispatch(path), new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The bell's sources, then the paper runs of the reads the scoreboard lists with a paper wallet. */
export async function composeBell(dispatch, { now = Date.now(), timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const [sg, cs, ev, sc] = await Promise.all([
    readBoard(dispatch, "/signals", timeoutMs),
    readBoard(dispatch, "/theses/consensus", timeoutMs),
    readBoard(dispatch, "/smart/xray/events", timeoutMs),
    readBoard(dispatch, "/intel/axis-backtest", timeoutMs),
  ]);
  const withWallet = (sc?.pipeline?.reads ?? []).filter((r) => r && r.paperWallet && r.stage !== "RETIRED" && !(Array.isArray(r.failing) && r.failing.length)).slice(0, 6);
  const runs = await Promise.all(withWallet.map((r) => readBoard(dispatch, `/signals/paper-run/${encodeURIComponent(r.axis)}`, timeoutMs)));
  const paperRuns = Object.fromEntries(withWallet.map((r, i) => [r.axis, runs[i]]).filter(([, v]) => v));
  const list = buildSignals({
    signals: Array.isArray(sg?.signals) ? sg.signals : [],
    consensus: cs?.consensus ?? null,
    xrayEvents: Array.isArray(ev?.events) ? ev.events : [],
    scorecard: sc,
    paperRuns,
    now,
  });
  const unread = [["signals", sg], ["callers", cs], ["wallets", ev], ["scoreboard", sc]].filter(([, v]) => !v).map(([k]) => k);
  return { v: 2, builtAt: now, list, unread };
}

export async function handleBell(parts, request, env, { dispatch, now = Date.now(), timeoutMs, waitUntil = null } = {}) {
  if (!(parts[0] === "intel" && parts[1] === "bell" && !parts[2] && request.method === "GET")) return null;
  // A visitor never waits on a build while a copy exists (swrCache.mjs): an older copy is served and refreshed after.
  const { body } = await swrServe({ kv: env.LAB_STORE, key: BELL_CACHE_KEY, now, freshMs: BELL_TTL_MS, waitUntil,
    compose: () => composeBell(dispatch, { now, timeoutMs }) });
  return json(body, request);
}
