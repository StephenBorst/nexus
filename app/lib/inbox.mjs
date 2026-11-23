// ── Your alerts: the bell's "Yours" tab (borst 2026-11-23, "a your-alerts inbox in the bell first") ─────────────────
// Every personal notification the worker writes (appendNotification → `notif:{wallet}`, ≤ 50 rows): price alerts you
// set, your calls graded / filled / at TP1 / +0.5R / expired, your agent's trades, comments, follows, copies, market and
// wallet alerts. Until now no screen read that list (NotificationBell.tsx was never mounted). Read with the wallet's
// Lab signature (POST /notifications/:w; private), marked read with PUT …/read when you open the tab.
//
// Pure + tested (inbox.test.mjs). Rows say what happened, in the worker's own words; nothing here adds a direction.
import { alertShareText, alertShareUrl } from "./priceAlerts.mjs";

export const INBOX_MAX = 30;

/** The row's label: the same words the phone shows (lab-api push.mjs TITLES). */
export const INBOX_LABELS = Object.freeze({
  call_resolved: "Call graded", thesis_closed: "Call closed", call_fill: "Call filled", call_tp1: "TP1 reached",
  call_expired: "Order expired", call_halfr: "+0.5R reached", agent_trade: "Agent", comment: "New comment",
  reaction: "New reaction", follow: "New follower", followed_call: "New call", market_alert: "Market",
  wallet_move: "Wallet you watch", price_alert: "Price alert", copy: "Call copied", challenge: "Call challenged",
});

const ADDR = /^0x[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Where a tap goes: the row's own in-app path, else its call's page; never an outside link. */
export function inboxHref(n, wallet) {
  const url = typeof n?.url === "string" ? n.url : "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  const w = String(n?.thesisWallet || wallet || "").toLowerCase();
  if (n?.thesisId && SAFE_ID.test(String(n.thesisId)) && ADDR.test(w)) return `/feed/thesis/${w}/${n.thesisId}`;
  return null;
}

export const isUnread = (n) => !!n && !n.readAt && n.read !== true;

/**
 * A fired price alert carries its own numbers, so its share link is rebuilt here (the card re-checks them).
 * @returns {{ text: string, url: string } | null}
 */
export function inboxShare(n) {
  if (n?.type !== "price_alert") return null;
  const a = { coin: n.coin, level: Number(n.level), dir: n.dir, firedAt: Number(n.firedAt) };
  if (!a.coin || !(a.level > 0) || (a.dir !== "above" && a.dir !== "below") || !(a.firedAt > 0)) return null;
  return { text: alertShareText(a), url: alertShareUrl(a) };
}

/**
 * The tab's rows, newest first. Malformed rows (no message, no time) are dropped, never shown as blanks.
 * @returns {{ id: string, type: string, label: string, message: string, at: number, unread: boolean, href: string|null, share: { text: string, url: string }|null }[]}
 */
export function inboxRows(list, wallet) {
  const out = [];
  for (const n of Array.isArray(list) ? list : []) {
    const message = typeof n?.message === "string" ? n.message.trim() : "";
    const at = Number(n?.createdAt ?? n?.ts ?? n?.at);
    if (!message || !(at > 0)) continue;
    out.push({
      id: String(n.id ?? `${n.type}-${at}`), type: String(n.type || "note"),
      label: INBOX_LABELS[n.type] || "Update", message: message.slice(0, 280), at,
      unread: isUnread(n), href: inboxHref(n, wallet), share: inboxShare(n),
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, INBOX_MAX);
}

export const unreadCount = (rows) => (Array.isArray(rows) ? rows.filter((r) => r.unread).length : 0);

/** "4m", "3h", "2d": the row's age. */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
