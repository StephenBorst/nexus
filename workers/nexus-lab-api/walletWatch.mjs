// Follow a wallet's moves (2026-11-14, borst: "follow a wallet's moves"). A trader who stars a tracked wallet on Smart
// Money (POST /smart/watchlist, sm:wl:{caller}) gets a note when that wallet opens or closes a position: the bell, plus
// the phone under the `wallets` push switch (OFF by default) and Telegram when linked (appendNotification). Every note
// carries the wallet's graded record (X-Ray tier from its tracked snapshots), so you know whether it's worth hearing.
//
// Source: sm:ord:events, the OPEN/CLOSE diff of the Orderly wallets on the Smart Money board (routes-smart.mjs
// updateOrderlyFeed, built hourly). Runner on lab-api's */5 cron: READS the events, its own cursor, the watcher index
// (sm:wl:index, kept by the watchlist POST) and each watcher's list; WRITES only its cursor + the notes. The first run
// only sets the cursor (nothing old replays). Trades, signs and moves nothing.
import { xrayTrack } from "./logic.mjs";

export const WL_INDEX_KEY = "sm:wl:index";
export const WL_INDEX_MAX = 500;
export const CURSOR_KEY = "sm:follow:cursor:v1";
export const NOTES_PER_WALLET_RUN = 5;

const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const usdK = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
const fmtPx = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) >= 100 ? 2 : 4 })}`;

/** Add a caller to the index of wallets with a non-empty watchlist (or drop them when it empties). Pure. */
export function nextIndex(index, caller, watching) {
  const set = new Set((Array.isArray(index) ? index : []).map((a) => String(a).toLowerCase()));
  const c = String(caller).toLowerCase();
  if (watching) set.add(c); else set.delete(c);
  return [...set].slice(-WL_INDEX_MAX);
}

/** The events newer than the cursor, oldest first, and the next cursor. First run (cursor null): none, cursor = newest. */
export function newEvents(events, cursor) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && e.addr && Number.isFinite(Number(e.ts)));
  const newest = list.reduce((m, e) => Math.max(m, Number(e.ts)), cursor ?? 0);
  if (cursor == null) return { fresh: [], cursor: newest };
  return { fresh: list.filter((e) => Number(e.ts) > cursor).sort((a, b) => a.ts - b.ts), cursor: newest };
}

/** "CONSISTENT tier over 21 tracked days" | "no tracked record yet". */
export function recordWords(track) {
  if (!track || !track.tier) return "no tracked record yet";
  const days = Number(track.daysTracked);
  return `${track.tier} tier${Number.isFinite(days) && days > 0 ? ` over ${days} tracked day${days === 1 ? "" : "s"}` : ""}`;
}

/** The note's text: the move, then the wallet's graded record. Never "copy this". */
export function moveMessage(ev, track) {
  const verb = ev.type === "OPEN" ? "opened" : "closed";
  const size = Number(ev.szUsd) > 0 ? `${usdK(Number(ev.szUsd))} ` : "";
  const at = Number(ev.price) > 0 ? ` at ${fmtPx(ev.price)}` : "";
  return `${short(ev.addr)} ${verb} a ${size}${String(ev.side).toLowerCase()} on ${ev.sym}${ev.type === "OPEN" ? at : ""}. Its record: ${recordWords(track)} (X-Ray).`;
}

const readJson = async (kv, key, fallback) => { try { const r = await kv.get(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };

/**
 * @param {object} env
 * @param {(wallet: string, notif: object) => Promise<unknown>} notify  appendNotification
 * @param {{ readHist: (address: string) => Promise<object[]>, now?: number }} deps
 */
export async function runWalletWatch(env, notify, { readHist, now = Date.now() } = {}) {
  const kv = env.LAB_STORE;
  const events = await readJson(kv, "sm:ord:events", []);
  const cursor = await readJson(kv, CURSOR_KEY, null);
  const { fresh, cursor: next } = newEvents(events, cursor);
  if (next !== cursor) await kv.put(CURSOR_KEY, JSON.stringify(next));
  if (!fresh.length) return { events: 0, sent: 0 };

  const movers = new Set(fresh.map((e) => String(e.addr).toLowerCase()));
  const index = await readJson(kv, WL_INDEX_KEY, []);
  const watchers = new Map(); // mover → callers
  for (const caller of index) {
    const list = await readJson(kv, `sm:wl:${caller}`, []);
    for (const w of list) {
      const k = String(w).toLowerCase();
      if (!movers.has(k)) continue;
      if (!watchers.has(k)) watchers.set(k, []);
      watchers.get(k).push(caller);
    }
  }
  if (!watchers.size) return { events: fresh.length, sent: 0 };

  const tracks = new Map();
  for (const m of watchers.keys()) {
    try { const h = await readHist(m); tracks.set(m, h && h.length >= 2 ? xrayTrack(h) : null); } catch { tracks.set(m, null); }
  }
  const perCaller = new Map();
  let sent = 0;
  for (const ev of fresh) {
    const m = String(ev.addr).toLowerCase();
    for (const caller of watchers.get(m) ?? []) {
      const n = perCaller.get(caller) ?? 0;
      if (n >= NOTES_PER_WALLET_RUN) continue;
      perCaller.set(caller, n + 1);
      try {
        await notify(caller, {
          id: `wallet_${m}_${ev.sym}_${ev.side}_${ev.type}_${ev.ts}`,
          type: "wallet_move",
          message: moveMessage(ev, tracks.get(m)),
          url: `/analyze?address=${m}`,
          createdAt: now,
        });
        sent++;
      } catch { /* one failed note never stops the rest */ }
    }
  }
  return { events: fresh.length, sent };
}
