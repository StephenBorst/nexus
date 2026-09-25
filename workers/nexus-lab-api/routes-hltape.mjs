// ── Hyperliquid fill tape, collected forward ─────────────────────────────────
// Hyperliquid's public API serves only a wallet's 10,000 most recent fills. Anything
// older is gone from the public API for good. So we keep what we've seen: the first
// view SEEDS the tape (everything HL serves), every later view or cron sync appends
// what's new. From a wallet's first view on, the tape never loses a fill — and when it
// can't be continuous (>10k fills between syncs), `completeFrom` says so.
// Merge/gap/cap rules live in app/lib/hlTape.mjs (tested, shared with the browser).
//
//   GET /xray/hltape?address=0x…  → { fills: [compact…], completeFrom, seededAt, syncedAt, … }
//
// Public read, no auth (the fills are public on Hyperliquid). Bounded three ways so it
// can't be used to hammer HL from our IP: a per-wallet sync throttle, a per-IP sync
// budget, and a page cap per sync.
import { json } from "./shared.mjs";
import { makeRateLimiter } from "./keyProxy.mjs";
import { syncTape, tapeNewest, HL_SERVED_MAX } from "../../app/lib/hlTape.mjs";

const TAPE_PREFIX = "xray:hltape:";
const TAPE_TTL = 400 * 86400;           // refreshed on every write; idle wallets age out
export const SYNC_MIN_MS = 60 * 1000;   // a wallet syncs with HL at most once a minute
const SEED_PAGES = 8;                   // 5 pages cover HL's 10k; slack for mid-read fills
const SYNC_PAGES = 6;                   // incremental: >10k new fills is a gap anyway
const SWEEP_MAX = 30;                   // watched wallets synced per cron run

// Per-IP budget for syncs that actually call Hyperliquid (cached reads are free).
const syncLimiter = makeRateLimiter({ limit: 20, windowMs: 60000 });

const tapeKey = (addr) => TAPE_PREFIX + addr.toLowerCase();

async function hlInfoDefault(body) {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  return res.json();
}

export async function readTape(env, address) {
  const raw = await env.LAB_STORE.get(tapeKey(address));
  if (!raw) return null;
  try { const r = JSON.parse(raw); return r && r.v === 1 && Array.isArray(r.fills) ? r : null; } catch { return null; }
}

// One sync: read forward from the newest stored fill (inclusive — its return proves
// continuity) or from genesis on first view, plus the newest ~2k via userFills, merge,
// store. If the forward page fails we DON'T sync: without it a gap can't be told apart
// from a failed read, and a wrong gap would falsely mark the tape partial.
export async function syncHlTape(env, address, { hlInfo = hlInfoDefault, now = Date.now(), force = false } = {}) {
  const user = address.toLowerCase();
  const prev = await readTape(env, user);
  if (prev && !force && now - (prev.syncedAt || 0) < SYNC_MIN_MS) {
    return { record: prev, synced: false, reason: "fresh" };
  }
  const from = prev ? tapeNewest(prev) ?? 0 : 0;
  const pages = prev ? SYNC_PAGES : SEED_PAGES;
  const slices = [];
  let startTime = from;
  for (let i = 0; i < pages; i++) {
    let data;
    try {
      data = await hlInfo({ type: "userFillsByTime", user, startTime, endTime: now });
    } catch (e) {
      if (i === 0) return { record: prev, synced: false, reason: `hl_error: ${String(e?.message || e)}` };
      break; // later pages are best-effort — what we have is still continuous
    }
    if (!Array.isArray(data) || data.length === 0) break;
    slices.push(data);
    const newest = data.reduce((m, f) => Math.max(m, Number(f.time) || 0), startTime);
    if (newest <= startTime) break;
    startTime = newest;
  }
  try {
    const recent = await hlInfo({ type: "userFills", user });
    if (Array.isArray(recent)) slices.push(recent);
  } catch { /* the forward pages stand */ }

  const { record, added, gap } = syncTape(prev, slices, { now });
  // Written even when nothing is new: syncedAt drives the throttle, and the write
  // refreshes the TTL so a watched-but-quiet wallet's tape doesn't age out.
  await env.LAB_STORE.put(tapeKey(user), JSON.stringify(record), { expirationTtl: TAPE_TTL });
  return { record, synced: true, added, gap };
}

function tapeResponse(address, record, extra) {
  return {
    address: address.toLowerCase(),
    v: 1,
    fills: record ? record.fills : [],       // compact rows — see compactFill in hlTape.mjs
    fillCount: record ? record.fills.length : 0,
    completeFrom: record ? record.completeFrom : null,
    seededAt: record ? record.seededAt : null,
    syncedAt: record ? record.syncedAt : null,
    hlServedMax: HL_SERVED_MAX,
    ...extra,
  };
}

export async function handleHlTape(parts, request, env, deps = {}) {
  if (!(parts[0] === "xray" && parts[1] === "hltape" && request.method === "GET")) return null;
  const url = new URL(request.url);
  const address = (url.searchParams.get("address") || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({ error: "valid 0x address required" }, request, 400);

  const prev = await readTape(env, address);
  const now = deps.now ?? Date.now();
  const due = !prev || now - (prev.syncedAt || 0) >= SYNC_MIN_MS;
  if (!due) return json(tapeResponse(address, prev, { synced: false, reason: "fresh" }), request);

  const limiter = deps.limiter ?? syncLimiter;
  if (limiter(request.headers.get("CF-Connecting-IP") || "unknown", now)) {
    // Over budget: serve what we hold (marked stale) rather than calling HL again.
    if (prev) return json(tapeResponse(address, prev, { synced: false, reason: "rate_limited", stale: true }), request);
    return json({ error: "rate_limited", retryAfterSec: 60 }, request, 429);
  }
  const r = await syncHlTape(env, address, { hlInfo: deps.hlInfo, now });
  if (!r.record) return json({ error: "hyperliquid_unavailable", detail: r.reason }, request, 502);
  return json(tapeResponse(address, r.record, { synced: r.synced, added: r.added ?? 0, gap: !!r.gap, reason: r.reason }), request);
}

// Cron: keep every WATCHED wallet's tape growing even when nobody opens it — the whole
// point is that a busy wallet's fills are captured before HL's 10k window drops them.
// Bounded (SWEEP_MAX), sequential, best-effort per wallet.
export async function sweepHlTapes(env, { hlInfo = hlInfoDefault, now = Date.now() } = {}) {
  const listed = await env.LAB_STORE.list({ prefix: "sm:wl:" });
  const addrs = new Set();
  for (const k of listed.keys) {
    const raw = await env.LAB_STORE.get(k.name);
    if (!raw) continue;
    try { for (const a of JSON.parse(raw)) if (/^0x[a-f0-9]{40}$/i.test(a)) addrs.add(a.toLowerCase()); } catch { /* skip */ }
  }
  let synced = 0, added = 0, gaps = 0, failed = 0;
  for (const a of [...addrs].slice(0, SWEEP_MAX)) {
    try {
      const r = await syncHlTape(env, a, { hlInfo, now, force: true });
      if (r.synced) { synced++; added += r.added || 0; if (r.gap) gaps++; } else failed++;
    } catch { failed++; }
  }
  return { watched: addrs.size, synced, added, gaps, failed };
}
