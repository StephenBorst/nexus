// ── GET /signals/paper-run/:axis — a cleared read's paper run, trade by trade, in R ─────────────────
// Read by /proof/paper/:axis and its link card (functions/proof/paper/[axis].js). Rule: app/lib/paperRun.mjs.
// One KV read of the paper wallet's state (exec's record). No dollars, no totals, nothing written.
// Public, read-only, any origin. 404 = the read has no paper wallet; an unreadable state = `unread: true`.
import { paperRun } from "../../app/lib/paperRun.mjs";

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    "Access-Control-Allow-Origin": "*",
  },
});

export async function handlePaperRun(parts, request, env) {
  if (!(parts[0] === "signals" && parts[1] === "paper-run" && parts.length === 3)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const axis = String(parts[2] || "").slice(0, 64);
  const probe = paperRun(axis, null);
  if (!probe) return reply({ ok: false, error: "no_paper_wallet", axis }, 404);
  let state = null;
  try {
    const raw = await (env.NEXUS_AGENT || env.LAB_STORE).get(`agent:state:${probe.wallet.toLowerCase()}`);
    state = raw ? JSON.parse(raw) : null;
  } catch { state = null; }
  return reply({ ok: true, asOf: new Date().toISOString(), ...paperRun(axis, state) });
}
