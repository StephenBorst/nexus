// ── GET /theses/status/:wallet — a wallet's public calls, as an agent reads them ─────────────────
// Unresolved calls with their state and live distances to every level, plus the last few graded
// ones. Public calls only (the same set the feed shows), so no key: anyone can already see these
// calls and their levels. Marks: ONE all-markets Orderly read, cached in this isolate for 20 s. When a
// refresh fails, the last read is reused for up to 2 min and flagged (`marksStale`); past that there
// are no marks (`marksAvailable: false`, `live: null`). `markAt` / `markAgeSec` always say how old.
// Rows from callStatus.mjs; the response states which clock each part runs on.
import { json, normalizeAddress } from "./shared.mjs";
import { callState, callStatusRow } from "./callStatus.mjs";
import { normalizeSymbol } from "./logic.mjs";
import { orderlyGet } from "./orderlyGet.mjs";
import { makeRateLimiter } from "./keyProxy.mjs";

const FUTURES_URL = "https://api-evm.orderly.org/v1/public/futures";
const MARK_TTL_MS = 20_000;
const MARK_STALE_MAX_MS = 120_000;
const RECENT = 10;
const limiter = makeRateLimiter({ limit: 60, windowMs: 60_000 });
let markCache = { at: 0, marks: null };

/**
 * { at, marks, stale }: symbol → mark for every listed market. A failed refresh reuses the last read
 * only while it's ≤ MARK_STALE_MAX_MS old (stale: true); older than that, marks is null.
 */
export async function readMarks({ fetchImpl, now = Date.now, sleep } = {}) {
  if (markCache.marks && now() - markCache.at < MARK_TTL_MS) return { ...markCache, stale: false };
  try {
    const rows = (await orderlyGet(FUTURES_URL, { tries: 2, fetchImpl, ...(sleep ? { sleep } : {}) }))?.data?.rows || [];
    const marks = {};
    for (const r of rows) { const px = Number(r?.mark_price); if (r?.symbol && px > 0) marks[r.symbol] = px; }
    markCache = { at: now(), marks };
    return { ...markCache, stale: false };
  } catch {
    if (markCache.marks && now() - markCache.at <= MARK_STALE_MAX_MS) return { ...markCache, stale: true };
    return { at: null, marks: null, stale: false };
  }
}
export function _resetMarkCache() { markCache = { at: 0, marks: null }; }

const isPublicCall = (t) => t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf && Number(t.entryPrice) > 0 && t.symbol;

export async function handleCallStatus(parts, request, env, deps = {}) {
  if (!(parts[0] === "theses" && parts[1] === "status" && parts.length === 3)) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, request, 405);
  const now = deps.now || Date.now;
  if (limiter(request.headers.get("cf-connecting-ip") || "unknown", now())) return json({ error: "rate_limited" }, request, 429);
  const wallet = normalizeAddress(String(parts[2] || ""));
  // EVM (0x + 40 hex) or a Solana key (base58, lowercased the way Lab records are keyed).
  if (!/^0x[0-9a-f]{40}$/.test(wallet) && !/^[1-9a-z]{32,44}$/.test(wallet)) return json({ error: "wallet address required" }, request, 400);

  let record = null;
  try { record = JSON.parse((await env.LAB_STORE.get(`lab:${wallet}`)) || "null"); } catch { record = null; }
  const calls = (Array.isArray(record?.theses) ? record.theses : []).filter(isPublicCall);
  const resolved = (t) => t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS";
  const open = calls.filter((t) => !resolved(t) && (!t.status || t.status === "ACTIVE"));
  const done = calls.filter(resolved).sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0)).slice(0, RECENT);

  const mk = open.some((t) => callState(t) !== "INVALID") ? await readMarks({ fetchImpl: deps.fetchImpl, now, sleep: deps.sleep }) : { at: null, marks: null, stale: false };
  const markOf = (t) => (mk.marks ? mk.marks[normalizeSymbol(t.symbol)] ?? null : null);
  const rows = open.map((t) => callStatusRow(t, markOf(t))).sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  const count = (s) => rows.filter((r) => r.state === s).length;

  return json({
    wallet,
    asOf: now(),
    markAt: mk.at || null,
    markAgeSec: mk.at ? Math.max(0, Math.round((now() - mk.at) / 1000)) : null,
    marksAvailable: !!mk.marks,
    marksStale: !!(mk.marks && mk.stale),
    counts: { working: count("WORKING"), open: count("OPEN"), runner: count("RUNNER"), unchecked: count("UNCHECKED"), invalid: count("INVALID"), recentGraded: done.length },
    calls: rows,
    recent: done.map((t) => callStatusRow(t, null)),
    note: "state = the hourly grader's stamp (WORKING: entry not traded · OPEN: live · RUNNER: split call, TP1 half closed · UNCHECKED: not stamped yet · INVALID: the grader can never grade it, see invalidReason; it stays published and counts nowhere). live = the Orderly mark at markAt (≤20 s old normally; up to 2 min with marksStale: true when Orderly can't be read; none past that), not a grade: a mark through the entry is a fill only once the hourly grade says so. levels.*.r = distance from the mark in units of the call's risk.",
  }, request);
}
