// ── GET /agent/:a/preflight — is this wallet ready for the $10 live mechanics test? ─────────────────────
// Rule: app/lib/livePreflight.mjs. Public, read-only: the agent record (config + state, already public on
// GET /agent/:a), the owner's live-entry pause, a pending kill flag, whether a trading key is stored (a yes/no,
// never the key), exec's heartbeat, the lift list (a worker var) and the tape checks. Nothing is written, and no
// request is made to Orderly: the backstop line shows what exec recorded, and the page says to see it on Orderly.
import { preflight } from "../../app/lib/livePreflight.mjs";
import { LIVE_HALT_KEY } from "../../app/lib/liveHalt.mjs";
import { LIVE_LIFT_VAR } from "../../app/lib/liveLift.mjs";
import { readTape } from "./paperTape.mjs";

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export async function handlePreflight(parts, request, env, { nowMs = Date.now() } = {}) {
  if (!(parts[0] === "agent" && parts[2] === "preflight" && parts.length === 3)) return null;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
  if (request.method !== "GET") return reply({ error: "method not allowed" }, 405);
  const wallet = String(parts[1] || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return reply({ error: "bad wallet" }, 400);
  const kv = env.NEXUS_AGENT || env.LAB_STORE;
  const [configRaw, stateRaw, haltRaw, killRaw, keyRaw, beatRaw] = await Promise.all([
    kv.get(`agent:config:${wallet}`), kv.get(`agent:state:${wallet}`), kv.get(LIVE_HALT_KEY),
    kv.get(`agent:kill:${wallet}`), kv.get(`agent:key:${wallet}`), kv.get("ops:exec:heartbeat"),
  ]);
  let tape = null;
  try { tape = await readTape(env.LAB_STORE, wallet); } catch { tape = null; }
  const beat = Number(beatRaw);
  return reply({
    asOf: new Date(nowMs).toISOString(),
    ...preflight({
      wallet, config: parse(configRaw), state: parse(stateRaw), haltRaw, liftVar: env[LIVE_LIFT_VAR] || "",
      killRaw, hasKey: !!keyRaw, heartbeatMs: Number.isFinite(beat) && beat > 0 ? beat : null, tape, nowMs,
    }),
  });
}
