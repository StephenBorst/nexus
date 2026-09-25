// ── Wallet X-Ray share card: what a shared link says ─────────────────────────
// Pure + dependency-free (tested in xrayCard.test.mjs). The worker builds the unfurl
// title/description AND the PNG card from this, using the SAME grading code the page
// uses (xrayGrade.mjs) on the SAME stored tape — so a shared card can't disagree with
// the page it links to.
//
// Rules (Ember + borst, 2026-09-25):
//  • The card is always the 30D grade, shown as its PARTS (net, trades, win rate, PF),
//    lifetime as a context line. Never a 0–100 score.
//  • Below 30D's minimum the card says ACCRUING — no grade is invented for a preview.
//  • Orderly-only wallets (no Hyperliquid tape) show their WATCHED record instead.
//  • Every card is dated (it's a snapshot) and discloses a partial tape.
//  • No copy/trade prompt on the card — it's evidence; the copy gate lives on the page.
import { gradeWindow, tradesInWindow, fmtPf, WATCHED_MIN_DAYS } from "./xrayGrade.mjs";
import { fmtUsdCompact } from "./fmtUsd.mjs";

const DAY = 86400000;

export const shortAddr = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;

// "Sep 25 · 14:00 UTC" (+ year when not this year) — deterministic, no locale drift.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function utcStamp(ts, now = ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear() !== new Date(now).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : "";
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${y} · ${hh}:${mm} UTC`;
}
export function utcDay(ts, now = ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear() !== new Date(now).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${y}`;
}

const tone = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "flat");

// Inputs:
//   address      — the wallet
//   trades       — closed trades (fillsToClosedTrades of the stored tape), oldest → newest
//   completeFrom — tape complete from (null = from the wallet's first fill)
//   track        — the watched Orderly record (xrayTrack) or null
//   now          — grading time (the card's date)
export function xrayCard({ address, trades = [], completeFrom = null, track = null, now = Date.now() }) {
  const who = shortAddr(address);
  const stamp = utcStamp(now, now);
  const base = { address: String(address).toLowerCase(), who, stamp, window: "30D" };

  if (trades.length > 0) {
    const g = gradeWindow(tradesInWindow(trades, "30D", now), "30D");
    const all = gradeWindow(trades, "ALL");
    const partial30 = completeFrom != null && completeFrom > now - 30 * DAY;
    const lifetime = `lifetime ${fmtUsdCompact(all.net)} · ${all.trades.toLocaleString("en-US")} trades`
      + (completeFrom != null ? ` since ${utcDay(completeFrom, now)}` : "");
    const partialNote = partial30 ? `partial tape — complete from ${utcDay(completeFrom, now)}` : null;
    if (g.status === "GRADED") {
      return {
        ...base, kind: "HL", status: "GRADED",
        headline: `30D · ${fmtUsdCompact(g.net)} net`,
        headlineTone: tone(g.net),
        stats: [
          { label: "NET", value: fmtUsdCompact(g.net), tone: tone(g.net) },
          { label: "TRADES", value: String(g.trades), tone: "flat" },
          { label: "WIN RATE", value: `${g.winRate.toFixed(0)}%`, tone: "flat" },
          { label: "PROFIT FACTOR", value: fmtPf(g.pf), tone: g.pf > 1 ? "pos" : "neg" },
        ],
        context: lifetime, partialNote,
        title: `${who} · 30D PF ${fmtPf(g.pf)} · ${g.winRate.toFixed(0)}% win · ${g.trades} trades — Wallet X-Ray`,
        description: `${fmtUsdCompact(g.net)} net over 30 days · ${lifetime}. Graded from public Hyperliquid fills, ${stamp}.`,
      };
    }
    return {
      ...base, kind: "HL", status: "ACCRUING",
      headline: "30D · ACCRUING",
      headlineTone: "flat",
      stats: [
        { label: "TRADES · 30D", value: String(g.trades), tone: "flat" },
        { label: "NEEDED", value: String(g.min), tone: "flat" },
        { label: "NET SO FAR", value: fmtUsdCompact(g.net), tone: tone(g.net) },
        { label: "LIFETIME", value: fmtUsdCompact(all.net), tone: tone(all.net) },
      ],
      context: `${g.trades} of ${g.min} closed trades in 30 days — not enough to grade yet · ${lifetime}`,
      partialNote,
      title: `${who} · 30D accruing (${g.trades}/${g.min} trades) — Wallet X-Ray`,
      description: `Not enough 30-day trades to grade yet (${g.trades} of ${g.min}) · ${lifetime}. Public Hyperliquid fills, ${stamp}.`,
    };
  }

  if (track && !track.building && Number.isFinite(track.netRealized)) {
    const days = track.gradedWindows ?? 0;
    const span = Math.round(track.daysTracked ?? days);
    const green = track.winWindowRate != null ? `${track.winWindowRate}%` : "—";
    const dd = Number.isFinite(track.maxDrawdown) ? fmtUsdCompact(-Math.abs(track.maxDrawdown)) : "—";
    const graded = days >= WATCHED_MIN_DAYS;
    return {
      ...base, kind: "WATCHED", status: graded ? "GRADED" : "ACCRUING", window: "WATCHED",
      headline: graded ? `WATCHED ${span}D · ${fmtUsdCompact(track.netRealized)} net` : "WATCHED · ACCRUING",
      headlineTone: graded ? tone(track.netRealized) : "flat",
      stats: [
        { label: "NET REALIZED", value: fmtUsdCompact(track.netRealized), tone: tone(track.netRealized) },
        { label: "GRADED DAYS", value: `${days}${graded ? "" : `/${WATCHED_MIN_DAYS}`}`, tone: "flat" },
        { label: "GREEN DAYS", value: green, tone: "flat" },
        { label: "MAX DRAWDOWN", value: dd, tone: "flat" },
      ],
      context: `Orderly network · realized PnL snapshotted daily since we started watching (${span}d)`,
      partialNote: null,
      title: graded
        ? `${who} · Orderly, watched ${span}d · ${fmtUsdCompact(track.netRealized)} net · ${green} green days — Wallet X-Ray`
        : `${who} · Orderly, watched ${days}/${WATCHED_MIN_DAYS} graded days — Wallet X-Ray`,
      description: `${fmtUsdCompact(track.netRealized)} realized over ${span} watched days on the Orderly network. Graded from the public indexer, ${stamp}.`,
    };
  }

  return {
    ...base, kind: "NONE", status: "NONE", window: "—",
    headline: "NO GRADED RECORD YET",
    headlineTone: "flat",
    stats: [],
    context: "No perp fills on Hyperliquid and no watched Orderly record for this wallet yet",
    partialNote: null,
    title: `${who} — Wallet X-Ray`,
    description: `Paste any wallet, get its perp record graded from public data. ${stamp}.`,
  };
}

// Cache/version key for the card image: changes when the tape gains fills or the watched
// record gains a snapshot, so a re-share after new activity gets a fresh image URL
// (X caches an image URL for days; a new URL is the only way to refresh it).
export function cardVersion({ newestFillTs = null, fillCount = 0, trackPoints = 0 }) {
  return `${Number(newestFillTs) || 0}-${fillCount}-${trackPoints}`;
}
