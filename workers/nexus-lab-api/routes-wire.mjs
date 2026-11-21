// GET /intel/wire — the Wire (rules app/lib/wire.mjs, borst 2026-11-20): one stream of what changed, from boards the
// worker already serves, read in-process through its own handler: the news wire, the bell (registered reads' paper
// trades, funding past its line, the trend row, wallet tier changes), every registered read's paper run (house runs
// included), tracked wallets' moves (/smart/events), graded calls (/calls/pulse) and what's scheduled in the next 12h
// (/intel/calendar). Read-only, 60 s cache. A board that fails drops its rows and is named in `unread`.

import { swrServe } from "./swrCache.mjs";
import { readRows } from "../../app/lib/signals.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { newsRows, bellRows, walletRows, callRows, upcomingRows, wireStream, nextSeen } from "../../app/lib/wire.mjs";
import { readNews } from "./routes-news.mjs";
import { json } from "./shared.mjs";

export const WIRE_CACHE_KEY = "intel:wire:v1";
export const WIRE_SEEN_KEY = "intel:wire:seen:v1";
export const WIRE_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 8_000;

export async function readBoard(dispatch, path, timeoutMs) {
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

/** Every registered read's paper run (own wallet, claim or house run), by axis; one that fails is left out. */
export async function readPaperRuns(dispatch, timeoutMs = SOURCE_TIMEOUT_MS) {
  const axes = REGISTERED_READS.map((r) => r.axis);
  const runs = await Promise.all(axes.map((a) => readBoard(dispatch, `/signals/paper-run/${encodeURIComponent(a)}`, timeoutMs)));
  return Object.fromEntries(axes.map((a, i) => [a, runs[i]]).filter(([, v]) => v && v.ok !== false));
}

/** deps: dispatch (the worker's own handler), news (reads the news wire), now, timeoutMs. */
export async function composeWire(env, { dispatch, news = (e) => readNews(e), now = Date.now(), timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const [wire, bell, sc, smart, pulse, cal] = await Promise.all([
    Promise.resolve().then(() => news(env)).catch(() => null),
    readBoard(dispatch, "/intel/bell", timeoutMs),
    readBoard(dispatch, "/intel/axis-backtest", timeoutMs),
    readBoard(dispatch, "/smart/events", timeoutMs),
    readBoard(dispatch, "/calls/pulse", timeoutMs),
    readBoard(dispatch, "/intel/calendar", timeoutMs),
  ]);
  // every registered read's paper run (own wallet, claim or house run), so a house run opening a trade is on the wire
  const paperRuns = await readPaperRuns(dispatch, timeoutMs);
  const reads = sc ? readRows(sc, paperRuns, now) : [];

  let seen = {};
  try { seen = JSON.parse((await env.LAB_STORE.get(WIRE_SEEN_KEY)) || "{}") || {}; } catch { seen = {}; }
  const bellList = Array.isArray(bell?.list) ? bell.list : [];
  const fromBell = bellRows(bellList, seen, now);
  const standing = fromBell.filter((r) => r.kind === "FUNDING" || r.kind === "MOMENTUM").map((r) => r.id);
  const nextS = nextSeen(seen, standing, now);
  try { await env.LAB_STORE.put(WIRE_SEEN_KEY, JSON.stringify(nextS), { expirationTtl: 3 * 86400 }); } catch { /* best-effort */ }

  const rows = wireStream([
    bellRows(reads, nextS, now),
    fromBell,
    newsRows(wire?.items, now),
    walletRows(smart?.events, now),
    callRows(pulse, now),
  ], now);
  const unread = [["news", wire], ["signals", bell], ["scoreboard", sc], ["wallets", smart], ["calls", pulse], ["calendar", cal]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (wire && Array.isArray(wire.sources)) for (const s of wire.sources) if (!s.ok) unread.push(`news: ${s.name}`);
  return { v: 1, builtAt: now, rows, upcoming: upcomingRows(cal?.events, now), unread };
}

export async function handleWire(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "wire" && !parts[2] && request.method === "GET")) return null;
  const now = deps.now ?? Date.now();
  // A visitor never waits on a build while a copy exists (swrCache.mjs): an older copy is served and refreshed after.
  const { body } = await swrServe({ kv: env.LAB_STORE, key: WIRE_CACHE_KEY, now, freshMs: WIRE_TTL_MS, waitUntil: deps.waitUntil || null,
    compose: () => composeWire(env, { ...deps, now }) });
  return json(body, request);
}
