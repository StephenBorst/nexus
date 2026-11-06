// ── Follow → new-call alerts ──────────────────────────────────────────────────────────────────
// When a caller publishes a public call, everyone who follows them gets an in-app notification of type
// `followed_call` (and a phone push only if that device switched on the `following` topic, OFF by default:
// push.mjs). Fired AFTER the save commits, from the calls the seal says were published for the first time
// (sealed.newlyPublished), so a re-save never repeats it. Public calls only: holders-only calls and marked
// copies stay out (isPublicCall's rule). The text names the author the server proved (the route's own wallet,
// their public display name or short address) and the stored market/side, never anything from the body.
//
// Follows are stored per follower (`follows:{wallet}` = who they follow, routes-social.mjs); there is no
// reverse index, so this scans that prefix once per publishing save, paged, capped. Bounded both ways:
// MAX_CALLS calls per save, MAX_FOLLOWERS followers per call.
import { appendNotification } from "./shared.mjs";

export const MAX_CALLS = 3;
export const MAX_FOLLOWERS = 200;
const MAX_SCAN = 5000;

const bare = (sym) => String(sym || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const shortAddr = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** Wallets whose follow list includes `wallet` (lowercased), the author left out. */
export async function followersOf(kv, wallet, { cap = MAX_FOLLOWERS } = {}) {
  const target = String(wallet).toLowerCase();
  const out = [];
  let cursor, scanned = 0;
  do {
    const page = await kv.list({ prefix: "follows:", cursor });
    for (const k of page.keys) {
      if (++scanned > MAX_SCAN || out.length >= cap) return out;
      const follower = k.name.slice("follows:".length).toLowerCase();
      if (follower === target) continue;
      let list = [];
      try { list = JSON.parse((await kv.get(k.name)) || "[]"); } catch { list = []; }
      if (Array.isArray(list) && list.some((a) => String(a).toLowerCase() === target)) out.push(follower);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** The calls a follower should hear about: public, not holders-only, not a copy, with a market and side. */
export const alertableCalls = (calls) =>
  (Array.isArray(calls) ? calls : []).filter((t) => t && t.isPublic && !t.holdersOnly && !t.duplicateOf && t.symbol && t.direction).slice(0, MAX_CALLS);

/** Fan the new calls out to the author's followers. Best-effort: never throws into the save. */
export async function notifyFollowersOfCalls(env, author, calls, { notify = appendNotification, now = Date.now } = {}) {
  const w = String(author).toLowerCase();
  const list = alertableCalls(calls);
  if (!list.length) return { sent: 0 };
  let sent = 0;
  try {
    const followers = await followersOf(env.LAB_STORE, w);
    if (!followers.length) return { sent: 0 };
    let name = null;
    try { const raw = await env.LAB_STORE.get(`profile:${w}`); name = raw ? JSON.parse(raw).displayName : null; } catch { name = null; }
    const who = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : shortAddr(w);
    for (const t of list) {
      const side = String(t.direction).toUpperCase() === "SHORT" ? "SHORT" : "LONG";
      for (const f of followers) {
        try {
          await notify(env, f, {
            id: `notif_${now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: "followed_call",
            message: `${who} posted a call: ${bare(t.symbol)} ${side}`,
            fromWallet: w,
            thesisId: t.id,
            thesisWallet: w,
            createdAt: now(),
          });
          sent++;
        } catch (e) { console.error("[follow-alert] notify failed", e?.message || e); }
      }
    }
  } catch (e) { console.error("[follow-alert] fan-out failed", e?.message || e); }
  return { sent };
}
