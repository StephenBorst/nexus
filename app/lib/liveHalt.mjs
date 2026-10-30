// ── The live-entry halt: one owner switch that stops every LIVE agent opening a new position ──────
// Set from /ops/revenue (POST /ops/halt, workers/nexus-lab-api/routes-halt.mjs), read once per tick by
// nexus-agent-exec. While it is on:
//   • no live agent (AUTONOMOUS) opens a position: brain signal, webhook, directive and autocopy alike;
//   • open positions keep every exit (SL, TP, trail, timeout, kill) and their DCA ladder as configured;
//   • PAPER agents run as normal, so the graded record and the parity check never see a gap;
//   • ASSISTED still queues signals (it places nothing).
// No thresholds: a person decides. It closes nothing and moves no funds.
//
// Each switch is its own short-lived signature (EVM, a treasury Safe owner or an OPS_WALLETS address),
// not the Lab sign-in: that one says "No trades" and lives a day in the browser. ONE message builder
// for the page and the worker, so the two can't drift.

export const LIVE_HALT_KEY = "ops:halt:live";        // NEXUS_AGENT: present = halted (JSON record)
export const LIVE_HALT_LOG_KEY = "ops:halt:log";     // NEXUS_AGENT: the last LIVE_HALT_LOG_MAX switches
export const LIVE_HALT_LOG_MAX = 50;
export const HALT_SIG_MAX_AGE_MS = 5 * 60 * 1000;    // a switch signature is good for 5 minutes
export const HALT_SIG_SKEW_MS = 60 * 1000;           // "signed in the future" by more than this = refused
export const HALT_REASON_MAX = 140;

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** The exact text the owner signs. ASCII only. `on` = pause, else resume. */
export function liveHaltMessage(address, on, ts) {
  const a = String(address).toLowerCase();
  return on
    ? "Nexus ops: PAUSE live agent entries\n"
      + "Every live agent stops opening new positions. Open positions keep their exits. Paper agents keep running.\n"
      + `Address: ${a}\nTimestamp: ${ts}\nCloses nothing. Moves no funds. Valid 5 minutes.`
    : "Nexus ops: RESUME live agent entries\n"
      + "Live agents may open new positions again, under their own settings.\n"
      + `Address: ${a}\nTimestamp: ${ts}\nCloses nothing. Moves no funds. Valid 5 minutes.`;
}

/** A reason as stored: one line, printable, capped. */
export function cleanReason(r) {
  const printable = Array.from(String(r ?? ""), (ch) => { const c = ch.charCodeAt(0); return c < 32 || c === 127 ? " " : ch; }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, HALT_REASON_MAX);
}

/**
 * The stored flag as the exec reads it. No key = not halted. A key that doesn't parse still
 * halts (someone set it; fail closed).
 */
export function parseLiveHalt(raw) {
  if (raw == null || raw === "") return { on: false };
  try {
    const r = JSON.parse(raw);
    if (r && typeof r === "object") return { on: true, at: Number(r.at) || null, reason: cleanReason(r.reason) };
  } catch { /* fall through */ }
  return { on: true, at: null, reason: "halt flag unreadable" };
}

/** The flag couldn't be read this tick: live entries wait one tick rather than guess. */
export const HALT_READ_FAILED = Object.freeze({ on: true, at: null, reason: "halt flag unread this tick", readError: true });

/** Does the halt stop this agent's entry? Only live modes; PAPER always runs. */
export function haltBlocksEntry(halt, mode) {
  return !!halt?.on && mode !== "PAPER";
}

/** What anyone may read: whether it's on, since when, why. Never who. */
export function publicHalt(halt) {
  return halt?.on ? { halted: true, since: halt.at ?? null, reason: halt.reason || "" } : { halted: false };
}

/**
 * Check one switch request. `recover(message, sig)` returns the signer address (or null); the worker
 * injects it. `lastTs` = the newest switch already applied, so an old signature can't be replayed.
 * @returns {{ ok: true, on: boolean, address: string, ts: number, reason: string } | { ok: false, status: number, error: string }}
 */
export function checkHaltRequest(body, { now = Date.now(), recover, lastTs = 0 } = {}) {
  const address = String(body?.address || "").toLowerCase();
  if (!isEvm(address)) return { ok: false, status: 400, error: "bad_address" };
  if (typeof body?.on !== "boolean") return { ok: false, status: 400, error: "on_must_be_boolean" };
  const ts = Number(body?.ts);
  const sig = body?.sig;
  if (!Number.isFinite(ts) || typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return { ok: false, status: 401, error: "sign_to_switch" };
  if (ts > now + HALT_SIG_SKEW_MS) return { ok: false, status: 401, error: "signed_in_future" };
  if (now - ts > HALT_SIG_MAX_AGE_MS) return { ok: false, status: 401, error: "signature_expired" };
  if (ts <= (Number(lastTs) || 0)) return { ok: false, status: 409, error: "stale_signature" };
  let signer = null;
  try { signer = recover(liveHaltMessage(address, body.on, ts), sig); } catch { signer = null; }
  if (!signer || String(signer).toLowerCase() !== address) return { ok: false, status: 401, error: "bad_signature" };
  return { ok: true, on: body.on, address, ts, reason: body.on ? cleanReason(body.reason) : "" };
}

/** The record a pause stores. */
export function haltRecord({ address, ts, reason, now = Date.now() }) {
  return { on: true, at: now, by: String(address).toLowerCase(), sigTs: ts, reason: cleanReason(reason) };
}

/** Append one switch to the log (newest first, capped). */
export function appendHaltLog(log, entry) {
  const prev = Array.isArray(log) ? log : [];
  return [entry, ...prev].slice(0, LIVE_HALT_LOG_MAX);
}

/** The newest signature timestamp already applied (the replay floor). */
export function lastHaltTs(log) {
  return (Array.isArray(log) ? log : []).reduce((m, e) => Math.max(m, Number(e?.sigTs) || 0), 0);
}

const toHex = (bytes) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Browser: sign one switch with the connected EVM wallet (personal_sign). Returns the POST body
 * for /ops/halt, minus the reason.
 * @returns {Promise<{ address: string, on: boolean, ts: number, sig: string }>}
 */
export async function signLiveHalt(addr, wallet, on, { now = Date.now() } = {}) {
  const provider = wallet?.provider;
  if (!isEvm(addr)) throw new Error("Connect an EVM wallet (a treasury Safe owner).");
  if (typeof provider?.request !== "function") throw new Error("This wallet can't sign messages here.");
  const lower = String(addr).toLowerCase();
  const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) || [];
  const account = accounts.find((a) => typeof a === "string" && a.toLowerCase() === lower)
    || (typeof wallet?.address === "string" && wallet.address.toLowerCase() === lower ? wallet.address : null);
  if (!account) throw new Error(`Switch your wallet to ${addr.slice(0, 6)}…${addr.slice(-4)}.`);
  const ts = now;
  const sig = await provider.request({ method: "personal_sign", params: [toHex(new TextEncoder().encode(liveHaltMessage(lower, on, ts))), account] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("The wallet returned no signature.");
  return { address: lower, on, ts, sig };
}
