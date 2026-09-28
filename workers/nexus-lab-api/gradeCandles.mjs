// ── Candles for grading a call: the price from the hour it was posted ─────────────────────────
// A call is graded first-touch on public Orderly OHLC from the moment it was posted, and regime /
// plan quality read the bars just before it. The leaderboard used to fetch ONE fixed window per
// symbol, [now − 30d − 50h, now], in one request: a call older than that was graded on candles that
// started days or weeks after it, so an old WIN could read as a LOSS or drop out as pending (131 of
// 369 public calls on 2026-09-27). The cron and the permalink capped their window at 60 days, also
// in one request, and Orderly's /tv/history caps how much one response covers.
//
// Now every grader reads ONE per-symbol store that reaches back to the symbol's oldest call:
// • fetched in GRADE_PAGE_S (20-day) pages through orderlyJson, the paging the backtest runs on;
// • CONTIGUOUS by construction: pages extend the store from its edges, and a page that fails stops
//   the extension for that symbol this run, so [from, to] never has a hole where a page was lost (a
//   hole could hide the bar that decided a call);
// • closed hourly bars never change, so the store is kept in KV (TTL refreshed on every write) and
//   only its tail is re-fetched, every TAIL_REFRESH_MS, starting a little before the last bar (it may
//   have been a partial hour);
// • a call is graded only when the store reaches back to createdAt − REGIME_PAD_S and the market
//   printed a bar in that pad (callWindow). Short of that it isn't graded THIS run: never on a
//   partial window. Each run has a page budget, so a backfill spreads over a few runs.
import { orderlyJson } from "./backtest.mjs";
import { REGIME, normalizeSymbol } from "./logic.mjs";

// The bars before a call that regime + plan quality read (moved here from grading.mjs, which re-exports it).
export const REGIME_PAD_S = (REGIME.LOOKBACK + 2) * 3600;
export const GRADE_PAGE_S = 20 * 86400;
export const TAIL_REFRESH_MS = 30 * 60 * 1000;
export const TAIL_OVERLAP_S = 2 * 3600;
export const STORE_TTL_S = 45 * 86400;   // an idle symbol's store ages out; every write refreshes it
export const PAGE_BATCH = 5;             // pages in flight at once (Orderly allows 10 req/s per IP)
const ORDERLY = "https://api-evm.orderly.org";
const KEY = (sym) => `tvhist:v2:${sym}`;

/**
 * The store key for a thesis symbol: bare "BTC" and "PERP_BTC_USDC" share one store. null when the
 * symbol can't be an Orderly market id (those never had candles), so it costs no page.
 */
export const gradeSymbol = (raw) => normalizeSymbol(raw);

// No call on Nexus predates 2026 (the oldest public call is from 2026-05-04). A createdAt before this
// is malformed, not old: it isn't graded, and it can't send a store walking back years of pages.
export const GRADE_FLOOR_MS = Date.UTC(2026, 0, 1);

/**
 * The earliest second a call's grade needs (its post minus the regime pad), or null when createdAt
 * can't be a real post (not a number, or before GRADE_FLOOR_MS). One bad createdAt must not decide
 * how far back its symbol's store reaches for everyone else's calls.
 */
export function neededFrom(createdAtMs) {
  const ms = Number(createdAtMs);
  if (!Number.isFinite(ms) || ms < GRADE_FLOOR_MS) return null;
  return Math.floor(ms / 1000) - REGIME_PAD_S;
}

// Index of the last bar at or before `sec` (binary search; t ascending), or -1.
function lastAtOrBefore(t, sec) {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= sec) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * The candles to grade a call on, or null when the store can't grade it yet: it doesn't reach back to
 * createdAt − REGIME_PAD_S, or the market printed no bar in that pad (not listed yet, or no data).
 * Returns the whole store; gradeCall / classifyRegime / planQuality all key off createdAt themselves.
 */
export function callWindow(store, createdAtMs) {
  const from = neededFrom(createdAtMs);
  if (!store || !Array.isArray(store.t) || from == null) return null;
  if (!(store.from <= from)) return null;
  const i = lastAtOrBefore(store.t, from + REGIME_PAD_S);
  if (i < 0 || store.t[i] < from) return null;
  return store;
}

/**
 * The pages still missing for a store to cover [fromSec, now], in the order to fetch them:
 * the tail first (when stale), then head pages walking back from the store's start. A symbol with
 * no store starts with its newest page, which ends at now.
 * @returns {{kind:"head"|"tail", from:number, to:number, reachesNow:boolean}[]}
 */
export function planPages(store, fromSec, nowSec, nowMs) {
  const pages = [];
  if (!store) {
    for (let to = nowSec; to > fromSec; to -= GRADE_PAGE_S) {
      pages.push({ kind: "head", from: Math.max(fromSec, to - GRADE_PAGE_S), to, reachesNow: to === nowSec });
    }
    return pages;
  }
  if (nowMs - (Number(store.fetchedAt) || 0) >= TAIL_REFRESH_MS) {
    for (let from = Math.max(store.from, store.to - TAIL_OVERLAP_S); from < nowSec; from += GRADE_PAGE_S) {
      const to = Math.min(nowSec, from + GRADE_PAGE_S);
      pages.push({ kind: "tail", from, to, reachesNow: to === nowSec });
    }
  }
  for (let to = store.from; to > fromSec; to -= GRADE_PAGE_S) {
    pages.push({ kind: "head", from: Math.max(fromSec, to - GRADE_PAGE_S), to, reachesNow: false });
  }
  return pages;
}

/**
 * Bars from one /tv/history response. "no_data" is a valid empty page (TradingView's answer for a
 * range with no bars, e.g. before listing). Anything else is a failed page, and throws.
 */
export function barsFrom(d) {
  if (d && d.s === "no_data") return [];
  if (!d || d.s !== "ok" || !Array.isArray(d.t) || !Array.isArray(d.h) || !Array.isArray(d.l) || !Array.isArray(d.c)) {
    throw new Error(`unusable candle page (${d && d.s})`);
  }
  const out = [];
  for (let i = 0; i < d.t.length; i++) {
    const bar = [Number(d.t[i]), Number(d.h[i]), Number(d.l[i]), Number(d.c[i])];
    if (bar.every(Number.isFinite)) out.push(bar);
  }
  return out;
}

/**
 * Merge one fetched page into the store. A head page must reach the store's start and a tail page
 * must start at or before its end: that is what keeps [from, to] free of holes. Bars from the page
 * replace bars at the same hour (the store's last bar may have been a partial hour).
 */
export function applyPage(store, page, bars, nowMs) {
  if (!store) {
    return withBars({ v: 2, from: page.from, to: page.to, fetchedAt: page.reachesNow ? nowMs : 0 }, [], bars);
  }
  if (page.kind === "head" && page.to < store.from) throw new Error("head page leaves a gap");
  if (page.kind === "tail" && page.from > store.to) throw new Error("tail page leaves a gap");
  const current = store.t.map((t, i) => [t, store.h[i], store.l[i], store.c[i]]);
  return withBars({
    v: 2,
    from: Math.min(store.from, page.from),
    to: Math.max(store.to, page.to),
    fetchedAt: page.reachesNow ? nowMs : store.fetchedAt,
  }, current, bars);
}

function withBars(meta, current, incoming) {
  const byT = new Map();
  for (const b of current) byT.set(b[0], b);
  for (const b of incoming) byT.set(b[0], b);
  const rows = [...byT.values()].sort((a, b) => a[0] - b[0]);
  return { ...meta, t: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]) };
}

function validStore(s) {
  return s && s.v === 2 && Number.isFinite(s.from) && Number.isFinite(s.to) && s.from <= s.to
    && Array.isArray(s.t) && [s.h, s.l, s.c].every((a) => Array.isArray(a) && a.length === s.t.length) ? s : null;
}

/**
 * A grading run's view of the candle stores: loads each symbol once, extends it within the run's
 * page budget, and writes back only what changed (flush). One instance per run.
 * @param {object} env  needs LAB_STORE
 * @param {{ budget?: number, fetchJson?: (url:string)=>Promise<any>, nowMs?: ()=>number }} [opts]
 */
export function makeGradeCandles(env, { budget = 24, fetchJson = orderlyJson, nowMs = () => Date.now() } = {}) {
  const kv = env && env.LAB_STORE;
  const stores = new Map();   // sym → store | null
  const loaded = new Map();   // sym → Promise (one KV read per symbol per run)
  const changed = new Set();
  const failed = new Set();   // Orderly refused this symbol this run: don't ask again
  let left = budget, used = 0;

  function load(sym) {
    if (!loaded.has(sym)) {
      loaded.set(sym, (async () => {
        let s = null;
        try { const raw = kv ? await kv.get(KEY(sym)) : null; s = raw ? validStore(JSON.parse(raw)) : null; } catch { s = null; }
        stores.set(sym, s);
      })());
    }
    return loaded.get(sym);
  }

  function nextPage(sym, fromSec) {
    if (failed.has(sym)) return null;
    const now = nowMs();
    return planPages(stores.get(sym) || null, fromSec, Math.floor(now / 1000), now)[0] || null;
  }

  async function runPage(sym, page) {
    left -= 1; used += 1;
    try {
      const url = `${ORDERLY}/tv/history?symbol=${encodeURIComponent(sym)}&resolution=60&from=${page.from}&to=${page.to}`;
      const bars = barsFrom(await fetchJson(url));
      stores.set(sym, applyPage(stores.get(sym) || null, page, bars, nowMs()));
      changed.add(sym);
    } catch (e) {
      failed.add(sym);
      console.error("[grade-candles]", sym, page.kind, String((e && e.message) || e));
    }
  }

  /**
   * Bring each symbol's store back to its needed start (as far as the budget allows) and return the
   * stores. One page per symbol per round, so a cold backfill gives every symbol its newest 20 days
   * before any symbol goes deeper.
   * @param {Record<string, number>} needs  sym → earliest second any of its calls needs
   */
  async function ensureAll(needs) {
    const syms = Object.keys(needs);
    await Promise.all(syms.map(load));
    for (;;) {
      const round = [];
      for (const s of syms) { const p = nextPage(s, needs[s]); if (p) round.push([s, p]); }
      if (!round.length || left <= 0) break;
      for (let i = 0; i < round.length && left > 0; i += PAGE_BATCH) {
        const batch = round.slice(i, i + Math.min(PAGE_BATCH, left));
        await Promise.all(batch.map(([s, p]) => runPage(s, p)));
      }
    }
    return Object.fromEntries(syms.map((s) => [s, stores.get(s) || null]));
  }

  /** One symbol, sequential pages (the cron and on-read paths). Returns the store (maybe partial). */
  async function ensure(sym, fromSec) {
    await load(sym);
    for (let p = nextPage(sym, fromSec); p && left > 0; p = nextPage(sym, fromSec)) await runPage(sym, p);
    return stores.get(sym) || null;
  }

  /** Write back every store this run extended. Best-effort: a failed write costs a re-fetch, never a grade. */
  async function flush() {
    if (!kv) return;
    await Promise.all([...changed].map(async (s) => {
      try { await kv.put(KEY(s), JSON.stringify(stores.get(s)), { expirationTtl: STORE_TTL_S }); } catch { /* re-fetched next run */ }
    }));
    changed.clear();
  }

  return { ensureAll, ensure, flush, pagesUsed: () => used };
}

/**
 * Candles to grade ONE call on (the cron, the permalink and the share card), or null when they
 * can't be had yet. Callers treat null as "not graded this time".
 */
export async function candlesForCall(env, symbol, createdAtMs, { budget = 6, gc } = {}) {
  const sym = gradeSymbol(symbol), from = neededFrom(createdAtMs);
  if (!sym || from == null) return null;
  const run = gc || makeGradeCandles(env, { budget });
  const store = await run.ensure(sym, from);
  if (!gc) await run.flush();
  return callWindow(store, createdAtMs);
}
