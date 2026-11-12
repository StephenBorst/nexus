// ── Which minute-graded calls are still open: one KV key per call ──────────────────────────────────
// `open1m:{wallet}:{id}`, with the call's frozen levels in the key's METADATA, so the minute grader
// lists every open call in one KV list and only reads a wallet's record when price traded one of its
// levels. One key per call, never a shared list: KV has no compare-and-set, and a publish adding a call
// while the grader removes another would lose one of the two writes.
//
// Written at publish (labWrite.mjs commit), re-built every hour by the hourly pass from the records
// themselves (gradePublicTheses → reconcileMinuteIndex: a missed write costs at most an hour), and
// removed by the minute grader once the call is graded (or isn't a public minute-graded call).
import { isMinuteGraded } from "../../app/lib/minuteGrade.mjs";

export const OPEN1M_PREFIX = "open1m:";
export const indexKey = (wallet, id) => `${OPEN1M_PREFIX}${String(wallet).toLowerCase()}:${id}`;

const num = (x) => (Number(x) > 0 ? Number(x) : undefined);

/** True for a call the minute grader owns: public, not a copy, published from the cutoff. */
export const ownsCall = (t) => !!t && t.isPublic === true && !!t.symbol && !!t.createdAt && !t.duplicateOf && isMinuteGraded(t);

/**
 * The key's metadata: what the grader needs to decide whether new bars could move the call, without
 * reading the record. Levels are frozen at publish; `f` (the fill, ms) is refreshed when it stamps one;
 * `g` = it has been stamped (WORKING / OPEN) at least once, so its first stamp isn't waiting on a touch.
 */
export function indexMeta(t) {
  const m = { s: String(t.symbol), c: Number(t.createdAt), e: num(t.entryPrice), sl: num(t.stopLoss), t1: num(t.takeProfit1) };
  if (num(t.takeProfit2)) m.t2 = num(t.takeProfit2);
  if (Number.isInteger(Number(t.timeStopH)) && t.timeStopH != null) m.ts = Number(t.timeStopH);
  if (t.fillState === "OPEN" && num(t.filledAt)) m.f = num(t.filledAt);
  if (t.fillState) m.g = 1;   // stamped by a grader at least once (WORKING or OPEN)
  return m;
}

/** Parse one listed key name back into { wallet, id }, or null. */
export function parseIndexKey(name) {
  if (typeof name !== "string" || !name.startsWith(OPEN1M_PREFIX)) return null;
  const rest = name.slice(OPEN1M_PREFIX.length), i = rest.indexOf(":");
  if (i <= 0 || i === rest.length - 1) return null;
  return { wallet: rest.slice(0, i), id: rest.slice(i + 1) };
}

/** Every indexed open call: [{ wallet, id, meta }] (all pages). */
export async function listMinuteIndex(kv) {
  const out = [];
  let cursor;
  for (let guard = 0; guard < 50; guard++) {
    const page = await kv.list({ prefix: OPEN1M_PREFIX, ...(cursor ? { cursor } : {}) });
    for (const k of page.keys || []) {
      const p = parseIndexKey(k.name);
      if (p) out.push({ ...p, meta: k.metadata || {} });
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

export const putIndex = (kv, wallet, t) => kv.put(indexKey(wallet, t.id), "1", { metadata: indexMeta(t) });

/** At publish: index the calls this save published that the minute grader owns. Best-effort. */
export async function indexPublishedCalls(kv, wallet, published) {
  const mine = (published || []).filter((t) => ownsCall(t) && t.id);
  await Promise.all(mine.map(async (t) => {
    try { await putIndex(kv, wallet, t); } catch (e) { console.error("[m1] index put", t.id, String(e?.message || e)); }
  }));
  return mine.length;
}

/**
 * Hourly: make sure every open minute-graded call has its key (the safety net under the publish
 * write). `open` = [{ wallet, t }] the pass found ungraded. Puts only what's missing. Returns how many.
 */
export async function reconcileMinuteIndex(kv, open) {
  if (!open.length) return 0;
  const have = new Set((await listMinuteIndex(kv)).map((e) => indexKey(e.wallet, e.id)));
  let added = 0;
  for (const { wallet, t } of open) {
    if (have.has(indexKey(wallet, t.id))) continue;
    try { await putIndex(kv, wallet, t); added++; } catch { /* next hour */ }
  }
  return added;
}
