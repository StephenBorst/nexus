// ── GET /agent/:a/slippage — live fills vs the mark they were decided on (public, read-only) ──────────
// Rule: app/lib/slippage.mjs. exec keeps the last 100 exchange-confirmed fills in agent:state (`live_slip`);
// this serves them with the summary. Nothing written. n = 0 = nothing measured yet (never "0 bps").
import { slippageSummary, slippageLine } from "../../app/lib/slippage.mjs";

export async function handleSlippage(parts, request, env) {
  if (!(parts[0] === "agent" && parts[2] === "slippage" && parts.length === 3)) return null;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" },
  });
  if (request.method !== "GET") return reply({ error: "method not allowed" }, 405);
  const wallet = String(parts[1] || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return reply({ error: "bad wallet" }, 400);
  let state = null;
  try { state = JSON.parse((await (env.NEXUS_AGENT || env.LAB_STORE).get(`agent:state:${wallet}`)) || "null"); } catch { state = null; }
  if (!state) return reply({ error: "not found" }, 404);
  const fills = Array.isArray(state.live_slip) ? state.live_slip : [];
  const summary = slippageSummary(fills);
  return reply({
    ok: true, wallet, summary, line: slippageLine(summary), fills,
    rule: "Each live market order the exchange confirmed, its fill (Orderly average_executed_price) vs the mark exec decided it on: bps = (fill − mark) ÷ mark × 10,000, positive = paid worse than the mark (a buy above it, a sell below it). A fill that fell back to the mark is unknown and left out. Paper fills at the mark, so it has none. Last 100 fills.",
  });
}
