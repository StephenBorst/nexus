// ── Price alerts: a level you set on a coin, fired once when price trades through it (borst 2026-11-23) ────────────
// "Alerts like Definitive's, but ours": you pick a coin and a level; the */5 cron reads the coin's 1-MINUTE highs and
// lows since its last look (lab-api priceWatch.mjs), so a wick that crossed and came back inside 5 minutes still
// counts. It fires once, then sits in your list as fired (with the minute and the price that crossed). Delivery: the
// in-app list always; the phone and Telegram each behind their own switch per alert (borst: "all three", a switch
// each). Share is a button, never automatic (your levels say where your positions are): the card is drawn by the
// server from Orderly's public bars, so a shared card can't show a cross that didn't trade (`verifyCross`).
//
// Pure + tested (priceAlerts.test.mjs). Facts only: a level you chose was traded. No direction, no advice, no grade.
import { marketCoin } from "./marketRead.mjs";

export const PRICE_ALERTS_MAX = 20;        // armed alerts per wallet
export const PRICE_ALERTS_FIRED_KEEP = 20; // fired alerts kept in the list
export const MIN_DISTANCE_PCT = 0.1;       // closer than this to the mark would fire at once
export const MAX_DISTANCE_PCT = 50;        // further than this is a typo, not an alert
export const MIN = 60_000;

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** Per-alert delivery switches. The in-app list is always on; phone and Telegram default on. */
export function normChannels(c) {
  const o = c && typeof c === "object" ? c : {};
  return { phone: typeof o.phone === "boolean" ? o.phone : true, telegram: typeof o.telegram === "boolean" ? o.telegram : true };
}

/**
 * A new alert, or why not. `dir` comes from the level vs the mark when it was set: above = fires when price trades at
 * or above the level, below = at or below.
 * @returns {{ alert: object } | { error: string, hint: string }}
 */
export function newAlert({ coin, level, mark, channels, now = Date.now(), id }) {
  const c = marketCoin(coin);
  const lv = num(level), mk = num(mark);
  if (!c) return { error: "bad_coin", hint: "Pick a coin." };
  if (!(lv > 0) || !Number.isFinite(lv)) return { error: "bad_level", hint: "Type a price above zero." };
  if (!(mk > 0) || !Number.isFinite(mk)) return { error: "no_mark", hint: `Couldn’t read ${c}’s price right now. Try again.` };
  const distPct = Math.abs(lv / mk - 1) * 100;
  if (distPct < MIN_DISTANCE_PCT) return { error: "too_close", hint: `That’s within ${MIN_DISTANCE_PCT}% of the price now. It would fire at once.` };
  if (distPct > MAX_DISTANCE_PCT) return { error: "too_far", hint: `That’s more than ${MAX_DISTANCE_PCT}% from the price now. Check the number.` };
  return {
    alert: {
      id: String(id || `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`),
      coin: c, level: lv, dir: lv > mk ? "above" : "below",
      setAt: now, setMark: mk, channels: normChannels(channels),
    },
  };
}

/** Armed + fired, with the fired stamps (kept apart so the runner never rewrites the list). */
export function mergeFired(alerts, fired) {
  const f = fired && typeof fired === "object" ? fired : {};
  return (Array.isArray(alerts) ? alerts : []).map((a) => (f[a.id] ? { ...a, firedAt: f[a.id].at, firedPx: f[a.id].px } : a));
}
export const isArmed = (a) => !!a && !a.firedAt;

/**
 * Did any 1-minute bar after the alert was set trade through it? Bars: [{t (ms, bar open), h, l}], any order.
 * A bar counts only if it opened after the minute the alert was set (that minute's earlier high/low isn't news).
 * @returns {{ at: number, px: number } | null} the first crossing bar and its high (above) or low (below)
 */
export function crossedIn(alert, bars) {
  if (!isArmed(alert)) return null;
  const from = Math.floor(Number(alert.setAt) / MIN) * MIN + MIN;
  const sorted = (Array.isArray(bars) ? bars : []).filter((b) => b && Number.isFinite(b.t) && b.t >= from).sort((a, b) => a.t - b.t);
  for (const b of sorted) {
    if (alert.dir === "above" && Number(b.h) >= alert.level) return { at: b.t, px: Number(b.h) };
    if (alert.dir === "below" && Number(b.l) > 0 && Number(b.l) <= alert.level) return { at: b.t, px: Number(b.l) };
  }
  return null;
}

const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const dp = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

/** "BTC traded above $60,000 at 06:42 UTC (high $60,130)." */
export function alertMessage(a, hit) {
  const px = hit?.px ?? a?.firedPx, at = hit?.at ?? a?.firedAt;
  const word = a.dir === "above" ? "above" : "below";
  return `${a.coin} traded ${word} ${money(a.level)} at ${hhmm(at)} UTC (${a.dir === "above" ? "high" : "low"} ${money(px)}).`;
}

/** The share link: the server re-reads Orderly's bars for these numbers before it draws anything. */
export function alertShareUrl(a, og = "https://og.nexustradinglabs.com") {
  const q = new URLSearchParams({ c: a.coin, l: String(a.level), d: a.dir, t: String(a.firedAt) });
  return `${og}/share/alert?${q.toString()}`;
}
export function alertShareText(a) {
  return `${a.coin} traded ${a.dir === "above" ? "above" : "below"} ${money(a.level)} at ${hhmm(a.firedAt)} UTC. Checked against Orderly’s public 1-minute bars.`;
}

/** Parse a share link's query. null = malformed (the card then says so, never draws a guess). */
export function parseShare(q) {
  const coin = marketCoin(q?.c);
  const level = num(q?.l), t = num(q?.t);
  const dir = q?.d === "above" || q?.d === "below" ? q.d : null;
  if (!coin || !(level > 0) || !dir || !(t > 1.6e12) || !(t < 4e12)) return null;
  return { coin, level, dir, t: Math.floor(t / MIN) * MIN };
}

/**
 * The card's own check, on the bars it read itself: did the minute at `t` (or the one either side, for clock skew)
 * trade through the level in that direction? Never trusts the link's numbers alone.
 */
export function verifyCross(share, minuteBars) {
  if (!share) return { ok: false, why: "bad_link" };
  const near = (Array.isArray(minuteBars) ? minuteBars : []).filter((b) => b && Math.abs(b.t - share.t) <= MIN);
  if (!near.length) return { ok: false, why: "unread" };
  const hit = near.find((b) => (share.dir === "above" ? Number(b.h) >= share.level : Number(b.l) > 0 && Number(b.l) <= share.level));
  return hit ? { ok: true, px: share.dir === "above" ? Number(hit.h) : Number(hit.l) } : { ok: false, why: "not_traded" };
}
