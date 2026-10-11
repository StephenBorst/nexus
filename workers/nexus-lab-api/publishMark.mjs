// ── The market price at the moment a call is published ───────────────────────────────────────
// gradeCall decides whether a call's entry was "the market" when it was posted. Without a recorded
// price it can only ask whether the entry sits inside the posting HOUR's range, and an hourly range
// leaves up to an hour of hindsight: a caller could post at 14:50 with the entry at 14:05's low and
// be graded as filled. So the first publish reads Orderly's live mark for that market and the
// registry keeps it (callLock.mjs `publishMark`). gradeCall then fills a call at the post only if
// its entry is within ENTRY_AT_MARK_PCT of that mark; any other entry waits for a later hour to
// trade it, as before. A read that fails leaves no mark and the call is graded the old way: a
// publish is never blocked on Orderly.
import { orderlyGet } from "./orderlyGet.mjs";
import { normalizeSymbol } from "./logic.mjs";

const ORDERLY = "https://api-evm.orderly.org";
/** At most this many markets get a mark per save (each is one Orderly read on the save's path). */
export const MAX_MARKS_PER_SAVE = 5;

/**
 * Orderly's mark price for a call's market, or null. Never throws.
 * @returns {Promise<{px:number, at:number, src:"orderly-mark"}|null>}
 */
export async function readPublishMark(symbol, { fetchImpl = globalThis.fetch, sleep, now = Date.now, log } = {}) {
  const perp = normalizeSymbol(symbol);
  if (!perp) return null;
  try {
    const body = await orderlyGet(`${ORDERLY}/v1/public/futures/${encodeURIComponent(perp)}`, {
      tries: 2, fetchImpl, ...(sleep ? { sleep } : {}), ...(log ? { log } : {}),
    });
    const px = Number(body?.data?.mark_price);
    return px > 0 && Number.isFinite(px) ? { px, at: now(), src: "orderly-mark" } : null;
  } catch {
    return null;
  }
}

/**
 * Marks for the calls a save publishes for the first time: { [id]: mark }. One read per market
 * (up to MAX_MARKS_PER_SAVE markets, in the order the calls appear); calls past that, or whose read
 * failed, get none.
 * @param {object[]} incoming the save's calls · @param {string[]} ids the ids it publishes anew
 * @param {(symbol:string)=>Promise<object|null>} readMark
 */
export async function marksForPublishes(incoming, ids, readMark) {
  if (typeof readMark !== "function" || !ids?.length) return {};
  const want = new Set(ids);
  const bySym = new Map();                       // perp → the ids published on it
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (!t || !want.has(t.id)) continue;
    const perp = normalizeSymbol(t.symbol);
    if (!perp) continue;
    if (!bySym.has(perp)) { if (bySym.size >= MAX_MARKS_PER_SAVE) continue; bySym.set(perp, []); }
    bySym.get(perp).push(t.id);
  }
  const out = {};
  for (const [perp, list] of bySym) {          // sequential: a handful of reads, kind to the 10 req/s limit
    const m = await readMark(perp);
    if (m && Number(m.px) > 0) for (const id of list) out[id] = { px: Number(m.px), at: Number(m.at), src: m.src };
  }
  return out;
}
