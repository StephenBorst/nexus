// ── GET /calls/pulse — the Lab pulse: people's calls and our engines' calls, counted apart ──
// Read by the app's strip on Trade + Spot (LabPulseChip.tsx), the Lab home Calls panel (LabCallsPanel.tsx)
// and the landing page's hero record. Rule: app/lib/callPulse.mjs. House callers (HOUSE_CALLER_ADDRESS,
// HOUSE_CATALYST_ADDRESS) are left out; the engine wallets (ENGINE_CALLER_ADDRESSES, wrangler.toml) are
// counted in their own `engines` block. Each listed call carries its caller's public display name (`caller`).
// No money, nothing written but its own 5-minute cache. Public, read-only, any origin (the landing).
//
// `headline` = proofHeadline() on the scoreboard's OWN cache, never a fresh scorecard run (that's the
// heavy route). `signals` = the reads that cleared the bar + their paper progress (signalProgress.mjs; the paper
// count is the wallet's lifetime `paper_agg.trades` from NEXUS_AGENT, unread = null).
// The scoreboard's cache lives 1h and only /proof fills it, so the last good {headline, signals} is kept in
// PULSE_BOARD_KEY and reused while its scoreboard is ≤ HEADLINE_MAX_AGE_MS old (the headline's own freshness rule);
// older or missing = `headline: null`, `signals: []` = no claim.
import { callPulse, PULSE_WINDOW_MS } from "../../app/lib/callPulse.mjs";
import { proofHeadline, HEADLINE_MAX_AGE_MS } from "../../app/lib/proofCopy.mjs";
import { signalProgress, paperWalletsFor } from "../../app/lib/signalProgress.mjs";
import { isCurrentStamp } from "./grading.mjs";

export const PULSE_CACHE_KEY = "calls:pulse:v5"; // v5 = + signals (cleared reads + paper progress), last-good board · v4 = + engineRecords (per-engine all-time record, /proof) · v3 = people vs engines split + caller names · v2 = + openCalls / recentGraded
const PULSE_TTL_S = 300;
export const PULSE_BOARD_KEY = "calls:pulse:board:v1";

/** Lifetime paper trades per wallet (lowercased), from exec's state record. Unreadable = null, never 0. */
async function paperCounts(env, wallets) {
  const kv = env.NEXUS_AGENT || env.LAB_STORE;
  const out = {};
  for (const w of wallets) {
    const k = w.toLowerCase();
    try {
      const raw = await kv.get(`agent:state:${k}`);
      const n = raw ? Number(JSON.parse(raw)?.paper_agg?.trades) : NaN;
      out[k] = raw ? (Number.isFinite(n) ? n : 0) : null; // a state with no closed trade yet = 0; no state = unread
    } catch { out[k] = null; }
  }
  return out;
}

/** {headline, signals} from the scoreboard cache, else the last good copy while it's fresh enough. */
async function boardView(env, scorecardKey, now) {
  let sc = null;
  if (scorecardKey) { try { const raw = await env.LAB_STORE.get(scorecardKey); sc = raw ? JSON.parse(raw) : null; } catch { sc = null; } }
  if (sc) {
    const signals = signalProgress(sc, await paperCounts(env, paperWalletsFor(sc)));
    const view = { headline: proofHeadline(sc, now), signals, boardAsOf: sc.asOf || null };
    try { await env.LAB_STORE.put(PULSE_BOARD_KEY, JSON.stringify(view), { expirationTtl: Math.ceil(HEADLINE_MAX_AGE_MS / 1000) }); } catch { /* serve without saving */ }
    return view;
  }
  try {
    const raw = await env.LAB_STORE.get(PULSE_BOARD_KEY);
    const v = raw ? JSON.parse(raw) : null;
    const age = now - Date.parse(v?.boardAsOf || "");
    if (v && Number.isFinite(age) && age >= 0 && age <= HEADLINE_MAX_AGE_MS) {
      // Re-read the paper counts: they move between scoreboard refreshes.
      const counts = await paperCounts(env, (v.signals || []).map((x) => x.paper?.wallet).filter(Boolean));
      const signals = (v.signals || []).map((x) => (x.paper ? { ...x, paper: { ...x.paper, trades: counts[x.paper.wallet.toLowerCase()] ?? null } } : x));
      return { headline: v.headline || null, signals, boardAsOf: v.boardAsOf };
    }
  } catch { /* no claim */ }
  return { headline: null, signals: [], boardAsOf: null };
}

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": status === 200 ? "public, max-age=120" : "no-store",
    "Access-Control-Allow-Origin": "*",
  },
});

async function listAll(kv, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

const shortAddr = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** Puts each listed caller's public display name on its rows (`caller`); no name = the short address
 *  (an engine row says it's an engine through its own `engine` flag). One profile read per distinct wallet. */
async function nameCallers(env, counts) {
  const rows = [counts, counts.engines].flatMap((b) => [...b.openCalls, ...b.recentGraded, ...(b.last ? [b.last] : [])])
    .concat((counts.engineRecords || []).map((r) => Object.assign(r, { engine: true })));
  const names = new Map();
  for (const w of new Set(rows.map((r) => r.wallet))) {
    let name = null;
    try { const raw = await env.LAB_STORE.get(`profile:${w}`); name = raw ? (JSON.parse(raw).displayName || null) : null; } catch { name = null; }
    names.set(w, typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : null);
  }
  for (const r of rows) r.caller = names.get(r.wallet) || shortAddr(r.wallet);
}

/** Builds the pulse from KV. Exported for the test (fake KV, fixed clock). */
export async function buildPulse(env, { now = Date.now(), scorecardKey } = {}) {
  const records = [];
  for (const name of await listAll(env.LAB_STORE, "lab:")) {
    const raw = await env.LAB_STORE.get(name);
    if (!raw) continue;
    try { records.push({ wallet: name.slice(4), theses: JSON.parse(raw).theses || [] }); } catch { /* unreadable record: skip */ }
  }
  const counts = callPulse(records, now, {
    exclude: [env.HOUSE_CALLER_ADDRESS, env.HOUSE_CATALYST_ADDRESS],
    engines: [env.ENGINE_CALLER_ADDRESSES],
    isCurrent: isCurrentStamp,
  });
  await nameCallers(env, counts);
  const board = await boardView(env, scorecardKey, now);
  return { ok: true, asOf: new Date(now).toISOString(), windowDays: PULSE_WINDOW_MS / 86400000, ...counts, ...board };
}

/** The pulse from its 5-minute cache, else built and cached. Shared by the route and the record card. Throws if unbuildable. */
export async function readPulse(env, { scorecardKey } = {}) {
  try { const c = await env.LAB_STORE.get(PULSE_CACHE_KEY); if (c) return JSON.parse(c); } catch { /* rebuild */ }
  const pulse = await buildPulse(env, { scorecardKey });
  try { await env.LAB_STORE.put(PULSE_CACHE_KEY, JSON.stringify(pulse), { expirationTtl: PULSE_TTL_S }); } catch { /* serve uncached */ }
  return pulse;
}

export async function handlePulse(parts, request, env, { scorecardKey } = {}) {
  if (!(parts[0] === "calls" && parts[1] === "pulse" && parts.length === 2)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  try { return reply(await readPulse(env, { scorecardKey })); } catch { return reply({ ok: false, error: "pulse_unavailable" }, 503); }
}
