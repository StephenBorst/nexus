// GET /intel/calendar — the events calendar (rules app/lib/eventsCalendar.mjs, 2026-11-15). US macro releases from
// ForexFactory's public weekly JSON (this week + next week; the feed asks for light use, so it is read at most once an
// hour, with a 24h last-good copy), and the dated world-event markets on the Catalysts board (read in-process). A source
// that fails is named in `unread`, never shown as an empty week. Read-only; no key, no wallet.
// (Not /intel/events: that path is the older Polymarket events corner, index.js, and stays as it is.)

import { macroEvents, marketEvents, calendar, CALENDAR_SOURCES } from "../../app/lib/eventsCalendar.mjs";
import { json } from "./shared.mjs";

export const EVENTS_CACHE_KEY = "intel:events:v1";
export const MACRO_CACHE_KEY = "intel:events:macro:v1";
export const EVENTS_TTL_MS = 5 * 60_000;
export const MACRO_TTL_MS = 60 * 60_000;
export const MACRO_LASTGOOD_MS = 7 * 24 * 60 * 60_000; // rows carry their own dates; past ones drop out of the window
export const MACRO_BACKOFF_MS = 60 * 60_000;            // after a refused read (the feed answers 429 to busy IPs), wait an hour
export const MACRO_FAIL_KEY = "intel:events:macro:fail:v1";
export const FF_URLS = Object.freeze([
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
]);

// { data, err }: err says why a read failed ("http 403", "not json", "fetch: …"), so the reply can name it.
async function readJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; calendar-reader)" } });
    if (!r.ok) return { data: null, err: `http ${r.status}` };
    const text = await r.text();
    try { return { data: JSON.parse(text), err: null }; } catch { return { data: null, err: "not json" }; }
  } catch (e) { return { data: null, err: `fetch: ${String(e?.message ?? e).slice(0, 80)}` }; }
}

/** The raw macro rows (all USD high/medium in the feeds), cached an hour; the last good copy for 7 days. A refused read
 *  is not retried for an hour (MACRO_FAIL_KEY), so we never hammer a feed that is throttling us. */
async function macroRaw(env, fetchImpl, now) {
  let cached = null, fail = null;
  try { cached = JSON.parse((await env.LAB_STORE.get(MACRO_CACHE_KEY)) || "null"); } catch { cached = null; }
  if (cached && now - cached.at < MACRO_TTL_MS) return { rows: cached.rows, stale: false, err: null, at: cached.at };
  try { fail = JSON.parse((await env.LAB_STORE.get(MACRO_FAIL_KEY)) || "null"); } catch { fail = null; }
  const lastGood = cached && now - cached.at < MACRO_LASTGOOD_MS ? cached : null;
  if (fail && now - fail.at < MACRO_BACKOFF_MS) {
    const err = `${fail.err} (retry after ${new Date(fail.at + MACRO_BACKOFF_MS).toISOString()})`;
    return lastGood ? { rows: lastGood.rows, stale: true, err, at: lastGood.at } : { rows: null, stale: false, err, at: null };
  }
  const [a, b] = await Promise.all(FF_URLS.map((u) => readJson(fetchImpl, u)));
  const thisWeek = a.data, nextWeek = b.data;
  if (Array.isArray(thisWeek)) {
    const rows = [...thisWeek, ...(Array.isArray(nextWeek) ? nextWeek : [])];
    try { await env.LAB_STORE.put(MACRO_CACHE_KEY, JSON.stringify({ at: now, rows }), { expirationTtl: 2 * 86400 }); } catch { /* best-effort */ }
    return { rows, stale: false, err: null, at: now };
  }
  const err = a.err ?? "not a list";
  try { await env.LAB_STORE.put(MACRO_FAIL_KEY, JSON.stringify({ at: now, err }), { expirationTtl: 2 * 3600 }); } catch { /* best-effort */ }
  if (lastGood) return { rows: lastGood.rows, stale: true, err, at: lastGood.at };
  return { rows: null, stale: false, err, at: null };
}

/** deps: dispatch (the worker's own handler), fetchImpl. */
export async function composeEvents(env, { dispatch, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const unread = [];
  const { rows, stale, err: macroError, at: macroAt } = await macroRaw(env, fetchImpl, now);
  const macro = macroEvents(rows, { now });
  if (macro == null) unread.push("macro");

  let board = null;
  try { const r = await dispatch("/intel/catalysts-board"); board = r && r.ok ? await r.json() : null; } catch { board = null; }
  const markets = marketEvents(board, { now });
  if (markets == null) unread.push("markets");

  return {
    v: 1, builtAt: now, events: calendar({ macro: macro ?? [], markets: markets ?? [] }),
    unread, macroStale: stale, macroAt, macroError, sources: CALENDAR_SOURCES,
  };
}

export async function handleEvents(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "calendar" && !parts[2] && request.method === "GET")) return null;
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
