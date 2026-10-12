// ── Registering a call on the ThesisRegistry, and indexing a registration into the Lab ───────────
// Two ways a call reaches the registry (Arbitrum 0x2F4E…46Bc):
//   1. POST /proxy/thesis-register: we encode registerThesis() and submit it through Bankr's
//      /wallet/submit with the agent's Bankr key (the agent's wallet pays gas).
//   2. The agent (or anyone) calls the contract itself (Bankr write_contract, a wallet, a script),
//      then POST /theses/index {txHash, walletAddress} puts it in that wallet's Lab record. No key.
// Both write the SAME call, built from what the chain holds (decodeRegisterCalls on the calldata),
// never from a request body: what the feed grades is what was registered.
//
// What went wrong before (2026-10-12, an agent burned gas three times and indexed nothing): every
// check ran AFTER the transaction, a slow receipt read as "nothing written" (504) so the agent
// retried and paid again, and nothing stopped a second submit of the same call. Now:
//   · checkRegistration + an eth_call simulation run BEFORE anything is sent;
//   · the same call from the same wallet can't be submitted twice within PENDING_TTL_S;
//   · a slow receipt answers 202 with the txHash, and /theses/index finishes the job later.
//
// The split exit (logic.mjs gradeCall) is declared ON-CHAIN, as SPLIT_TAG in the notes: the
// contract has no field for it, and a declaration only in a request body would let whoever indexes
// a registration first choose how it is graded.
//
// Pure: the routes in index.js do the network and KV calls.
import { callR, splitPlan, SPLIT_EXIT } from "./logic.mjs";
import { registryEvents, THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";

export { THESIS_REGISTRY };
export const ARBITRUM_CHAIN_ID = 42161;
// keccak256("registerThesis(string,uint8,uint256,uint256,uint256,uint256,uint256,bool,string)")[0:4]
export const REGISTER_SELECTOR = "ce4d0f18";
export const PRICE_SCALE = 1_000_000;   // the contract stores prices with 6 decimals
export const RR_SCALE = 10_000;
export const SPLIT_TAG = "#SPLIT_50";
export const MAX_NOTES_BYTES = 1000;
export const MAX_SYMBOL_BYTES = 40;
// A price the 6-decimal scale moves by more than this is refused: the registered level would not
// be the level the caller meant (a $0.0000123 token rounds to $0.000012, 2.4% off).
export const MAX_SCALE_ERROR = 0.001;
// How long a submit blocks a second submit of the same call (and remembers its txHash).
export const PENDING_TTL_S = 15 * 60;
// A registration older than this can't be indexed: the feed is for calls made now, and a call is
// graded from the moment it lands in the Lab, so an old one would carry a misleading post time.
export const INDEX_MAX_AGE_MS = 6 * 3600 * 1000;

const hex64 = (n) => BigInt(n).toString(16).padStart(64, "0");
const enc = new TextEncoder();
const bytesHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const padHex = (h) => h + "0".repeat((64 - (h.length % 64)) % 64);

/** "btc" / "BTC" / "PERP_BTC_USDC" → "PERP_BTC_USDC" (what the proxy has always registered). */
export function perpSymbol(s) {
  const u = String(s || "").toUpperCase().trim();
  return u.startsWith("PERP_") ? u : `PERP_${u}_USDC`;
}

const scaled = (v) => BigInt(Math.round(Number(v) * PRICE_SCALE));
const unscaled = (b) => Number(b) / PRICE_SCALE;

/** Notes as registered: the caller's text, plus SPLIT_TAG when the call declares a split. */
export function registeredNotes(notes, exitPlan) {
  const base = String(notes || "").replace(SPLIT_TAG, "").trim();
  return exitPlan === SPLIT_EXIT ? (base ? `${base} ${SPLIT_TAG}` : SPLIT_TAG) : base;
}

/**
 * Everything that can be known about a registration before it is sent. null = fine; else
 * { error, hint }. A refusal here costs nothing.
 */
export function checkRegistration(p) {
  const bad = (error, hint) => ({ error, hint });
  const dir = String(p?.direction || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return bad("bad_direction", "direction is LONG or SHORT.");
  const sym = perpSymbol(p.symbol);
  if (!/^PERP_[A-Z0-9]{1,20}_USDC$/.test(sym) || enc.encode(sym).length > MAX_SYMBOL_BYTES) {
    return bad("bad_symbol", "symbol is a ticker like BTC or an Orderly symbol like PERP_BTC_USDC.");
  }
  const lv = { entryPrice: p.entryPrice, stopLoss: p.stopLoss, takeProfit1: p.takeProfit1, takeProfit2: p.takeProfit2 ?? 0 };
  for (const [k, v] of Object.entries(lv)) {
    const n = Number(v);
    if (k === "takeProfit2" && (v == null || n === 0)) continue;
    if (!Number.isFinite(n) || n <= 0) return bad("bad_levels", `${k} must be a positive number.`);
    const back = unscaled(scaled(n));
    if (!(back > 0) || Math.abs(back - n) / n > MAX_SCALE_ERROR) {
      return bad("price_too_small", `${k} ${n} can't be stored at the registry's 6 decimals without moving it. Register a market with a larger price.`);
    }
  }
  const call = { direction: dir, entryPrice: Number(lv.entryPrice), stopLoss: Number(lv.stopLoss), takeProfit1: Number(lv.takeProfit1), takeProfit2: Number(lv.takeProfit2) || 0 };
  if (callR(call) == null) return bad("bad_levels", "The stop must be on the losing side of entry and TP1 on the winning side.");
  if (p.exitPlan != null && p.exitPlan !== SPLIT_EXIT) {
    return bad("bad_exit_plan", `exitPlan takes one value, "${SPLIT_EXIT}" (half at TP1, half at TP2). Leave it out for a single target.`);
  }
  if (p.exitPlan === SPLIT_EXIT && splitPlan({ ...call, exitPlan: SPLIT_EXIT }).invalid) {
    return bad("bad_split", "A split exit needs takeProfit2 beyond takeProfit1, on the target side of entry.");
  }
  if (enc.encode(registeredNotes(p.notes, p.exitPlan)).length > MAX_NOTES_BYTES) {
    return bad("notes_too_long", `notes are stored on-chain; keep them under ${MAX_NOTES_BYTES} bytes.`);
  }
  return null;
}

/**
 * Calldata for registerThesis(string symbol, uint8 direction, uint256 entry, uint256 stop,
 * uint256 tp1, uint256 tp2, uint256 riskReward, bool isPublic, string notes). Prices ×1e6, R ×1e4,
 * LONG = 0 / SHORT = 1. Byte-identical to the encoder this route used before (and to viem's).
 */
export function encodeRegisterThesis(p) {
  const dir = String(p.direction).toUpperCase() === "LONG" ? 0 : 1;
  const entry = Number(p.entryPrice), stop = Number(p.stopLoss), tp1 = Number(p.takeProfit1);
  const rr = Math.abs(tp1 - entry) / Math.abs(entry - stop);
  const symB = enc.encode(perpSymbol(p.symbol));
  const notesB = enc.encode(registeredNotes(p.notes, p.exitPlan));
  const symData = padHex(bytesHex(symB)) || "0".repeat(64);   // an empty string still takes one word here
  const head = 9 * 32;
  const offSym = head, offNotes = head + 32 + symData.length / 2;
  return "0x" + REGISTER_SELECTOR
    + hex64(offSym) + hex64(dir)
    + hex64(scaled(entry)) + hex64(scaled(stop)) + hex64(scaled(tp1)) + hex64(scaled(p.takeProfit2 || 0))
    + hex64(BigInt(Math.round(rr * RR_SCALE))) + hex64(p.isPublic === undefined || p.isPublic ? 1 : 0) + hex64(offNotes)
    + hex64(symB.length) + symData
    + hex64(notesB.length) + padHex(bytesHex(notesB));
}

const dec = new TextDecoder("utf-8", { fatal: true });

// One registerThesis call whose arguments start at hex offset `a` of `h` (no 0x), or null.
function decodeAt(h, a) {
  const word = (i) => (a + i * 64 + 64 <= h.length ? BigInt("0x" + h.slice(a + i * 64, a + i * 64 + 64)) : null);
  const str = (off) => {
    if (off == null || off % 32n !== 0n || off > BigInt(h.length)) return null;
    const p = a + Number(off) * 2;
    if (p + 64 > h.length) return null;
    const len = BigInt("0x" + h.slice(p, p + 64));
    if (len > 4096n || p + 64 + Number(len) * 2 > h.length) return null;
    try { return dec.decode(Uint8Array.from(h.slice(p + 64, p + 64 + Number(len) * 2).match(/../g) || [], (x) => parseInt(x, 16))); }
    catch { return null; }
  };
  const w = Array.from({ length: 9 }, (_, i) => word(i));
  if (w.some((x) => x == null) || w[1] > 1n || w[7] > 1n) return null;
  const symbol = str(w[0]), notes = str(w[8]);
  if (symbol == null || notes == null) return null;
  return {
    symbol, direction: w[1] === 0n ? "LONG" : "SHORT",
    entryPrice: unscaled(w[2]), stopLoss: unscaled(w[3]), takeProfit1: unscaled(w[4]), takeProfit2: unscaled(w[5]),
    riskReward: Number(w[6]) / RR_SCALE, isPublic: w[7] === 1n, notes,
  };
}

/**
 * Every registerThesis call inside a transaction's input: the input itself when the wallet called
 * the registry, or a call nested in a smart-account / batch call (ABI-encoded calls are contiguous
 * bytes inside the outer calldata, so each selector occurrence is tried).
 */
export function decodeRegisterCalls(input) {
  const h = String(input || "").toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(h)) return [];
  const out = [];
  for (let i = h.indexOf(REGISTER_SELECTOR); i >= 0; i = h.indexOf(REGISTER_SELECTOR, i + 1)) {
    if (i % 2) continue;                                   // byte-aligned only
    const d = decodeAt(h, i + REGISTER_SELECTOR.length);
    if (d) out.push(d);
  }
  return out;
}

/**
 * The one registration a transaction proves for `wallet`, or { error, hint }. The receipt must be a
 * success with exactly ONE registry event, naming the wallet; the input must hold exactly one
 * registerThesis call. One and one, so a bundle carrying several users' registrations can never
 * hand one wallet another's levels.
 */
export function provenRegistration({ receipt, input, wallet, registry = THESIS_REGISTRY }) {
  if (!receipt) return { error: "receipt_unavailable", hint: "The transaction has no receipt yet. Try again in a minute." };
  if (receipt.status !== "0x1") return { error: "tx_failed", hint: "The transaction reverted, so nothing was registered." };
  const events = registryEvents(receipt.logs, registry);
  if (events.length === 0) return { error: "not_a_registration", hint: "The transaction holds no ThesisRegistry registration." };
  if (events.length > 1) return { error: "multiple_registrations", hint: "One registration per transaction can be indexed." };
  if (events[0].trader !== String(wallet || "").toLowerCase()) {
    return { error: "wallet_not_proven", hint: "The registry recorded this registration for another wallet." };
  }
  const calls = decodeRegisterCalls(input);
  if (calls.length !== 1) return { error: "calldata_unreadable", hint: "The registerThesis call couldn't be read from the transaction input." };
  return { call: calls[0], onChainId: events[0].thesisId == null ? null : events[0].thesisId.toString() };
}

/**
 * The Lab call for a proven registration. Levels, side, market, notes and visibility come from the
 * chain. The split is declared by SPLIT_TAG in the registered notes. createdAt = the block time
 * (sealTheses replaces it with the server's clock at publish and keeps this as clientCreatedAt).
 */
export function thesisFromRegistration({ call, onChainId }, { txHash, blockTimeMs, id }) {
  const split = String(call.notes).includes(SPLIT_TAG);
  const t = {
    id: id || `reg-${String(txHash).toLowerCase().slice(2, 18)}`,
    symbol: call.symbol, direction: call.direction,
    entryPrice: call.entryPrice, stopLoss: call.stopLoss, takeProfit1: call.takeProfit1, takeProfit2: call.takeProfit2,
    ...(split ? { exitPlan: SPLIT_EXIT } : {}),
    riskPercent: 0, accountSize: 0, fundingRate: 0,
    notes: String(call.notes).replace(SPLIT_TAG, "").trim(),
    createdAt: blockTimeMs,
    positionSize: 0, leverage: 0,
    riskReward: callR(call) ?? 0,
    fundingCost8h: 0, fundingCost24h: 0, fundingCost72h: 0,
    status: "ACTIVE", actualPnl: null,
    isPublic: call.isPublic,
    onChainTxHash: String(txHash).toLowerCase(),
    ...(onChainId != null ? { onChainId } : {}),
  };
  return t;
}

/** KV key that blocks a second submit of the same call from the same wallet (see PENDING_TTL_S). */
export async function pendingKey(wallet, calldata) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${String(wallet).toLowerCase()}|${calldata}`)));
  return `thesisreg:pending:${bytesHex(d).slice(0, 32)}`;
}
