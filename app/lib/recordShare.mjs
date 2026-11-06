// The week's record as a post for X (/proof "Share this week's record"). Built only from GET /calls/pulse:
// people and our engines counted apart (never blended, borst 2026-11-05), the cleared read with its paper COUNT
// (never a paper P&L), and the method line. Counts only: no money number, no "proven", no hype. An unreadable
// pulse = null (no post), never zeros.
import { gradedText } from "./callPulse.mjs";

const validBlock = (b) => !!b && Number.isFinite(b.open) && Number.isFinite(b.gradedWeek);
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** @returns {string|null} */
export function recordShareText(pulse, now = Date.now()) {
  if (!pulse || pulse.ok === false || !validBlock(pulse)) return null;
  const lines = [`The record · ${day(now)}.`, ""];
  lines.push(`People: ${pulse.open} open · ${gradedText(pulse, now)}.`);
  if (validBlock(pulse.engines)) lines.push(`Our engines: ${pulse.engines.open} open · ${gradedText(pulse.engines, now)}.`);
  const h = pulse.headline;
  const sg = h?.cleared && Array.isArray(pulse.signals) ? pulse.signals.find((x) => x && typeof x.axis === "string") : null;
  if (sg) {
    lines.push("");
    const paper = sg.paper && Number.isFinite(sg.paper.trades) ? ` On paper: ${sg.paper.trades} of ${sg.paper.target}. Nothing armed.` : "";
    lines.push(`${sg.axis} cleared the bar (${sg.trades} graded trades).${paper}`);
  }
  lines.push("", "Every call graded from public price. Losses stay up.");
  return lines.join("\n");
}

export const RECORD_SHARE_URL = "https://trade.nexustradinglabs.com/proof";
/** X post with the text; `url` defaults to /proof, the record page passes recordShareLink (the picture card). */
export const recordShareHref = (text, url = RECORD_SHARE_URL) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

// ── The record as a picture (GET /og/record.png, routes-recordshare.mjs) ─────────────────────────────
// Same source and words as the post: pulse counts, people and engines apart, the cleared read's paper COUNT.
// Counts only, so no green/red on the card (brand: green/red = money only). An unreadable pulse = an honest
// "counts unavailable" card, never zeros.
export function recordCard(pulse, now = Date.now()) {
  const ok = !!pulse && pulse.ok !== false && validBlock(pulse);
  const stamp = new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (!ok) return { ok: false, stamp, cols: [], signal: null, noneCleared: false };
  const col = (label, b) => ({ label, value: `${b.open} open`, sub: gradedText(b, now) });
  const cols = [col("PEOPLE", pulse)];
  if (validBlock(pulse.engines)) cols.push(col("OUR ENGINES", pulse.engines));
  const sg = pulse.headline?.cleared && Array.isArray(pulse.signals) ? pulse.signals.find((x) => x && typeof x.axis === "string") : null;
  const signal = sg ? {
    title: `${sg.axis} cleared the bar · ${sg.trades} graded trades`,
    sub: sg.paper && Number.isFinite(sg.paper.trades) ? `On paper: ${sg.paper.trades} of ${sg.paper.target}. Nothing armed.` : "Paper record next. Nothing armed.",
  } : null;
  // "Nothing cleared" only when the board was READ and nothing cleared; an unread board makes no claim either way.
  const noneCleared = !signal && pulse.headline?.cleared === false;
  return { ok: true, stamp, cols, signal, noneCleared };
}

/** A version for the card's URLs: changes when the day or any number on the card changes (X caches by URL). */
export function recordCardVersion(pulse, now = Date.now()) {
  const c = recordCard(pulse, now);
  const s = JSON.stringify([c.stamp, c.cols, c.signal]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `${new Date(now).toISOString().slice(0, 10)}-${h.toString(36)}`;
}

export const RECORD_CARD_PAGE = "https://og.nexustradinglabs.com/share/record";
/** The share link X unfurls into the card; `v` keeps a new week's numbers from showing last week's image. */
export const recordShareLink = (pulse, now = Date.now()) => `${RECORD_CARD_PAGE}?v=${encodeURIComponent(recordCardVersion(pulse, now))}`;
