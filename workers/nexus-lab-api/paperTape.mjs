// ── The tape check: paper fills against Orderly's public 1-minute bars ─────────────────────────────────
// Rule: app/lib/paperTape.mjs. This file fetches the bars, keeps the evidence and serves it.
//
// Independent of the writer: exec writes paper trades into agent:state; this only READS that state (it never
// writes NEXUS_AGENT) and keeps what it found under its own key, `ptape:{wallet}` in LAB_STORE:
//   { v: 1, checks: { [fillKey]: { kind, symbol, t, px, verdict, bps?, bar?, source, checkedAt } } }
// Each check carries the bar as Orderly served it and the public request it came from, so anyone can fetch
// the same minute and compare. A check is final once made (a finished minute never changes).
//
// Runs once an hour from lab-api's minute cron (index.js, its own invocation, away from the :17 jobs):
// /proof's paper wallets first (readPipeline `paperWallet`), then every agent in `agent:users`, a capped slice
// per run from a rotating cursor. A fill is checked once its minute has closed (TAPE_SETTLE_MS), newest
// first, within TAPE_RUN_BUDGET Orderly requests. A failed read is retried next run; an empty answer for a
// fill older than TAPE_GIVE_UP_MS is recorded NO_DATA (Orderly no longer serves that minute), and so is a
// fill that old Orderly has REFUSED on TAPE_MAX_TRIES runs (2026-11-13: Orderly appears to serve 1-minute
// bars for about 2 days and to refuse older ranges rather than answer empty, so those fills retried every
// hour forever). NO_DATA carries the reason; it is never a pass.
import { walletLegs, judgeFill, judgeTrigger, tapeSummary, tapeLine, TAPE_TOL_BPS } from "../../app/lib/paperTape.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { orderlyJson } from "./backtest.mjs";
import { minuteBarsFrom, minuteSourceUrl } from "./minuteCandles.mjs";
import { gradeSymbol } from "./gradeCandles.mjs";
import { mapLimit } from "./orderlyGet.mjs";

export const PTAPE_KEY = (a) => `ptape:${String(a).toLowerCase()}`;
const CURSOR_KEY = "ptape:cursor";
export const TAPE_RUN_BUDGET = 60;              // Orderly requests a run may make (one per fill)
export const TAPE_WALLETS_PER_RUN = 200;         // agent states a run may read, past the /proof wallets
export const TAPE_SETTLE_MS = 3 * 60_000;        // younger fills wait: their minute may still be printing
export const TAPE_GIVE_UP_MS = 3 * 86_400_000;   // an empty answer older than this = NO_DATA, final
export const TAPE_MAX_CHECKS = 300;              // kept per wallet (its live fills first)
export const TAPE_MAX_TRIES = 3;                 // refused runs before an old fill is recorded NO_DATA
const MIN = 60;

const lower = (a) => String(a || "").toLowerCase();
const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

/** The wallets /proof shows a paper run for. */
export const proofPaperWallets = () => [...new Set(REGISTERED_READS.map((r) => r.paperWallet).filter(Boolean).map(lower))];

export async function readTape(kv, wallet) {
  const rec = parse(await kv.get(PTAPE_KEY(wallet)), null);
  if (!(rec && rec.v === 1 && rec.checks && typeof rec.checks === "object")) return { v: 1, checks: {}, tries: {} };
  return { ...rec, tries: rec.tries && typeof rec.tries === "object" ? rec.tries : {} };
}

/** Keep the checks of the fills the state still shows, then the newest others, up to TAPE_MAX_CHECKS. */
export function pruneChecks(checks, legs, max = TAPE_MAX_CHECKS) {
  const live = new Set(legs.map((l) => l.key));
  const entries = Object.entries(checks || {});
  const keep = entries.filter(([k]) => live.has(k));
  const rest = entries.filter(([k]) => !live.has(k)).sort((a, b) => (b[1]?.t || 0) - (a[1]?.t || 0));
  return Object.fromEntries([...keep, ...rest].slice(0, Math.max(max, keep.length)));
}

/** The wallets this run reads: /proof's first, then a rotating slice of agent:users. Pure. */
export function walletsForRun(proof, users, cursor, perRun = TAPE_WALLETS_PER_RUN) {
  const first = proof.map(lower);
  const seen = new Set(first);
  const others = users.map(lower).filter((w) => /^0x[0-9a-f]{40}$/.test(w) && !seen.has(w) && seen.add(w));
  if (!others.length) return { wallets: first, next: 0 };
  const start = Number.isInteger(cursor) && cursor >= 0 && cursor < others.length ? cursor : 0;
  const take = [];
  for (let i = 0; i < Math.min(perRun, others.length); i++) take.push(others[(start + i) % others.length]);
  return { wallets: [...first, ...take], next: (start + take.length) % others.length };
}

/** The public Orderly request for the minutes around one fill. */
export function fillWindow(symbol, tMs) {
  const sym = gradeSymbol(symbol);
  if (!sym) return null;
  const m = Math.floor(tMs / 1000 / MIN) * MIN;
  const from = m - 2 * MIN, to = m + 2 * MIN;
  return { sym, from, to, url: minuteSourceUrl(sym, from, to) };
}

export async function runPaperTape(env, { fetchJson = orderlyJson, nowMs = () => Date.now(), budget = TAPE_RUN_BUDGET } = {}) {
  const agentKv = env.NEXUS_AGENT || env.LAB_STORE;
  const kv = env.LAB_STORE;
  const now = nowMs();
  const users = parse(await agentKv.get("agent:users"), []);
  const cursor = Number(parse(await kv.get(CURSOR_KEY), 0));
  const { wallets, next } = walletsForRun(proofPaperWallets(), Array.isArray(users) ? users : [], cursor);
  const stats = { wallets: 0, fills: 0, checked: 0, retried: 0, written: 0 };
  const open = new Map();   // wallet → { rec, legs, dirty }
  const todo = [];
  for (const w of wallets) {
    const state = parse(await agentKv.get(`agent:state:${w}`), null);
    const legs = walletLegs(state);
    if (!legs.length) continue;
    stats.wallets++; stats.fills += legs.length;
    const rec = await readTape(kv, w);
    open.set(w, { rec, legs, dirty: false });
    for (const leg of legs) {
      if (leg.averaged || now - leg.t < TAPE_SETTLE_MS || !fillWindow(leg.symbol, leg.t)) continue;
      const have = rec.checks[leg.key];
      // A stop/target exit checked before the trigger check existed is asked again, once, while Orderly
      // still serves its minutes (it can't be once they're gone).
      const triggerMissing = have && leg.level && !have.trigger && have.verdict !== "NO_DATA" && now - leg.t < TAPE_GIVE_UP_MS;
      if (have && !triggerMissing) continue;
      todo.push({ w, leg, recheck: !!triggerMissing });
    }
  }
  todo.sort((a, b) => b.leg.t - a.leg.t);
  await mapLimit(todo.slice(0, budget), 3, async ({ w, leg, recheck }) => {
    const win = fillWindow(leg.symbol, leg.t);
    const o = open.get(w);
    const old = now - leg.t >= TAPE_GIVE_UP_MS;
    let bars, refused = null;
    try { bars = minuteBarsFrom(await fetchJson(win.url), win.from, win.to); }
    catch (e) { refused = String(e?.message || e).slice(0, 120); }
    if (refused != null && recheck) { stats.retried++; return; }   // keep the check it has
    if (refused != null) {
      // A young fill just waits for the next run. An old one counts its refusals and, at TAPE_MAX_TRIES,
      // is recorded NO_DATA with the reason instead of asking Orderly every hour forever.
      if (!old) { stats.retried++; return; }
      const tries = (Number(o.rec.tries[leg.key]) || 0) + 1;
      o.dirty = true;
      if (tries < TAPE_MAX_TRIES) { o.rec.tries[leg.key] = tries; stats.retried++; return; }
      delete o.rec.tries[leg.key];
      o.rec.checks[leg.key] = { kind: leg.kind, symbol: leg.symbol, t: leg.t, px: leg.px, verdict: "NO_DATA", reason: `Orderly refused ${tries} times: ${refused}`, source: win.url, checkedAt: now };
      stats.gaveUp = (stats.gaveUp || 0) + 1;
      return;
    }
    if (!bars.length && (!old || recheck)) { stats.retried++; return; }
    const g = bars.length ? judgeFill(leg.px, leg.t, bars) : { verdict: "NO_DATA" };
    // A stop/target exit: did the tape trade at its level, or did it fire on the mark alone?
    const trig = leg.level && bars.length ? judgeTrigger(leg.level, leg.t, bars) : null;
    delete o.rec.tries[leg.key];
    o.rec.checks[leg.key] = {
      kind: leg.kind, symbol: leg.symbol, t: leg.t, px: leg.px, verdict: g.verdict,
      ...(g.bps != null ? { bps: g.bps } : {}), ...(g.bar ? { bar: g.bar } : {}),
      ...(g.verdict === "NO_DATA" ? { reason: "Orderly answered no bars for that minute" } : {}),
      ...(trig ? { trigger: { ...trig, side: leg.level.side, span: bars.filter((b) => b[0] >= win.from && b[0] <= win.from + 2 * MIN) } } : {}),
      source: win.url, checkedAt: now,
    };
    o.dirty = true; stats.checked++;
  });
  for (const [w, o] of open) {
    if (!o.dirty) continue;
    try {
      const live = new Set(o.legs.map((l) => l.key));
      const tries = Object.fromEntries(Object.entries(o.rec.tries || {}).filter(([k]) => live.has(k)));
      await kv.put(PTAPE_KEY(w), JSON.stringify({ v: 1, checks: pruneChecks(o.rec.checks, o.legs), ...(Object.keys(tries).length ? { tries } : {}) }));
      stats.written++;
    } catch (e) { console.error("[tape] write", w, String(e?.message || e)); }
  }
  try { await kv.put(CURSOR_KEY, JSON.stringify(next)); } catch { /* starts over */ }
  return stats;
}

/** One wallet's fills with their checks, for the route and the pages. Pure. */
export function tapeView(state, rec) {
  const legs = walletLegs(state);
  const checks = rec?.checks || {};
  const summary = tapeSummary(legs, checks);
  return {
    summary,
    line: tapeLine(summary),
    tolBps: TAPE_TOL_BPS,
    fills: legs.map((l) => {
      const c = l.averaged ? null : checks[l.key] || null;
      return {
        key: l.key, kind: l.kind, symbol: l.symbol, t: l.t, px: l.px,
        verdict: l.averaged ? "AVERAGED" : c?.verdict || "PENDING",
        ...(c?.bps != null ? { bps: c.bps } : {}), ...(c?.bar ? { bar: c.bar } : {}), ...(c?.source ? { source: c.source } : {}),
        ...(c?.reason ? { reason: c.reason } : {}),
        ...(c?.trigger ? { trigger: { verdict: c.trigger.verdict, side: c.trigger.side, level: c.trigger.level, ...(c.trigger.bps != null ? { bps: c.trigger.bps } : {}) } } : {}),
      };
    }),
  };
}

/** GET /agent/:a/tape — every paper fill of a wallet, checked against the public tape (public, read-only). */
export async function handlePaperTape(parts, request, env) {
  if (!(parts[0] === "agent" && parts[2] === "tape" && parts.length === 3)) return null;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" },
  });
  if (request.method !== "GET") return reply({ error: "method not allowed" }, 405);
  const wallet = lower(parts[1]);
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return reply({ error: "bad wallet" }, 400);
  const state = parse(await (env.NEXUS_AGENT || env.LAB_STORE).get(`agent:state:${wallet}`), null);
  if (!state) return reply({ error: "not found" }, 404);
  const rec = await readTape(env.LAB_STORE, wallet);
  return reply({
    ok: true, wallet, ...tapeView(state, rec),
    rule: `Each paper fill is checked against Orderly’s public 1-minute bar for the minute it was taken (or the minute before). ON_TAPE = inside that minute’s traded low–high. NEAR = outside it by at most ${TAPE_TOL_BPS} bps: paper fills at the mark, an index price, not a trade. OFF = further out. NO_TRADES = no bar in either minute. AVERAGED = a DCA average entry, which no single trade printed. For a stop or target exit, the trigger check asks whether any bar from 2 minutes before the exit through its minute traded at or through the level: TRADED, or MARK_ONLY (the exit fired on the mark alone). Each check keeps the bars and the public request they came from.`,
  });
}
