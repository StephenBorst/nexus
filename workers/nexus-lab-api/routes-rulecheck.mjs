// ── GET /engines/rule-check/:wallet — an engine's posted calls vs its own registered rules ──────────────────────
// Rules: app/lib/ruleCheck.mjs (docs/research/scanner-rule-check.md). For a wallet in RULE_CHECKS: runs each of its
// registered reads (the scoreboard's own generators, explorerReads.mjs) on its coins' recorded hourly tape
// (candle:hist), and matches the wallet's public calls (lab:{wallet}) to the setups. Public, read-only, 10-minute
// cache; writes nothing but that cache. A coin whose tape can't be read is named in `unread`, never counted as a skip.
import { ruleCheck, ruleCheckFor } from "../../app/lib/ruleCheck.mjs";
import { EXPLORER_GENS } from "./explorerReads.mjs";

export const RULE_CHECK_CACHE = (w) => `engine:rulecheck:v1:${w}`;
const TTL_S = 600;

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=120" : "no-store", "Access-Control-Allow-Origin": "*" },
});

/** Builds the check from KV. Exported for the test (fake KV, fixed clock). */
export async function buildRuleCheck(env, wallet, { now = Date.now() } = {}) {
  const check = ruleCheckFor(wallet);
  if (!check) return null;
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  const events = [], unread = [];
  for (const coin of check.coins) {
    let candleHist = null;
    try { const raw = await AGENT_KV.get(`candle:hist:PERP_${coin}_USDC`); candleHist = raw ? JSON.parse(raw) : null; } catch { candleHist = null; }
    if (!Array.isArray(candleHist) || candleHist.length < 2) { unread.push(coin); continue; }
    for (const read of check.reads) {
      const gen = EXPLORER_GENS[read];
      if (typeof gen !== "function") throw new Error(`rule check: ${read} is not a registered read`);
      for (const e of gen({ coin, candleHist }, null, {}) || []) events.push({ coin, read, t: e.t, side: e.side });
    }
  }
  let theses = [];
  try { const raw = await env.LAB_STORE.get(`lab:${wallet}`); theses = raw ? (JSON.parse(raw).theses || []) : []; } catch { return { ok: false, error: "calls_unread" }; }
  return { ok: true, wallet, asOf: new Date(now).toISOString(), ...ruleCheck(events, theses, check, now, { unread }) };
}

export async function handleRuleCheck(parts, request, env) {
  if (!(parts[0] === "engines" && parts[1] === "rule-check" && parts.length === 3)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const wallet = String(parts[2] || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !ruleCheckFor(wallet)) return reply({ ok: false, error: "no_rule_check" }, 404);
  try { const c = await env.LAB_STORE.get(RULE_CHECK_CACHE(wallet)); if (c) return reply(JSON.parse(c)); } catch { /* rebuild */ }
  try {
    const body = await buildRuleCheck(env, wallet);
    if (!body?.ok) return reply(body || { ok: false, error: "unavailable" }, 503);
    try { await env.LAB_STORE.put(RULE_CHECK_CACHE(wallet), JSON.stringify(body), { expirationTtl: TTL_S }); } catch { /* serve uncached */ }
    return reply(body);
  } catch { return reply({ ok: false, error: "rule_check_unavailable" }, 503); }
}
