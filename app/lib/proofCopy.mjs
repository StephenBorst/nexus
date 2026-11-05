// ── /proof copy: the plain lines the page prints about the record ────────────────────────────
// Display only. Every number comes from an endpoint as served (/intel/axis-backtest,
// /theses/proof-of-edge, /theses/leaderboard); nothing here grades. Pure + tested
// (proofCopy.test.mjs), so a line can't claim more than the numbers under it.

const signR = (r) => `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(2)}R`;

const STAGE_WORD = { LEAD: "a lead", EDGE: "an edge", TRADEABLE: "tradeable", PAPER: "on paper" };

// One registered read's line on the "Being tested now" list.
//   under the bar   → "9 events · needs 30"
//   at/over the bar but still REGISTERED (it didn't advance) → "31 events · failing",
//                     with the grader's own `next` as the reason line
//   advanced        → "34 events · a lead", with `next` as what it needs after that
export function pipelineLine(reg, minEvents = 30, holdoutMinEvents = 30, holdoutPct = 80) {
  const events = Math.max(0, Number(reg?.numbers?.events) || 0);
  const ev = `${events} ${events === 1 ? "event" : "events"}`;
  const next = typeof reg?.next === "string" && reg.next.trim() ? reg.next.trim() : "";
  const stage = reg?.stage;
  if (stage && stage !== "REGISTERED" && STAGE_WORD[stage]) {
    const text = `${ev} · ${STAGE_WORD[stage]}`;
    if (stage === "LEAD") {
      // pipeline-if-then.md, Lead: "A lead. Not an edge yet." with events and mean R; the holdout caveat
      // stays until the holdout passes its bar (30+ events, mean R > 0, beats 80% of random).
      const n = reg?.numbers || {};
      const parts = ["A lead. Not an edge yet."];
      if (Number.isFinite(n.meanR)) parts.push(`Mean ${signR(n.meanR)}.`);
      const held = (n.holdoutEvents ?? 0) >= holdoutMinEvents && n.holdoutMeanR > 0 && (n.holdoutBeatsRandomPct ?? 0) >= holdoutPct;
      if (!held) parts.push("Hasn't repeated on coins it was never picked on.");
      if (next) parts.push(`Next: ${next}.`);
      return { text, sub: parts.join(" "), state: "advanced" };
    }
    if (stage === "EDGE") {
      // pipeline-if-then.md, Edge: the line is fixed; the headline does not change.
      const parts = ["Beats random on new data and on coins it was never picked on. Not tested as a trade yet."];
      if (next) parts.push(`Next: ${next}.`);
      return { text, sub: parts.join(" "), state: "advanced" };
    }
    return { text, sub: next ? `Next: ${next}.` : "", state: "advanced" };
  }
  if (events < minEvents) return { text: `${ev} · needs ${minEvents}`, sub: "", state: "counting" };
  return { text: `${ev} · failing`, sub: next ? `Needs ${next}.` : "", state: "failing" };
}

// The earliest registration date across the registered reads ("Oct 17"), or "" when none.
export function countingSince(reads) {
  const ms = (Array.isArray(reads) ? reads : []).map((r) => Date.parse(r?.registeredAt)).filter(Number.isFinite);
  if (!ms.length) return "";
  return new Date(Math.min(...ms)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}


// The full record that leads the graded-call cards (the cards are the BEST calls by R, so the
// typical call has to be stated first). "Most calls lose" only while it's true.
export function callsRecordLine(summary) {
  const n = Number(summary?.resolved) || 0;
  if (!n) return null;
  const hit = Math.round(Number(summary.hitRate) || 0);
  const avg = Number(summary.avgR) || 0;
  return {
    record: `All ${n.toLocaleString("en-US")} resolved public calls: ${hit}% hit · ${signR(avg)} average.`,
    avgR: avg,
    caveat: `${hit < 50 ? "Most calls lose. " : ""}Below are the best, not the typical.`,
  };
}

// The verified-callers line. The board's own entry rule: 5+ graded calls and a positive record.
// Callers aren't tested against random entries, so the line says that too.
export function callersLine(count, minCalls = 5) {
  const n = Math.max(0, Number(count) || 0);
  const rule = `${minCalls}+ graded calls and a positive record`;
  if (!n) return `No caller qualifies for the board yet: ${rule}.`;
  return `${n} ${n === 1 ? "caller qualifies" : "callers qualify"} for the board: ${rule}. Not tested against chance.`;
}

// Graded-exit variants retired under their own pre-registered bar (graded-exit-prereg.md "Fails"),
// with the day and the reason as recorded in docs/research/pipeline-stages.json (proofCopy.test.mjs
// pins the two together). Retired is final: the scoreboard keeps grading the line, and /proof + the
// strategy shelf say Retired even if the read's verdict later comes back. Display only.
export const RETIRED_GRADED_EXITS = Object.freeze({
  basis_x_cvd: Object.freeze({ on: "2026-10-26", why: "the read fell to PROMISING, below PREDICTIVE" }),
});
export const retiredGradedExit = (axis) => RETIRED_GRADED_EXITS[axis] || null;
export const retiredLine = (r) =>
  r ? `Retired ${new Date(`${r.on}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}: ${r.why}. The paper wallet stays as a record.` : "";

// ── The /proof headline: a claim, computed from the grade (borst, 2026-11-05) ────────────────────
// pipeline-if-then.md: until a read clears, the headline stays "Nothing has proven itself yet. Here's the public
// record."; at Tradeable it names "the read, the number of trades, the date". It reads the SERVED stage, so if a
// read falls back under the bar the claim goes with it: a hand-written headline would stay up after the grade
// moved. Anything unread, failed or stale makes no claim. Never says "proven" of a cleared read: Tradeable has
// not traded on paper yet.
export const HEADLINE_DEFAULT = Object.freeze({ cleared: false, title: "Nothing has proven itself yet.", sub: "Here’s the public record." });
export const HEADLINE_MAX_AGE_MS = 6 * 3600000; // the scoreboard is cached 1h; older than this = no claim
const CLEARED_STAGES = new Set(["TRADEABLE", "PAPER"]);
const asOfDay = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function proofHeadline(scorecard, now = Date.now()) {
  if (!scorecard || scorecard.failed || !Array.isArray(scorecard?.pipeline?.reads)) return HEADLINE_DEFAULT;
  const asOf = Date.parse(scorecard.asOf);
  if (!Number.isFinite(asOf) || now - asOf > HEADLINE_MAX_AGE_MS || asOf - now > 10 * 60000) return HEADLINE_DEFAULT;
  const cleared = scorecard.pipeline.reads.filter((r) =>
    r && typeof r.axis === "string" && CLEARED_STAGES.has(r.stage) && Number(r.numbers?.exitTrades) > 0 && Number(r.numbers?.exitNetBps) > 0);
  if (!cleared.length) return HEADLINE_DEFAULT;
  const trades = (r) => `${r.numbers.exitTrades} ${r.numbers.exitTrades === 1 ? "trade" : "trades"}`;
  const day = asOfDay(asOf);
  if (cleared.length === 1) {
    const r = cleared[0];
    return { cleared: true, axes: [r.axis], title: `${r.axis} cleared the bar.`, sub: `${trades(r)}, net positive after fees. As of ${day}.` };
  }
  return {
    cleared: true, axes: cleared.map((r) => r.axis),
    title: `${cleared.length} signals cleared the bar.`,
    sub: `${cleared.map((r) => `${r.axis} (${trades(r)})`).join(", ")}, each net positive after fees. As of ${day}.`,
  };
}
