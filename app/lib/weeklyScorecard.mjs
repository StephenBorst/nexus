// The weekly scorecard on /proof (borst 2026-11-16, pipeline-if-then.md "Weekly scorecard"): one frozen snapshot per
// week (Monday 00:00 UTC → the next Monday), built by lab-api from what it already serves, stored once, never rewritten,
// with its sha256 published so anyone can check a past week wasn't edited. Pure: the worker passes the data in.
//
// What it may show (the signed section): each registered read's NEW-DATA numbers (events this week and since
// registration, mean R, each side against a random entry on that side; "not a grade"), stage moves; paper runs as
// COUNTS only (no average or sum of R before the 30-trade judgment); graded calls by people and by our engines APART
// (count, wins, net R, MAE/MFE medians in R from calls that carry them); no regime split until the trend-gate judge.

import { parsePersonFrom } from "./callPulse.mjs";

export const WEEKLY_V = 1;
const DAY = 86_400_000;
const SIDES = ["LONG", "SHORT"];
const r2 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** The last complete week before `now`: Monday 00:00 UTC → the next Monday 00:00. `week` = its Monday, YYYY-MM-DD. */
export function lastCompletedWeek(now = Date.now()) {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Monday = 0
  const to = midnight - sinceMonday * DAY;
  const from = to - 7 * DAY;
  return { week: new Date(from).toISOString().slice(0, 10), from, to };
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

// Same filters as callPulse (app/lib/callPulse.mjs): public, not holders-only, not a marked copy, a current grade.
const isPublic = (t) => !!t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf;
const isGraded = (t) => t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS";
const addrSet = (list) => new Set((list || []).flatMap((a) => String(a || "").split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean));

/**
 * Graded calls whose resolution (exitedAt, else gradedAt) falls in [from, to): people and engines apart.
 * @param {{ wallet: string, theses: any[] }[]} records
 */
export function weeklyCalls(records, { from, to }, opts = {}) {
  const exclude = addrSet(opts.exclude), engines = addrSet(opts.engines), personFrom = parsePersonFrom(opts.personFrom);
  const isCurrent = typeof opts.isCurrent === "function" ? opts.isCurrent : isGraded;
  const blank = () => ({ graded: 0, wins: 0, netR: 0, mae: [], mfe: [] });
  const out = { people: blank(), engines: blank() };
  for (const rec of records || []) {
    const w = String(rec?.wallet || "").toLowerCase();
    if (!w || exclude.has(w)) continue;
    const pf = personFrom.get(w);
    const b = pf === undefined && engines.has(w) ? out.engines : out.people;
    for (const t of rec.theses || []) {
      if (!isPublic(t) || !isGraded(t) || !isCurrent(t)) continue;
      if (pf !== undefined && !(Number(t.publishedAt) >= pf)) continue;
      const at = Number(t.exitedAt) || Number(t.gradedAt) || 0;
      if (!(at >= from && at < to)) continue;
      b.graded += 1;
      if (t.gradedOutcome === "WIN") b.wins += 1;
      const r = Number(t.gradedR);
      if (Number.isFinite(r)) b.netR += r;
      if (Number.isFinite(Number(t.maeR)) && t.maeR !== null) b.mae.push(Number(t.maeR));
      if (Number.isFinite(Number(t.mfeR)) && t.mfeR !== null) b.mfe.push(Number(t.mfeR));
    }
  }
  const done = (b) => ({ graded: b.graded, wins: b.wins, netR: r2(b.netR) ?? 0,
    mae: { n: b.mae.length, median: median(b.mae) }, mfe: { n: b.mfe.length, median: median(b.mfe) } });
  return { people: done(out.people), engines: done(out.engines) };
}

const sideOf = (o, side) => {
  const s = o?.sides?.[side], rb = o?.random?.bySide?.[side];
  if (!s?.events) return null;
  return { n: s.events, meanR: r2(s?.r?.meanR), randomR: r2(rb?.randomMedianR), pct: typeof rb?.pctBeaten === "number" ? rb.pctBeaten : null };
};

/**
 * Paper runs as counts only. `paper` = { [axis]: { wallet, state } } (exec's agent:state). Trades closed in the week,
 * by exit, and the lifetime count of 30. Never a sum or average of R (the 30-trade judgment does that once).
 */
export function weeklyPaper(paper, { from, to }) {
  return Object.entries(paper || {}).map(([axis, p]) => {
    const st = p?.state;
    if (!st) return { axis, wallet: p?.wallet ?? null, unread: true };
    const rows = Array.isArray(st.paper_trades) ? st.paper_trades : [];
    const inWeek = rows.filter((t) => { const c = Date.parse(t?.closed_at ?? ""); return Number.isFinite(c) && c >= from && c < to; });
    const by = (reason) => inWeek.filter((t) => t.reason === reason).length;
    const lifetime = Number(st?.paper_agg?.trades);
    return { axis, wallet: p.wallet, closedWeek: inWeek.length, targets: by("TP"), stops: by("SL"), timeStops: by("TIMEOUT"),
      other: inWeek.length - by("TP") - by("SL") - by("TIMEOUT"), trades: Number.isFinite(lifetime) ? lifetime : null, of: 30,
      verdict: p.verdict ?? null };
  });
}

/**
 * The snapshot. `board` = the stored scoreboard; `prev` = last week's snapshot or null; `calls` from weeklyCalls; `paper`
 * from weeklyPaper. Built once, stored as JSON.stringify(snapshot); its sha256 is published beside it.
 */
export function weeklySnapshot({ board, prev = null, calls, paper, week, builtAt }) {
  if (!board || !Array.isArray(board.axes) || !board.pipeline) return null;
  const axes = new Map(board.axes.map((a) => [a.name, a]));
  const hold = new Map((Array.isArray(board.holdout?.axes) ? board.holdout.axes : Object.values(board.holdout?.axes || {})).map((a) => [a.name, a]));
  const was = new Map((prev?.reads || []).map((r) => [r.axis, r]));
  const reads = (board.pipeline.reads || []).map((r) => {
    const o = axes.get(r.axis)?.oos, n = r.numbers || {}, p = was.get(r.axis);
    const events = n.events ?? 0;
    return {
      axis: r.axis, stage: r.stage, stageWas: p ? p.stage : null, next: r.next ?? null,
      events, eventsWeek: p ? Math.max(0, events - (p.events ?? 0)) : null,
      meanR: events ? r2(n.meanR) : null,
      sides: Object.fromEntries(SIDES.map((s) => [s, sideOf(o, s)])),
      holdout: { events: n.holdoutEvents ?? 0, meanR: n.holdoutEvents ? r2(n.holdoutMeanR) : null },
      registeredAt: r.registeredAt ?? null,
    };
  });
  const tide = typeof board.tide?.LONG?.meanR === "number" && typeof board.tide?.SHORT?.meanR === "number"
    ? { from: board.tide.from ?? null, to: board.tide.to ?? null, long: r2(board.tide.LONG.meanR), short: r2(board.tide.SHORT.meanR) } : null;
  return {
    v: WEEKLY_V, week: week.week, from: new Date(week.from).toISOString(), to: new Date(week.to).toISOString(),
    builtAt: new Date(builtAt).toISOString(), boardAsOf: board.asOf ?? null, tide, reads, paper, calls,
    note: "New data = events since each read's registration. Each side is compared with a random entry on the same coins, side and hours. Not a grade: the stage is. Paper runs are counts until their 30-trade judgment.",
  };
}

// ── /proof view, pure ──────────────────────────────────────────────────────────────────────────────────
const fR = (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`);
export const fmtR = fR;
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

/** "Nov 9 – Nov 15" (the week's last day is the Sunday before `to`). */
export function weekLabel(s) {
  if (!s?.from || !s?.to) return "";
  return `${day(s.from)} – ${day(new Date(Date.parse(s.to) - DAY).toISOString())}`;
}

/** One plain line per side, the same rule the review uses: judged against its random entry, never zero. */
export function sideLine(side, s) {
  if (!s) return null;
  const S = side === "LONG" ? "Longs" : "Shorts", w = side === "LONG" ? "longs" : "shorts";
  if (s.n < 10 || s.pct == null) return `${S}: ${s.n} new events, too few to compare.`;
  return `${S} ${fR(s.meanR)} vs random ${w} ${fR(s.randomR)} (beat ${Math.round(s.pct)}% of replays).`;
}

/** The stage line for a read this week: a move, or where it stands. */
export function stageLine(r) {
  if (r.stageWas && r.stageWas !== r.stage) return `${r.stageWas} → ${r.stage}`;
  return r.stage;
}

/** People / engines in one line each. MAE/MFE only when calls carry them. */
export function callsLine(b, who) {
  if (!b || !b.graded) return `${who}: no calls graded this week.`;
  const parts = [`${who}: ${b.graded} graded, ${b.wins} won, ${fR(b.netR)} net`];
  if (b.mae?.n) parts.push(`median went ${fR(-Math.abs(b.mae.median))} against and ${fR(b.mfe?.median)} for (${b.mae.n} with a path)`);
  return parts.join(" · ") + ".";
}
