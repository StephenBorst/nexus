// ── Binding a paper wallet to a TRADEABLE read, signed by the owner (borst, 2026-11-13) ─────────────
// pipeline-if-then.md, Tradeable: "borst sets up one paper wallet for it with the preset as registered, on the main
// coins only. Its record starts at that wallet's reset." Until now that step was a hand-made PR per read (level_reclaim
// 2026-11-05, oi_div_reversal_4h 2026-11-13). Now: the owner pastes the wallet on /ops and signs once; lab-api
// (routes-paperclaim.mjs) checks it and stores it, and the served stage moves TRADEABLE → PAPER on the next
// scoreboard build. The daily watcher then writes it into readPipeline.mjs, so git keeps the record too.
//
// The point of the checks: the wallet that is judged at 30 trades is bound BEFORE it has a trade. Nobody can run
// three wallets and keep the best one, or reset a bad record and register it again.
//   • only a treasury Safe owner or an OPS_WALLETS address may sign (the same gate as /ops/halt);
//   • the read is served TRADEABLE, has a brain mode + paper preset (PAPER_SETUPS), and has no wallet yet;
//   • the wallet is not another read's paper wallet;
//   • its agent config is PAPER on the read's exact preset (every preset field, and no extra filter or sizing);
//   • its record is fresh: activation stamped `started_at`, no closed trade, no open position, never reset;
//   • first registration wins and is never overwritten: a replacement is a new dated registration, by hand.
// Pure: no fetch, no KV. The worker injects the signature recovery, the stored claims, the scoreboard row and the
// wallet's config + state.

import { REGISTERED_READS, registrationFor } from "./readPipeline.mjs";
import { LEVEL_RECLAIM_PAPER_CONFIG, LEVEL_RECLAIM_DEPLOY } from "./levelReclaim.mjs";
import { OI_DIV_4H_PAPER_CONFIG, OI_DIV_4H_DEPLOY } from "./oiDivReversal.mjs";

export const PAPER_CLAIMS_KEY = "pipeline:paperwallets:v1"; // LAB_STORE: { [axis]: claim record }
export const CLAIM_SIG_MAX_AGE_MS = 5 * 60 * 1000;
export const CLAIM_SIG_SKEW_MS = 60 * 1000;

// A read can be put on paper only once the brain trades its exact rule (a shared rule + parity test, its own
// reviewed PR). Each entry: the preset its paper wallet must run, and the hidden setup link that loads it.
export const PAPER_SETUPS = Object.freeze({
  level_reclaim: Object.freeze({ config: LEVEL_RECLAIM_PAPER_CONFIG, deploy: LEVEL_RECLAIM_DEPLOY }),
  oi_div_reversal_4h: Object.freeze({ config: OI_DIV_4H_PAPER_CONFIG, deploy: OI_DIV_4H_DEPLOY }),
});

// Filters and sizing the presets leave unset: on a paper wallet they must stay off, or the record isn't the read's.
// (tpPercent / slPercent are left as the editor had them: the graded exit sets its own stop and target, gradedExit.mjs.)
const MUST_BE_OFF = Object.freeze(["riskPerTradeUsd", "volTargetPct", "minVolAtrPct", "maxVolAtrPct"]);

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const lower = (a) => String(a || "").toLowerCase();
const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };

/** The exact text the owner signs. ASCII only. */
export function paperClaimMessage(address, axis, wallet, ts) {
  return "Nexus pipeline: REGISTER a paper wallet\n"
    + `Read: ${axis}\nPaper wallet: ${lower(wallet)}\n`
    + "Its record is the one judged at 30 trades. Permanent: it can never be replaced.\n"
    + `Address: ${lower(address)}\nTimestamp: ${ts}\nTrades nothing. Moves no funds. Valid 5 minutes.`;
}

/**
 * The signature part of a request. `recover(message, sig)` returns the signer (the worker injects it).
 * @returns {{ ok: true, address, axis, wallet, ts } | { ok: false, status, error }}
 */
export function checkClaimSignature(body, { now = Date.now(), recover } = {}) {
  const address = lower(body?.address);
  const axis = String(body?.axis || "");
  const wallet = lower(body?.wallet);
  if (!isEvm(address)) return { ok: false, status: 400, error: "bad_address" };
  if (!registrationFor(axis)) return { ok: false, status: 400, error: "unknown_read" };
  if (!isEvm(wallet)) return { ok: false, status: 400, error: "bad_wallet" };
  const ts = Number(body?.ts);
  const sig = body?.sig;
  if (!Number.isFinite(ts) || typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return { ok: false, status: 401, error: "sign_to_register" };
  if (ts > now + CLAIM_SIG_SKEW_MS) return { ok: false, status: 401, error: "signed_in_future" };
  if (now - ts > CLAIM_SIG_MAX_AGE_MS) return { ok: false, status: 401, error: "signature_expired" };
  let signer = null;
  try { signer = recover(paperClaimMessage(address, axis, wallet, ts), sig); } catch { signer = null; }
  if (!signer || lower(signer) !== address) return { ok: false, status: 401, error: "bad_signature" };
  return { ok: true, address, axis, wallet, ts };
}

const sameSet = (a, b) => {
  const x = [...new Set((a || []).map(String))].sort(), y = [...new Set((b || []).map(String))].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const off = (v) => v == null || v === false || v === 0 || v === "" || v === "OFF" || (Array.isArray(v) && v.length === 0);

/** Which fields of a stored agent config differ from the read's paper preset (empty = it is the preset). */
export function paperConfigMismatch(config, preset) {
  const c = config || {};
  const bad = [];
  for (const [k, want] of Object.entries(preset)) {
    const got = c[k];
    if (Array.isArray(want)) { if (want.length === 0 ? !off(got) : !sameSet(got, want)) bad.push(k); }
    else if (typeof want === "boolean" || want === 0) { if (want ? got !== true : !off(got)) bad.push(k); }
    else if (typeof want === "number") { if (Number(got) !== want) bad.push(k); }
    else if (got !== want) bad.push(k);
  }
  for (const k of MUST_BE_OFF) if (!(k in preset) && !off(c[k])) bad.push(k);
  if (!off(c.basisConfirm)) bad.push("basisConfirm");
  if (Array.isArray(c.tradeSessions) && c.tradeSessions.length) bad.push("tradeSessions");
  if (c.autocopy?.enabled) bad.push("autocopy");
  return bad;
}

/** Why a wallet's record isn't a fresh start (null = fresh). */
export function freshnessRefusal(state) {
  if (!state || typeof state !== "object") return "no_agent_state";
  if (ms(state.started_at) == null) return "no_start_stamp";
  if (state.paper_reset_at != null) return "record_was_reset";
  if (Number(state.paper_agg?.trades) > 0 || (Array.isArray(state.paper_trades) && state.paper_trades.length)) return "has_trades";
  if (state.current_position) return "has_open_position";
  return null;
}

/** The wallet each read is bound to: the code registration first, else a stored claim. */
export function paperWalletOf(axis, claims) {
  return registrationFor(axis)?.paperWallet || claims?.[axis]?.wallet || null;
}

/** REGISTERED_READS with stored claims filled in (code wins). For the scoreboard's stage and the paper pages. */
export function readsWithClaims(claims) {
  return REGISTERED_READS.map((r) => (r.paperWallet || !claims?.[r.axis]?.wallet ? r : { ...r, paperWallet: claims[r.axis].wallet }));
}

/** The stored claims, parsed; anything unreadable = none (a read stays TRADEABLE, never PAPER on a guess). */
export function parseClaims(raw) {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return {};
    const out = {};
    for (const [axis, c] of Object.entries(o)) if (registrationFor(axis) && isEvm(c?.wallet)) out[axis] = c;
    return out;
  } catch { return {}; }
}

/**
 * Every check apart from the signature and the signer's role.
 * @param {object} p
 * @param {string} p.axis, p.wallet
 * @param {string|null} p.stage   the read's SERVED stage (scoreboard pipeline row); null = unread
 * @param {object} p.claims       parsed stored claims
 * @param {object|null} p.config  agent:config:{wallet}
 * @param {object|null} p.state   agent:state:{wallet}
 * @param {object} [p.setups]     PAPER_SETUPS (tests inject a read the brain doesn't trade yet)
 * @returns {null | { status, error, detail? }}
 */
export function claimRefusal({ axis, wallet, stage, claims, config, state, setups = PAPER_SETUPS }) {
  const w = lower(wallet);
  const setup = setups[axis];
  if (!setup) return { status: 409, error: "no_paper_setup", detail: "the brain doesn't trade this read yet: its shared rule + parity test come first" };
  if (paperWalletOf(axis, claims)) return { status: 409, error: "already_registered", detail: `bound to ${paperWalletOf(axis, claims)}` };
  if (stage == null) return { status: 503, error: "stage_unread" };
  if (stage !== "TRADEABLE") return { status: 409, error: "not_tradeable", detail: `served stage is ${stage}` };
  const other = REGISTERED_READS.find((r) => lower(paperWalletOf(r.axis, claims)) === w);
  if (other) return { status: 409, error: "wallet_in_use", detail: `already ${other.axis}'s paper wallet` };
  if (!config) return { status: 409, error: "no_agent_config", detail: "activate the agent from the setup link first" };
  if (config.mode !== "PAPER") return { status: 409, error: "not_paper" };
  const bad = paperConfigMismatch(config, setup.config);
  if (bad.length) return { status: 409, error: "not_the_preset", detail: bad.join(", ") };
  const fresh = freshnessRefusal(state);
  if (fresh) return { status: 409, error: "not_fresh", detail: fresh };
  return null;
}

/** The stored record: who signed, when, and the start of the record it binds. Never rewritten. */
export function claimRecord({ axis, wallet, address, ts, state, now = Date.now() }) {
  return { axis, wallet: lower(wallet), by: lower(address), at: new Date(now).toISOString(), sigTs: ts, startedAt: new Date(ms(state.started_at)).toISOString() };
}

/**
 * The /ops box's rows: every read the brain can put on paper, its served stage and its wallet (where it's bound).
 * @param {Record<string, string|null>} stages axis → served stage (null = unread)
 */
export function paperSetupRows(claims, stages) {
  return Object.entries(PAPER_SETUPS).map(([axis, s]) => {
    const code = registrationFor(axis)?.paperWallet || null;
    const claim = claims?.[axis] || null;
    return {
      axis, stage: stages?.[axis] ?? null, deploy: `/lab?tab=agent&deploy=${s.deploy}`,
      wallet: code || claim?.wallet || null, source: code ? "code" : claim ? "claim" : null, registeredAt: claim?.at || null,
    };
  });
}

const toHex = (bytes) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** Browser: the owner signs one claim with the connected EVM wallet (same flow as signLiveHalt). */
export async function signPaperClaim(addr, wallet, axis, paperWallet, { now = Date.now() } = {}) {
  const provider = wallet?.provider;
  if (!isEvm(addr)) throw new Error("Connect an EVM wallet (a treasury Safe owner).");
  if (!isEvm(paperWallet)) throw new Error("Paste the paper wallet’s 0x address.");
  if (typeof provider?.request !== "function") throw new Error("This wallet can’t sign messages here.");
  const me = lower(addr);
  const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) || [];
  const account = accounts.find((a) => typeof a === "string" && a.toLowerCase() === me)
    || (typeof wallet?.address === "string" && wallet.address.toLowerCase() === me ? wallet.address : null);
  if (!account) throw new Error(`Switch your wallet to ${addr.slice(0, 6)}…${addr.slice(-4)}.`);
  const ts = now;
  const sig = await provider.request({ method: "personal_sign", params: [toHex(new TextEncoder().encode(paperClaimMessage(me, axis, paperWallet, ts))), account] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("The wallet returned no signature.");
  return { address: me, axis, wallet: lower(paperWallet), ts, sig };
}

/** What anyone may read about the claims (all of it is public: the wallets are on /proof anyway). */
export const publicClaims = (claims) => Object.values(claims || {}).map((c) => ({ axis: c.axis, wallet: c.wallet, at: c.at, startedAt: c.startedAt, by: c.by }));
