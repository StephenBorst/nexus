// ── GET /calls/pulse — the Lab pulse: people's calls and our engines' calls, counted apart ──
// Read by the app's strip on Trade + Spot (LabPulseChip.tsx), the Lab home Calls panel (LabCallsPanel.tsx)
// and the landing page's hero record. Rule: app/lib/callPulse.mjs. House callers (HOUSE_CALLER_ADDRESS,
// HOUSE_CATALYST_ADDRESS) are left out; the engine wallets (ENGINE_CALLER_ADDRESSES, wrangler.toml) are
// counted in their own `engines` block. Each listed call carries its caller's public display name (`caller`).
// No money, nothing written but its own 5-minute cache. Public, read-only, any origin (the landing).
//
// `headline` = proofHeadline() on the scoreboard's OWN cache, never a fresh scorecard run (that's the
// heavy route). No cached scoreboard = `headline: null` = the reader makes no claim.
import { callPulse, PULSE_WINDOW_MS } from "../../app/lib/callPulse.mjs";
import { proofHeadline } from "../../app/lib/proofCopy.mjs";
import { isCurrentStamp } from "./grading.mjs";

export const PULSE_CACHE_KEY = "calls:pulse:v3"; // v3 = people vs engines split + caller names · v2 = + openCalls / recentGraded
const PULSE_TTL_S = 300;

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
  const rows = [counts, counts.engines].flatMap((b) => [...b.openCalls, ...b.recentGraded, ...(b.last ? [b.last] : [])]);
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
  let headline = null;
  if (scorecardKey) {
    try { const sc = await env.LAB_STORE.get(scorecardKey); if (sc) headline = proofHeadline(JSON.parse(sc), now); } catch { headline = null; }
  }
  return { ok: true, asOf: new Date(now).toISOString(), windowDays: PULSE_WINDOW_MS / 86400000, ...counts, headline };
}

export async function handlePulse(parts, request, env, { scorecardKey } = {}) {
  if (!(parts[0] === "calls" && parts[1] === "pulse" && parts.length === 2)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  try { const c = await env.LAB_STORE.get(PULSE_CACHE_KEY); if (c) return reply(JSON.parse(c)); } catch { /* rebuild */ }
  let pulse;
  try { pulse = await buildPulse(env, { scorecardKey }); } catch { return reply({ ok: false, error: "pulse_unavailable" }, 503); }
  try { await env.LAB_STORE.put(PULSE_CACHE_KEY, JSON.stringify(pulse), { expirationTtl: PULSE_TTL_S }); } catch { /* serve uncached */ }
  return reply(pulse);
}
