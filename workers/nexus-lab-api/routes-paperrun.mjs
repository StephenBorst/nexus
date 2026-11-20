// ── GET /signals/paper-run/:axis — a read's paper run, trade by trade, in R ─────────────────────────────────────
// (its own paper wallet, else its keyless house run, app/lib/housePaper.mjs). GET /signals/paper-counts = every read's
// run as a COUNT only, for the /proof board rows (one request, 60 s cache).
// Read by /proof/paper/:axis and its link card (functions/proof/paper/[axis].js). Rule: app/lib/paperRun.mjs.
// KV reads: the paper wallet's state (exec's record), its tape checks, while flat the brain's last check
// (`quiet`, app/lib/quietLine.mjs), and each traded coin's hourly tape for MAE / MFE (excursion.mjs). No dollars, no totals, nothing written.
// Public, read-only, any origin. 404 = the read has no paper wallet; an unreadable state = `unread: true`.
import { paperRun } from "../../app/lib/paperRun.mjs";
import { readTape } from "./paperTape.mjs";
import { readPaperClaims } from "./routes-paperclaim.mjs";
import { quietLine } from "../../app/lib/quietLine.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    "Access-Control-Allow-Origin": "*",
  },
});

export const PAPER_COUNTS_KEY = "paper:counts:v1";

/** Every registered read's paper run as a count: {axis: {wallet, house, count, target, open} | {wallet, house, unread}}. */
export async function buildPaperCounts(env) {
  let claims = {};
  try { claims = await readPaperClaims(env); } catch { claims = {}; }
  const kv = env.NEXUS_AGENT || env.LAB_STORE;
  const out = {};
  for (const r of REGISTERED_READS) {
    const probe = paperRun(r.axis, null, null, { wallet: claims[r.axis]?.wallet || null });
    if (!probe) continue;
    let state = null;
    try { const raw = await kv.get(`agent:state:${probe.wallet.toLowerCase()}`); state = raw ? JSON.parse(raw) : null; } catch { state = null; }
    const run = paperRun(r.axis, state, null, { wallet: claims[r.axis]?.wallet || null });
    out[r.axis] = run.unread
      ? { wallet: run.wallet, house: run.house, unread: true }
      : { wallet: run.wallet, house: run.house, count: run.count, target: run.target, open: !!state?.current_position };
  }
  return out;
}

export async function handlePaperRun(parts, request, env) {
  if (parts[0] === "signals" && parts[1] === "paper-counts" && parts.length === 2) {
    if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
    try { const c = await env.LAB_STORE.get(PAPER_COUNTS_KEY); if (c) return reply(JSON.parse(c)); } catch { /* rebuild */ }
    const body = { ok: true, asOf: new Date().toISOString(), runs: await buildPaperCounts(env) };
    try { await env.LAB_STORE.put(PAPER_COUNTS_KEY, JSON.stringify(body), { expirationTtl: 60 }); } catch { /* serve uncached */ }
    return reply(body);
  }
  if (!(parts[0] === "signals" && parts[1] === "paper-run" && parts.length === 3)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const axis = String(parts[2] || "").slice(0, 64);
  // A signed claim (paperClaim.mjs) counts from the moment it's stored; the code registration wins once written.
  let claimed = null;
  try { claimed = (await readPaperClaims(env))[axis]?.wallet || null; } catch { claimed = null; }
  const probe = paperRun(axis, null, null, { wallet: claimed });
  if (!probe) return reply({ ok: false, error: "no_paper_wallet", axis }, 404);
  let state = null;
  try {
    const raw = await (env.NEXUS_AGENT || env.LAB_STORE).get(`agent:state:${probe.wallet.toLowerCase()}`);
    state = raw ? JSON.parse(raw) : null;
  } catch { state = null; }
  // Each fill checked against Orderly's public 1-minute tape (paperTape.mjs). Unreadable = no tape block.
  let tape = null;
  try { tape = state ? await readTape(env.LAB_STORE, probe.wallet) : null; } catch { tape = null; }
  // Why the wallet isn't trading right now (the brain's last check), only while it is flat. Display only.
  let quiet = null;
  if (state && !state.current_position) {
    try { quiet = quietLine(JSON.parse((await (env.NEXUS_AGENT || env.LAB_STORE).get(`agent:signal:${probe.wallet.toLowerCase()}`)) || "null")); } catch { quiet = null; }
  }
  // Each closed trade's MAE / MFE in R from the recorded hourly tape (excursion.mjs). One read per coin traded.
  let candles = null;
  if (state && Array.isArray(state.paper_trades) && state.paper_trades.length) {
    candles = {};
    for (const coin of new Set(state.paper_trades.map((t) => String(t?.symbol || "").replace(/^PERP_/, "").replace(/_USDC$/, "")).filter(Boolean))) {
      try { candles[coin] = JSON.parse((await (env.NEXUS_AGENT || env.LAB_STORE).get(`candle:hist:PERP_${coin}_USDC`)) || "null"); } catch { candles[coin] = null; }
    }
  }
  return reply({ ok: true, asOf: new Date().toISOString(), ...paperRun(axis, state, tape, { wallet: claimed, candles }), quiet });
}
