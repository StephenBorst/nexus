// ── Trading sessions (auth v2, docs/auth-v2-spec.md §B): the server side ───────────────────────
// `checkTradingSession` is what a route will call once v2 routes exist (build step 3). Nothing calls
// it yet: no live route accepts a session, so shipping this changes no behaviour.
//
// The "end all sessions" switch: KV `auth:sessions-after:{addr}` = a ms timestamp; every session
// issued before it is refused. `POST /v2/session/end-all {wallet, session}` sets it to the CALLING
// session's `issued`, so the owner signs a fresh session and ends every older one (a leaked copy
// included) while keeping the one they just made. The stamp only moves forward: a leaked session
// calling end-all can only end sessions older than itself, never the owner's newer ones.
import { json, recoverEthAddress } from "./shared.mjs";
import { verifyTradingSession } from "../../app/lib/tradingSession.mjs";

export const SESSIONS_AFTER_KEY = (addr) => `auth:sessions-after:${String(addr).toLowerCase()}`;

const kvOf = (env) => env.NEXUS_AGENT || env.LAB_STORE;

/** The wallet's "sessions issued before" stamp (0 when unset or unreadable as a number). */
export async function sessionsAfter(env, addr) {
  const raw = await kvOf(env).get(SESSIONS_AFTER_KEY(addr));
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Verify a session against the live switch. Same answer shape as verifyTradingSession. */
export async function checkTradingSession(env, address, auth, { now = Date.now() } = {}) {
  return verifyTradingSession({ address, auth, now, sessionsAfter: await sessionsAfter(env, address), recover: recoverEthAddress });
}

export async function handleSession(parts, request, env, deps = {}) {
  if (!(parts[0] === "v2" && parts[1] === "session")) return null;
  if (!(parts[2] === "end-all" && parts.length === 3)) return json({ error: "not_found" }, request, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, request, 405);
  const now = deps.now || Date.now;
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const wallet = String(body?.wallet || "").trim().toLowerCase();
  const v = await checkTradingSession(env, wallet, body?.session, { now: now() });
  if (!v.ok) return json({ error: "session_required", reason: v.reason, hint: "Sign a fresh trading session with this wallet and send it as `session`." }, request, 401);
  const before = await sessionsAfter(env, wallet);
  const after = Math.max(before, v.issued);
  if (after !== before) await kvOf(env).put(SESSIONS_AFTER_KEY(wallet), String(after));
  return json({ ok: true, wallet, sessionsAfter: after, kept: v.session,
    note: "Every trading session this wallet signed before this one is ended. This one still works until it expires." }, request);
}
