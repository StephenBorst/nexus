// ── GET /verify/:wallet/:id — re-grade one public call from scratch ──────────────────────────────
// The call page's "Verify outcome" button. It used to run its own first-touch check on CoinGecko
// candles: a different price source, and a rule that ignored "the entry must trade", so it could
// call a never-filled limit order a WIN while the board said PENDING. Now it runs the grader itself
// (logic.mjs gradeCall) on the same Orderly 1h candles every other grader reads (gradeCandles.mjs),
// ignoring the stored stamp, and says whether the stamp matches. `source` is the public Orderly
// request the candles come from, so anyone can fetch them and check the levels by hand.
// Public calls only (the set the feed shows): a private, holders-only or duplicate copy is a 404.
import { json, normalizeAddress } from "./shared.mjs";
import { gradeCall } from "./logic.mjs";
import { isCurrentStamp, fetchGradeHistory } from "./grading.mjs";
import { gradeSymbol } from "./gradeCandles.mjs";
import { isMinuteGraded } from "../../app/lib/minuteGrade.mjs";
import { minuteNeededFrom, minuteSourceUrl, daysBetween } from "./minuteCandles.mjs";
import { makeRateLimiter } from "./keyProxy.mjs";

const limiter = makeRateLimiter({ limit: 30, windowMs: 60_000 });
const R_EPS = 0.01;

export const isPublicCall = (t) => !!t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf;

/**
 * Fresh grade vs stored stamp.
 * verdict: MATCH (stamp == fresh grade) · MISMATCH (they differ) · UNSTAMPED (no current stamp yet;
 * the fresh grade is the answer) · NO_DATA (the call's candle window isn't loaded).
 */
export function verifyCall(t, cd) {
  const createdSec = Math.floor(Number(t?.createdAt) / 1000);
  const step = Number(cd?.step) > 0 ? Number(cd.step) : 3600;
  const candlesChecked = cd && Array.isArray(cd.t) ? cd.t.filter((s) => s >= createdSec - step).length : 0;
  const stamped = isCurrentStamp(t) ? { outcome: t.gradedOutcome, r: Number(t.gradedR) } : null;
  if (!cd) return { verdict: "NO_DATA", fresh: null, stamped, candlesChecked: 0 };
  const g = gradeCall(t, cd);
  const fresh = { outcome: g.outcome, r: g.r, ...(g.awaitingEntry ? { awaitingEntry: true } : {}), ...(g.exitReason ? { exitReason: g.exitReason } : {}) };
  let verdict = "UNSTAMPED";
  if (stamped) {
    const same = stamped.outcome === fresh.outcome && Math.abs((stamped.r || 0) - (fresh.r || 0)) < R_EPS;
    verdict = same ? "MATCH" : "MISMATCH";
  }
  return { verdict, fresh, stamped, candlesChecked };
}

export function orderlySourceUrl(symbol, createdAtMs, nowMs = Date.now()) {
  const sym = gradeSymbol(symbol);
  if (!sym) return null;
  const from = Math.floor(Number(createdAtMs) / 1000) - 3600;
  return `https://api-evm.orderly.org/tv/history?symbol=${encodeURIComponent(sym)}&resolution=60&from=${from}&to=${Math.floor(nowMs / 1000)}`;
}

/**
 * What a minute-graded call is re-graded on: the public Orderly request for its first day of minutes,
 * and our archive of every day of its window (minuteCandles.mjs), for when Orderly no longer serves them.
 */
export function minuteSources(symbol, createdAtMs, nowMs = Date.now()) {
  const sym = gradeSymbol(symbol), from = minuteNeededFrom(createdAtMs);
  if (!sym || from == null) return { source: null, archive: [] };
  const nowSec = Math.floor(nowMs / 1000);
  return {
    source: minuteSourceUrl(sym, from, Math.min(nowSec, from + 8 * 3600)),
    archive: daysBetween(from, nowSec).map((d) => `/candles/1m/${sym}/${d}`),
  };
}

export async function handleVerify(parts, request, env, deps = {}) {
  if (!(parts[0] === "verify" && parts.length === 3)) return null;
  if (request.method !== "GET") return json({ error: "method not allowed" }, request, 405);
  const now = deps.now || Date.now;
  if (limiter(request.headers.get("cf-connecting-ip") || "unknown", now())) return json({ error: "rate_limited" }, request, 429);
  const wallet = normalizeAddress(String(parts[1] || ""));
  const raw = await env.LAB_STORE.get(`lab:${wallet}`);
  if (!raw) return json({ error: "not found" }, request, 404);
  let data; try { data = JSON.parse(raw); } catch { return json({ error: "not found" }, request, 404); }
  const t = (data.theses || []).find((x) => x && x.id === parts[2]);
  if (!isPublicCall(t)) return json({ error: "not found" }, request, 404);
  const getCandles = deps.getCandles || ((sym, at) => fetchGradeHistory(sym, at, env));
  const cd = await getCandles(t.symbol, t.createdAt);
  const v = verifyCall(t, cd);
  if (isMinuteGraded(t)) {
    const src = minuteSources(t.symbol, t.createdAt, now());
    return json({
      ...v,
      method: "orderly_1m_regrade",
      source: src.source,
      archive: src.archive,
      rule: "The entry must trade first: at the post, or in the first later minute that reaches it. Then the first touch of TP1 or the stop on 1-minute highs/lows decides; a minute that touches both is a loss. A declared split closes half at TP1 and half at TP2; a declared time stop settles at the close N hours on. The minutes are archived as Orderly served them (archive).",
    }, request);
  }
  return json({
    ...v,
    method: "orderly_1h_regrade",
    source: orderlySourceUrl(t.symbol, t.createdAt, now()),
    rule: "The entry must trade first: at the post, or in the first later hour that reaches it. Then the first touch of TP1 or the stop on 1h highs/lows decides; a candle that touches both is a loss. A declared split closes half at TP1 and half at TP2.",
  }, request);
}
