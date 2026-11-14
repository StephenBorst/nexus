// ── What the lenses showed when a call was published (2026-11-14, borst: "calls vs the lenses") ──────────────
// Like publishMark: at a call's FIRST publish the server reads two lenses for its market from its own cached
// boards and the registry keeps the snapshot (callLock.mjs `publishLens`, a server field no save can set, move or
// drop). The Lab's Stats then splits the trader's graded calls by what the lenses said at the post: with or
// against the tracked traders' 2× agreement, with or against the funding fade (app/lib/lensRecord.mjs).
//   smart     sm:consensus (NEXUS_AGENT, the Smart Money board's hourly snapshot) → the 2× rule (marketSnapshot)
//   funding   intel:mispriced:v1 (LAB_STORE, the Mispriced Board's cache; its last-good copy when cold) → stretched
// KV reads only, no network: a publish is never slowed or blocked by them. An unreadable board leaves that lens null.
import { marketSnapshot } from "../../app/lib/marketAlerts.mjs";
import { normalizeSymbol } from "./logic.mjs";

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** The two boards, as marketSnapshot reads them; either may be null. Never throws. */
export async function readLensBoards(env) {
  const agentKv = env.NEXUS_AGENT || env.LAB_STORE;
  const [sm, mp, mpLast] = await Promise.all([
    agentKv.get("sm:consensus").catch(() => null),
    env.LAB_STORE.get("intel:mispriced:v1").catch(() => null),
    env.LAB_STORE.get("intel:mispriced:lastgood").catch(() => null),
  ]);
  const consensus = parse(sm);
  const board = parse(mp) ?? parse(mpLast);
  return {
    smart: consensus && typeof consensus === "object" ? { consensus } : null,
    mispriced: board && Array.isArray(board.markets) ? board : null,
  };
}

const bare = (sym) => (normalizeSymbol(sym) || "").replace(/^PERP_/, "").replace(/_USDC$/, "");

/** Snapshots for the calls a save publishes anew: { [id]: { smartSide, smartL, smartS, stretched, fundAnnual, at } }. */
export function lensesForPublishes(incoming, ids, boards, now) {
  if (!ids?.length || !boards || (!boards.smart && !boards.mispriced)) return {};
  const want = new Set(ids);
  const out = {};
  for (const t of Array.isArray(incoming) ? incoming : []) {
    if (!t || !want.has(t.id)) continue;
    const coin = bare(t.symbol);
    if (!coin) continue;
    const s = marketSnapshot(coin, { mispriced: boards.mispriced ?? undefined, smart: boards.smart ?? undefined });
    if (s.smartSide === null && s.stretched === null) continue;
    out[t.id] = { smartSide: s.smartSide, smartL: s.smartL, smartS: s.smartS, stretched: s.stretched, fundAnnual: s.fundAnnual, at: now };
  }
  return out;
}

/** A snapshot the registry may keep (shape only; values come from the boards above). */
export function isLens(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const sideOk = x.smartSide === null || ["LONG", "SHORT", "NONE"].includes(x.smartSide);
  const strOk = x.stretched === null || typeof x.stretched === "boolean";
  return sideOk && strOk && Number(x.at) > 0 && (x.smartSide !== null || x.stretched !== null);
}
