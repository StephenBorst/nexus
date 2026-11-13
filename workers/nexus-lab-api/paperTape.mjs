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
// fill older than TAPE_GIVE_UP_MS is recorded NO_DATA (Orderly no longer serves that minute).
import { walletLegs, judgeFill, tapeSummary, tapeLine, TAPE_TOL_BPS } from "../../app/lib/paperTape.mjs";
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
const MIN = 60;

const lower = (a) => String(a || "").toLowerCase();
const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

/** The wallets /proof shows a paper run for. */
export const proofPaperWallets = () => [...new Set(REGISTERED_READS.map((r) => r.paperWallet).filter(Boolean).map(lower))];

export async function readTape(kv, wallet) {
  const rec = parse(await kv.get(PTAPE_KEY(wallet)), null);
  return rec && rec.v === 1 && rec.checks && typeof rec.checks === "object" ? rec : { v: 1, checks: {} };
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
      if (leg.averaged || rec.checks[leg.key] || now - leg.t < TAPE_SETTLE_MS || !fillWindow(leg.symbol, leg.t)) continue;
      todo.push({ w, leg });
    }
  }
  todo.sort((a, b) => b.leg.t - a.leg.t);
  await mapLimit(todo.slice(0, budget), 3, async ({ w, leg }) => {
    const win = fillWindow(leg.symbol, leg.t);
    let bars;
    try { bars = minuteBarsFrom(await fetchJson(win.url), win.from, win.to); }
    catch { stats.retried++; return; }                              // Orderly refused: next run
    if (!bars.length && now - leg.t < TAPE_GIVE_UP_MS) { stats.retried++; return; }
    const g = bars.length ? judgeFill(leg.px, leg.t, bars) : { verdict: "NO_DATA" };
    const o = open.get(w);
    o.rec.checks[leg.key] = {
      kind: leg.kind, symbol: leg.symbol, t: leg.t, px: leg.px, verdict: g.verdict,
      ...(g.bps != null ? { bps: g.bps } : {}), ...(g.bar ? { bar: g.bar } : {}),
      source: win.url, checkedAt: now,
    };
    o.dirty = true; stats.checked++;
  });
  for (const [w, o] of open) {
    if (!o.dirty) continue;
    try {
      await kv.put(PTAPE_KEY(w), JSON.stringify({ v: 1, checks: pruneChecks(o.rec.checks, o.legs) }));
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
    rule: `Each paper fill is checked against Orderly’s public 1-minute bar for the minute it was taken (or the minute before). ON_TAPE = inside that minute’s traded low–high. NEAR = outside it by at most ${TAPE_TOL_BPS} bps: paper fills at the mark, an index price, not a trade. OFF = further out. NO_TRADES = no bar in either minute. AVERAGED = a DCA average entry, which no single trade printed. Each check keeps the bar and the public request it came from.`,
  });
}
