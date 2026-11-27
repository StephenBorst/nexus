#!/usr/bin/env node
// Nexus Trading Labs · verify a paper run yourself. Don't trust: verify.
//
//   curl -sO https://trade.nexustradinglabs.com/verify/paper-run.mjs
//   node paper-run.mjs oi_div_reversal          (Node 18+, no dependencies, nothing to install)
//
// What it does, with nothing but public reads:
//   1. Reads the run: GET https://og.nexustradinglabs.com/signals/paper-run/<read>
//   2. A house run: checks its wallet is "0x" + the first 40 hex of sha256("nexus/house-paper/v1/<read>"). An address
//      made from a hash has no private key, so nobody (us included) can sign for it or move it.
//   3. Reads every fill check: GET https://og.nexustradinglabs.com/agent/<wallet>/tape
//   4. Re-fetches each fill's 1-minute bar FROM ORDERLY ITSELF (the public request the check names) and judges it again:
//      inside the minute's traded low–high (ON_TAPE), within 0.1% (NEAR: paper fills at the mark, an index), or not.
//      A stop or target exit: did any bar from 2 minutes before through its minute trade at the level (TRADED), or did
//      it fire on the mark alone (MARK_ONLY)?
//   5. Re-derives each closed trade's R from its own entry, exit and stop distance: R = move % ÷ stop %.
// It prints every disagreement and exits 1 if there is one. It reads; it never signs, posts or stores anything.
// Same rules as the app (app/lib/paperTape.mjs, app/lib/paperRun.mjs, app/lib/housePaper.mjs); a test there keeps
// this file's copies equal to them.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const HOUSE_PAPER_TAG = "nexus/house-paper/v1/";
export const TAPE_TOL_BPS = 10;
const MIN = 60;

/** The keyless house id for a read. */
export const houseId = (read) => "0x" + createHash("sha256").update(HOUSE_PAPER_TAG + read).digest("hex").slice(0, 40);

/** One fill against the bars around it ([[t, o, h, l, c], …], t in seconds): the minute it was taken or the one before. */
export function judgeFill(px, tMs, bars) {
  const m = Math.floor(tMs / 1000 / MIN) * MIN;
  const near = (Array.isArray(bars) ? bars : []).filter((b) => Array.isArray(b) && (b[0] === m || b[0] === m - MIN));
  if (!near.length) return { verdict: "NO_TRADES" };
  let best = null;
  for (const b of near) {
    const h = Number(b[2]), l = Number(b[3]);
    if (px >= l && px <= h) return { verdict: "ON_TAPE", bps: 0, bar: b };
    const d = (px < l ? l - px : px - h) / px * 10_000;
    if (!best || d < best.d) best = { d, b };
  }
  const bps = Math.round(best.d * 10) / 10;
  return { verdict: bps <= TAPE_TOL_BPS ? "NEAR" : "OFF", bps, bar: best.b };
}

/** A stop/target exit: did the tape reach the level in the 2 minutes before through the exit's minute? */
export function judgeTrigger(level, tMs, bars) {
  const m = Math.floor(tMs / 1000 / MIN) * MIN;
  const span = (Array.isArray(bars) ? bars : []).filter((b) => Array.isArray(b) && b[0] >= m - 2 * MIN && b[0] <= m);
  const lvl = Math.round(level.px * 1e8) / 1e8;
  if (!span.length) return { verdict: "NO_TRADES", level: lvl };
  const lo = Math.min(...span.map((b) => Number(b[3]))), hi = Math.max(...span.map((b) => Number(b[2])));
  const below = (level.side === "STOP") === level.long;
  const reached = below ? lo <= level.px : hi >= level.px;
  if (reached) return { verdict: "TRADED", level: lvl };
  const bps = Math.round(((below ? lo - level.px : level.px - hi) / level.px) * 10_000 * 10) / 10;
  return { verdict: "MARK_ONLY", level: lvl, bps };
}

const r2 = (x) => Math.round(x * 100) / 100;
/** A closed trade's move % and R from its entry, exit and stop distance (null without a stop %). */
export function tradeR({ entry, exit, side, slPct }) {
  if (!(entry > 0) || !(exit > 0)) return { movePct: null, r: null };
  const movePct = (exit / entry - 1) * 100 * (side === "SHORT" ? -1 : 1);
  return { movePct: r2(movePct), r: slPct > 0 ? r2(movePct / slPct) : null };
}

/** Orderly's /tv/history reply → [[t, o, h, l, c], …]. */
export function barsFrom(reply) {
  if (!reply || reply.s !== "ok" || !Array.isArray(reply.t)) return null;
  return reply.t.map((t, i) => [t, Number(reply.o[i]), Number(reply.h[i]), Number(reply.l[i]), Number(reply.c[i])]);
}

/** Only Orderly's public chart endpoint is ever fetched for a bar: a check can't point this script elsewhere. */
export const isOrderlySource = (u) => {
  try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "api-evm.orderly.org" && x.pathname === "/tv/history"; } catch { return false; }
};

/**
 * Check one run end to end. `fetchJson(url)` is injected (tests pass fixtures; the CLI passes fetch).
 * @returns {Promise<{ ok: boolean, lines: string[], problems: string[] }>}
 */
export async function verifyRun(read, { api = "https://og.nexustradinglabs.com", fetchJson, pauseMs = 250 } = {}) {
  const lines = [], problems = [];
  const say = (s) => lines.push(s), bad = (s) => { problems.push(s); lines.push(`  ✕ ${s}`); };
  const run = await fetchJson(`${api}/signals/paper-run/${encodeURIComponent(read)}`);
  if (!run?.ok || run.unread) { bad(`the run for "${read}" couldn't be read`); return { ok: false, lines, problems }; }
  say(`${read}: ${run.count} of ${run.target} paper trades · wallet ${run.wallet}`);

  if (run.house) {
    const id = houseId(read);
    if (String(run.wallet).toLowerCase() === id) say(`  ✓ keyless: the wallet is sha256("${HOUSE_PAPER_TAG}${read}"), so no private key exists for it`);
    else bad(`the run says it is a house run but its wallet isn't ${id}`);
  } else say(`  · its own paper wallet (registered on the read's page), not a house run`);

  const tape = await fetchJson(`${api}/agent/${run.wallet}/tape`);
  const fills = Array.isArray(tape?.fills) ? tape.fills : [];
  if (!tape?.ok) bad("the fill checks couldn't be read");
  // The trade each exit belongs to: its side sets which way a stop or target sits.
  const sideAt = new Map((run.trades || []).map((t) => [`${t.coin}:${Date.parse(t.closedAt)}`, t.side]));
  const coinOf = (sym) => String(sym).replace(/^PERP_/, "").replace(/_USDC$/, "");
  // same = re-judged on Orderly's own bars and agrees; stored = Orderly no longer serves the minute, so only the bar
  // the check kept is re-judged (the arithmetic, not the source); unreached = Orderly didn't answer from here.
  const tally = { same: 0, differ: 0, stored: 0, gone: 0, unreached: 0, skipped: 0 };
  const cache = new Map();
  for (const f of fills) {
    if (!f.source || !isOrderlySource(f.source) || f.verdict === "AVERAGED" || f.verdict === "PENDING") { tally.skipped++; continue; }
    let got = cache.get(f.source);
    if (got === undefined) {
      if (cache.size) await new Promise((r) => setTimeout(r, pauseMs)); // Orderly allows 10 requests a second per IP
      try { got = { bars: barsFrom(await fetchJson(f.source)) }; } catch { got = { unreached: true }; }
      cache.set(f.source, got);
    }
    const what = `${coinOf(f.symbol)} ${f.kind} ${new Date(f.t).toISOString().slice(0, 16)}Z at ${f.px}`;
    const bars = got.bars;
    if (!bars || !bars.length) {
      // No bar from Orderly: re-judge the bar the check kept, if it kept one (Orderly keeps 1-minute bars a few days).
      if (Array.isArray(f.bar)) {
        const again = judgeFill(Number(f.px), Number(f.t), [f.bar]);
        if (again.verdict !== f.verdict) { tally.differ++; bad(`${what}: the check says ${f.verdict}, its own stored bar says ${again.verdict}`); }
        else tally.stored++;
      } else if (got.unreached) tally.unreached++;
      else tally.gone++;
      continue;
    }
    const again = judgeFill(Number(f.px), Number(f.t), bars);
    if (again.verdict !== f.verdict && f.verdict !== "NO_DATA") { tally.differ++; bad(`${what}: the check says ${f.verdict}, Orderly's bar says ${again.verdict}`); continue; }
    if (f.trigger && f.kind === "exit") {
      const side = sideAt.get(`${coinOf(f.symbol)}:${f.t}`);
      if (side) {
        const tr = judgeTrigger({ side: f.trigger.side, long: side !== "SHORT", px: Number(f.trigger.level) }, Number(f.t), bars);
        if (tr.verdict !== f.trigger.verdict) { tally.differ++; bad(`${what}: the ${f.trigger.side.toLowerCase()} check says ${f.trigger.verdict}, Orderly's bars say ${tr.verdict}`); continue; }
      }
    }
    tally.same++;
  }
  const mark = (n, d) => (d ? "✕" : n ? "✓" : "·");
  say(`  ${mark(tally.same, tally.differ)} ${tally.same} of ${fills.length} fills re-judged on Orderly's own bars agree${tally.differ ? `, ${tally.differ} differ` : ""}`);
  if (tally.stored) say(`  ${mark(tally.stored, 0)} ${tally.stored} fills re-judged on the bar their check kept, because Orderly didn't serve that minute here (it keeps 1-minute bars a few days and blocks some datacenter IPs): this checks the arithmetic, not the source`);
  if (tally.unreached) say(`  · ${tally.unreached} fills: Orderly didn't answer from this machine (it blocks some datacenter IPs); run it from your own`);
  if (tally.gone) say(`  · ${tally.gone} fills: no bar left at Orderly and none kept`);
  if (tally.skipped) say(`  · ${tally.skipped} fills not checkable (an averaged DCA entry, or not checked yet)`);

  let rSame = 0, rDiffer = 0, rContract = 0, rMissing = 0;
  for (const t of run.trades || []) {
    if (t.rBasis !== "fill") { rContract++; continue; }
    const x = tradeR({ entry: t.entry, exit: t.exit, side: t.side, slPct: t.slPct });
    if (x.r == null) { rMissing++; continue; }
    if (Math.abs(x.r - t.r) > 0.011) { rDiffer++; bad(`trade #${t.n} ${t.coin}: R re-derived ${x.r}, served ${t.r}`); } else rSame++;
  }
  say(`  ${mark(rSame, rDiffer)} ${rSame} of ${(run.trades || []).length} trades: R re-derived from entry, exit and stop % agrees${rDiffer ? `, ${rDiffer} differ` : ""}` +
    `${rContract ? ` · ${rContract} scored by the contract (no stop % on the row)` : ""}${rMissing ? ` · ${rMissing} served without their stop %` : ""}`);
  const checked = tally.same + tally.stored + rSame;
  say(problems.length ? `${problems.length} problem(s). Each ✕ line names one.`
    : checked ? `Nothing disagrees (${tally.same + tally.stored} fills and ${rSame} trades re-checked).` : "Nothing could be re-checked from here.");
  return { ok: problems.length === 0, lines, problems };
}

// CLI: node paper-run.mjs <read> [--api URL]
const isMain = typeof process !== "undefined" && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const read = args.find((a) => !a.startsWith("--"));
  const apiAt = args.indexOf("--api");
  if (!read) {
    console.log("usage: node paper-run.mjs <read>   e.g. node paper-run.mjs oi_div_reversal\nreads: https://og.nexustradinglabs.com/signals/paper-counts");
    process.exit(2);
  }
  const fetchJson = async (u) => { const r = await fetch(u, { headers: { accept: "application/json" } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
  verifyRun(read, { fetchJson, ...(apiAt >= 0 ? { api: args[apiAt + 1] } : {}) })
    .then((res) => { console.log(res.lines.join("\n")); process.exit(res.ok ? 0 : 1); })
    .catch((e) => { console.error(`couldn't finish: ${e?.message || e}`); process.exit(2); });
}
