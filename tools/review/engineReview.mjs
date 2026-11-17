// The weekly engine review (borst 2026-11-16: "weekly engine review, automatic"). Reads the public API only and writes
// one HTML page: the tide, each registered read's sides against a random entry on that side, the paper wallets and the
// engine callers. Every sentence is computed from the numbers by a stated rule (reviewModel); the only free text is an
// optional "This week" block the weekly task writes from the same numbers. Nothing here signs, trades or writes to the API.
//
// Usage: NODE_USE_ENV_PROXY=1 node tools/review/engineReview.mjs --out review.html [--this-week note.txt] [--from dir]
//   --from dir reads board.json, pulse.json, pw.json, run_<axis>.json, judge_<axis>.json saved by curl instead of fetching.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { sideWords } from "../../app/lib/engineOverview.mjs";

export const API = "https://og.nexustradinglabs.com";
const CSS = readFileSync(new URL("./engineReview.css", import.meta.url), "utf8");
const SIDES = ["LONG", "SHORT"];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const fmtR = (v) => (num(v) == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`);
const pctTxt = (p) => (num(p) == null ? "—" : `${Math.round(p * 10) / 10}%`);
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
const lower = (side) => side.toLowerCase();

/** Read everything the page needs. fetchJson(path) → parsed JSON or null. */
export async function gatherReview(fetchJson) {
  const board = await fetchJson("/intel/axis-backtest");
  const pulse = await fetchJson("/calls/pulse");
  const pw = await fetchJson("/pipeline/paper-wallets");
  const paper = {};
  for (const r of Array.isArray(pw?.reads) ? pw.reads : []) {
    if (!r?.axis || !r.wallet) continue;
    paper[r.axis] = { run: await fetchJson(`/signals/paper-run/${r.axis}`), judge: await fetchJson(`/signals/paper-judge/${r.axis}`) };
  }
  return { board, pulse, paper };
}

const sideOf = (o, side) => {
  const s = o?.sides?.[side], rb = o?.random?.bySide?.[side];
  const n = s?.events ?? 0;
  if (!n) return null;
  return { n, meanR: num(s?.r?.meanR), randomR: num(rb?.randomMedianR), pct: num(rb?.pctBeaten), verdict: rb?.verdict ?? null };
};

// One plain sentence per side: the same rule /proof uses (app/lib/engineOverview.mjs), one copy.
export { sideWords };

/** Everything the page shows, computed from the API replies. Pure. */
export function reviewModel({ board, pulse, paper = {} }) {
  if (!board || !Array.isArray(board.axes) || !board.pipeline) return { error: "The scoreboard could not be read." };
  const axes = new Map(board.axes.map((a) => [a.name, a]));
  const hold = new Map((Array.isArray(board.holdout?.axes) ? board.holdout.axes : Object.values(board.holdout?.axes || {})).map((a) => [a.name, a]));
  const rules = board.pipeline.rules || {};
  const kill = rules.killEvents ?? 100;
  const tide = num(board.tide?.LONG?.meanR) != null && num(board.tide?.SHORT?.meanR) != null
    ? { since: day(board.tide.from), long: board.tide.LONG.meanR, short: board.tide.SHORT.meanR, markets: board.tide.markets ?? null } : null;

  const reads = (board.pipeline.reads || []).map((r) => {
    const a = axes.get(r.axis), o = a?.oos, h = hold.get(r.axis)?.oos;
    const sides = Object.fromEntries(SIDES.map((sd) => [sd, sideOf(o, sd)]));
    const hsides = Object.fromEntries(SIDES.map((sd) => [sd, sideOf(h, sd)]));
    const n = r.numbers || {};
    const words = [];
    if (r.stage === "RETIRED") words.push("Retired. Kept on the board with its numbers.");
    else if ((n.events ?? 0) < (rules.minEvents ?? 30)) words.push(`${(rules.minEvents ?? 30) - (n.events ?? 0)} more events before it is graded.`);
    if (r.stage !== "RETIRED") for (const sd of SIDES) { const w = sideWords(sd, sides[sd]); if (w && (n.events ?? 0) >= 10) words.push(w); }
    const away = kill - (n.events ?? 0);
    if (r.stage !== "RETIRED" && away > 0 && away <= 10 && num(n.meanR) != null && n.meanR <= 0) words.push(`${away} event${away === 1 ? "" : "s"} from the retirement check at mean ${fmtR(n.meanR)}.`);
    // A side that beats its own random on BOTH coin sets (out-of-sample, 10+ events each): the strongest thing a side can show.
    const both = SIDES.filter((sd) => sides[sd]?.n >= 10 && hsides[sd]?.n >= 10 && sides[sd].pct >= 95 && hsides[sd].pct >= 95);
    return { axis: r.axis, label: a?.label ?? r.axis, stage: r.stage, side: r.side ?? "BOTH", next: r.next ?? null, events: n.events ?? 0,
      meanR: (n.events ?? 0) ? num(n.meanR) : null, holdout: { events: n.holdoutEvents ?? 0, meanR: n.holdoutEvents ? num(n.holdoutMeanR) : null }, sides, hsides, words, both };
  });

  const advanced = reads.filter((r) => ["EDGE", "TRADEABLE", "PAPER"].includes(r.stage));
  const strong = reads.flatMap((r) => r.both.map((sd) => ({ axis: r.axis, side: sd })));
  const runs = Object.entries(paper).map(([axis, p]) => {
    const run = p?.run, judge = p?.judge;
    if (!run || !Array.isArray(run.trades)) return { axis, unread: true };
    return { axis, count: run.count ?? run.trades.length, target: run.target ?? 30, since: day(run.startedAt), tally: run.tally || {},
      trades: run.trades.map((t) => ({ coin: t.coin, side: t.side, outcome: t.outcome, reason: t.reason })),
      open: run.open ? { coin: run.open.coin, side: run.open.side, entry: run.open.entry, at: day(run.open.openedAt) } : null,
      tape: run.tape?.line ?? null, verdict: judge?.verdict ?? null, lock: board.pipeline.reads?.find((x) => x.axis === axis)?.stage ?? null };
  });
  const people = pulse && pulse.ok !== false ? { graded: pulse.gradedWeek ?? null, open: pulse.open ?? null, last: (pulse.recentGraded || []).slice(0, 3) } : null;
  const engines = Array.isArray(pulse?.engineRecords) ? pulse.engineRecords.map((e) => ({ name: e.caller || `${String(e.wallet).slice(0, 6)}…`, graded: e.graded, wins: e.wins, netR: num(e.netR), last: e.lastAt ? day(new Date(e.lastAt).toISOString()) : null })) : null;
  return { asOf: board.asOf, headline: pulse?.headline?.title ?? null, tide, rules, reads, advanced, strong, runs, people, engines };
}

const chip = (stage) => `<span class="chip ${stage === "LEAD" || stage === "EDGE" ? "lead" : stage === "RETIRED" ? "ret" : ""}">${esc(stage)}</span>`;
const rTone = (v) => (num(v) == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");
const sideCell = (s) => (s ? `${fmtR(s.meanR)} · ${s.pct == null ? "thin" : pctTxt(s.pct)}` : "—");

/** The page. `thisWeek` = optional plain text (paragraphs split on blank lines), written by the weekly task. */
export function renderReview(m, { thisWeek = "" } = {}) {
  if (m.error) return `<title>Nexus Engine Review</title><p>${esc(m.error)}</p>`;
  const MIN = -1, MAX = 1.6;
  const X = (v) => `${(((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * 100).toFixed(2)}%`;
  const ticks = [-1, -0.5, 0, 0.5, 1, 1.5];
  const chartRows = (side) => m.reads.filter((r) => r.sides[side]?.n >= 5 && r.sides[side].meanR != null && r.sides[side].randomR != null).map((r) => {
    const s = r.sides[side], lo = Math.min(s.meanR, s.randomR), hi = Math.max(s.meanR, s.randomR);
    const tip = `${r.axis} · ${side}: ${s.n} events, mean ${fmtR(s.meanR)}; random entry ${fmtR(s.randomR)}; beat ${pctTxt(s.pct)} of replays`;
    return `<div class="row" tabindex="0" title="${esc(tip)}"><span class="nm">${esc(r.axis)}</span><span class="track">${ticks.map((t) => `<span class="${t === 0 ? "zero" : "grid"}" style="left:${X(t)}"></span>`).join("")}<span class="seg${s.meanR > s.randomR ? " up" : ""}" style="left:${X(lo)};width:calc(${X(hi)} - ${X(lo)})"></span><span class="m rnd" style="left:${X(s.randomR)}"></span><span class="m real" style="left:${X(s.meanR)}"></span></span><span class="pct${(s.pct ?? 0) >= 95 ? " hi" : ""}">${s.pct == null ? "—" : Math.round(s.pct) + "%"}</span></div>`;
  }).join("");
  const axis = `<div class="axis"><span></span><span class="ticks">${ticks.map((t) => `<span style="left:${X(t)}">${t === 0 ? "0" : (t > 0 ? "+" : "−") + Math.abs(t)}R</span>`).join("")}</span><span class="pcth">BEAT</span></div>`;
  const panel = (side, tideR) => `<div class="panel"><div class="panel-h"><span class="tag">${side}</span><span class="tide">random ${lower(side)}: ${fmtR(tideR)}</span></div>${chartRows(side) || `<p class="note">No registered read has 5+ new-data ${lower(side)}s yet.</p>`}${axis}</div>`;
  const tw = String(thisWeek || "").trim();
  const strongLine = m.strong.length
    ? `${m.strong.map((x) => `the ${lower(x.side)} side of ${esc(x.axis)}`).join(" and ")} beat${m.strong.length === 1 ? "s" : ""} a random entry on its side on both coin sets.`
    : "No side beats its own random entry on both coin sets yet.";
  const tideWords = m.tide ? (m.tide.long < 0 && m.tide.short > 0 ? "Shorts paid, longs bled." : m.tide.long > 0 && m.tide.short < 0 ? "Longs paid, shorts bled." : "No strong tide either way.") : "Unread.";

  return `<title>Nexus Engine Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Libre+Baskerville:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
<div class="wrap">
  <header>
    <div class="rule"></div>
    <div class="eyebrow">Engine review · board as of ${esc(new Date(m.asOf).toISOString().slice(0, 16).replace("T", " "))} UTC · rebuilt weekly from the public API</div>
    <h1>${m.advanced.length ? "Something cleared a bar." : "Nothing has cleared its bar."}</h1>
    <p class="lede">Every read is judged against a random entry on the same coins, side and hours. This page shows that comparison for each read under test, the paper wallets, and the engine callers.</p>
  </header>
  ${tw ? `<section class="col"><h2>This week</h2>${tw.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("")}</section>` : ""}
  <section class="col"><h2>The answer</h2><div class="answer">
    <div class="k">Past the bar</div><div class="v">${m.advanced.length ? esc(m.advanced.map((r) => `${r.axis} (${r.stage})`).join(", ")) : "None."} <span>${m.headline ? `/proof says “${esc(m.headline)}”` : ""}</span></div>
    <div class="k">The market</div><div class="v">${tideWords} <span>${m.tide ? `A random long earned ${fmtR(m.tide.long)} a trade since ${esc(m.tide.since)}, a random short ${fmtR(m.tide.short)}.` : ""}</span></div>
    <div class="k">Skill on one side</div><div class="v">${m.strong.length ? `${m.strong.length} side${m.strong.length === 1 ? "" : "s"}.` : "None yet."} <span>${strongLine}</span></div>
    <div class="k">Money</div><div class="v">Nothing goes live from this page. <span>Arming is borst’s call, in person.</span></div>
  </div></section>
  <section><div class="col" style="display:flex;flex-direction:column;gap:12px"><h2>Each read against a random entry, one side at a time</h2>
    <p>New data only (events since each read was registered), main card. The gap between the dot and the ring is the read’s own contribution. The right column is the share of 300 random replays it beat; the bar for an edge is ${esc(m.rules.edgePct ?? 95)}%.</p></div>
    <div class="legend"><span class="lg"><span class="dot"></span>The read’s mean R</span><span class="lg"><span class="ring"></span>Random entry, median of 300 replays</span></div>
    <div class="panels">${panel("LONG", m.tide?.long)}${panel("SHORT", m.tide?.short)}</div>
  </section>
  <section><div class="col" style="display:flex;flex-direction:column;gap:12px"><h2>Read by read</h2><p>Stage as served. Each sentence follows a fixed rule from the numbers beside it.</p></div>
    <div class="tablewrap"><table><thead><tr><th>Read</th><th>Stage</th><th>Events</th><th>Mean R</th><th>Long vs random</th><th>Short vs random</th><th>Holdout</th></tr></thead><tbody>
    ${m.reads.map((r) => `<tr class="d"><td class="nm">${esc(r.axis)}</td><td>${chip(r.stage)}</td><td class="r">${r.events}</td><td class="r"><span class="${rTone(r.meanR)}">${fmtR(r.meanR)}</span></td><td class="r">${sideCell(r.sides.LONG)}</td><td class="r">${sideCell(r.sides.SHORT)}</td><td class="r">${r.holdout.events} · ${fmtR(r.holdout.meanR)}</td></tr><tr><td></td><td class="why" colspan="6">${esc([...r.words, r.next && r.stage !== "RETIRED" ? `Next: ${r.next}.` : ""].filter(Boolean).join(" "))}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section><div class="col" style="display:flex;flex-direction:column;gap:12px"><h2>The paper wallets</h2><p>Judged at 30 trades after fees. No dollar figures before then.</p></div>
    <div class="two">${m.runs.length ? m.runs.map((p) => p.unread ? `<div class="card"><div class="panel-h"><span class="tag">${esc(p.axis.toUpperCase())}</span></div><p class="note">Unread right now.</p></div>` : `<div class="card"><div class="panel-h"><span class="tag">${esc(p.axis.toUpperCase())}</span><span class="tide">${p.count} of ${p.target} · since ${esc(p.since)}</span></div>
      <div class="trades">${p.trades.map((t) => `<span class="t ${t.outcome === "WIN" ? "w" : t.outcome === "LOSS" ? "l" : ""}">${esc(t.coin)} ${esc(String(t.side)[0])} ${esc(t.reason)}</span>`).join("")}${p.open ? `<span class="t o">${esc(p.open.coin)} ${esc(String(p.open.side)[0])} open</span>` : ""}</div>
      <dl class="kv"><dt>Closed</dt><dd>${p.tally.win ?? 0} targets, ${p.tally.loss ?? 0} stops${p.tally.time ? `, ${p.tally.time} time stops` : ""}.</dd>${p.open ? `<dt>Open</dt><dd>${esc(p.open.coin)} ${esc(lower(p.open.side))} from ${esc(p.open.entry)} (${esc(p.open.at)})</dd>` : ""}${p.tape ? `<dt>Tape</dt><dd>${esc(p.tape)}</dd>` : ""}<dt>Judgment</dt><dd>${esc(p.verdict ?? "unread")}</dd></dl></div>`).join("") : `<p class="note">No paper wallets registered.</p>`}</div></section>
  <section><div class="col" style="display:flex;flex-direction:column;gap:12px"><h2>The callers</h2></div><div class="two">
    <div class="card"><div class="panel-h"><span class="tag">ENGINES</span><span class="tide">all-time graded</span></div><dl class="kv">${m.engines?.length ? m.engines.map((e) => `<dt>${esc(e.name)}</dt><dd><span class="num">${esc(e.graded)}</span> graded · ${esc(e.wins)} wins · <span class="num ${rTone(e.netR)}">${fmtR(e.netR)}</span> net${e.last ? ` · last graded ${esc(e.last)}` : ""}</dd>`).join("") : "<dt>—</dt><dd>Unread.</dd>"}</dl></div>
    <div class="card"><div class="panel-h"><span class="tag">PEOPLE</span><span class="tide">last 7 days</span></div><dl class="kv">${m.people ? `<dt>Graded</dt><dd><span class="num">${esc(m.people.graded ?? "—")}</span> calls · ${esc(m.people.open ?? "—")} open</dd>${m.people.last.length ? `<dt>Last</dt><dd>${esc(m.people.last.map((c) => `${String(c.symbol)} ${lower(String(c.direction))} ${c.outcome === "WIN" ? "+" : ""}${c.r}R`).join(" · "))}</dd>` : ""}` : "<dt>—</dt><dd>Unread.</dd>"}</dl></div>
  </div></section>
  <footer><span>Every number is read from the public API by tools/review/engineReview.mjs. A snapshot: these numbers move every hour.</span>
    <code>og.nexustradinglabs.com/intel/axis-backtest · asOf ${esc(m.asOf)}</code><code>/calls/pulse · /pipeline/paper-wallets · /signals/paper-run/:axis · /signals/paper-judge/:axis</code>
    <span>Bar: ${esc(m.rules.minEvents ?? 30)} new events, mean R &gt; 0 with both halves agreeing; beat ${esc(m.rules.edgePct ?? 95)}% of random replays and each side with ${esc(m.rules.sideMinEvents ?? 20)}+ events at least ${esc(m.rules.sidePct ?? 50)}% of its own; holdout ≥ ${esc(m.rules.holdoutPct ?? 80)}%; exit test on ${esc(m.rules.exitMinTrades ?? 30)} trades; retirement check at ${esc(m.rules.killEvents ?? 100)} events.</span></footer>
</div>`;
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const out = arg("--out"), from = arg("--from"), note = arg("--this-week");
  if (!out) { console.error("usage: engineReview.mjs --out file.html [--this-week note.txt] [--from dir]"); process.exit(2); }
  const fromDir = (path) => {
    const name = path === "/intel/axis-backtest" ? "board" : path === "/calls/pulse" ? "pulse" : path === "/pipeline/paper-wallets" ? "pw"
      : path.startsWith("/signals/paper-run/") ? `run_${path.split("/").pop()}` : `judge_${path.split("/").pop()}`;
    const f = `${from}/${name}.json`;
    try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; }
  };
  const live = async (path) => { try { const r = await fetch(API + path); return r.ok ? await r.json() : null; } catch { return null; } };
  const data = await gatherReview(from ? fromDir : live);
  const m = reviewModel(data);
  writeFileSync(out, renderReview(m, { thisWeek: note && existsSync(note) ? readFileSync(note, "utf8") : "" }));
  console.log(JSON.stringify({ ok: !m.error, out, asOf: m.asOf ?? null, reads: m.reads?.length ?? 0, strong: m.strong ?? [], advanced: (m.advanced || []).map((r) => r.axis) }));
}
