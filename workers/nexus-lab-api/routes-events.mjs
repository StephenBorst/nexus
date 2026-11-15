// GET /intel/events — the events calendar (rules app/lib/eventsCalendar.mjs, 2026-11-15). US macro releases from
// ForexFactory's public weekly JSON (this week + next week; the feed asks for light use, so it is read at most once an
// hour, with a 24h last-good copy), and the dated world-event markets on the Catalysts board (read in-process). A source
// that fails is named in `unread`, never shown as an empty week. Read-only; no key, no wallet.

import { macroEvents, marketEvents, calendar, CALENDAR_SOURCES } from "../../app/lib/eventsCalendar.mjs";
import { json } from "./shared.mjs";

export const EVENTS_CACHE_KEY = "intel:events:v1";
export const MACRO_CACHE_KEY = "intel:events:macro:v1";
export const EVENTS_TTL_MS = 5 * 60_000;
export const MACRO_TTL_MS = 60 * 60_000;
export const MACRO_LASTGOOD_MS = 24 * 60 * 60_000;
export const FF_URLS = Object.freeze([
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
]);

async function readJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; calendar-reader)" } });
    if (!r.ok) return null;
    return JSON.parse(await r.text());
  } catch { return null; }
}

/** The raw macro rows (all USD high/medium in the feeds), cached an hour; the last good copy for 24h. */
async function macroRaw(env, fetchImpl, now) {
  let cached = null;
  try { cached = JSON.parse((await env.LAB_STORE.get(MACRO_CACHE_KEY)) || "null"); } catch { cached = null; }
  if (cached && now - cached.at < MACRO_TTL_MS) return { rows: cached.rows, stale: false };
  const [thisWeek, nextWeek] = await Promise.all(FF_URLS.map((u) => readJson(fetchImpl, u)));
  if (Array.isArray(thisWeek)) {
    const rows = [...thisWeek, ...(Array.isArray(nextWeek) ? nextWeek : [])];
    try { await env.LAB_STORE.put(MACRO_CACHE_KEY, JSON.stringify({ at: now, rows }), { expirationTtl: 2 * 86400 }); } catch { /* best-effort */ }
    return { rows, stale: false };
  }
  if (cached && now - cached.at < MACRO_LASTGOOD_MS) return { rows: cached.rows, stale: true };
  return { rows: null, stale: false };
}

/** deps: dispatch (the worker's own handler), fetchImpl. */
export async function composeEvents(env, { dispatch, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const unread = [];
  const { rows, stale } = await macroRaw(env, fetchImpl, now);
  const macro = macroEvents(rows, { now });
  if (macro == null) unread.push("macro");

  let board = null;
  try { const r = await dispatch("/intel/catalysts-board"); board = r && r.ok ? await r.json() : null; } catch { board = null; }
  const markets = marketEvents(board, { now });
  if (markets == null) unread.push("markets");

  return {
    v: 1, builtAt: now, events: calendar({ macro: macro ?? [], markets: markets ?? [] }),
    unread, macroStale: stale, sources: CALENDAR_SOURCES,
  };
}

export async function handleEvents(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "events" && !parts[2] && request.method === "GET")) return null;
  const now = deps.now ?? Date.now();
  try {
    const hit = JSON.parse((await env.LAB_STORE.get(EVENTS_CACHE_KEY)) || "null");
    if (hit && now - hit.builtAt < EVENTS_TTL_MS) return json(hit, request);
  } catch { /* best-effort */ }
  const out = await composeEvents(env, { ...deps, now });
  if (out.unread.length < 2) {
    try { await env.LAB_STORE.put(EVENTS_CACHE_KEY, JSON.stringify(out), { expirationTtl: 900 }); } catch { /* best-effort */ }
  }
  return json(out, request);
}
