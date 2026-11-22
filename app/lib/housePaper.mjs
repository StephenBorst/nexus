// ── House paper runs: one keyless paper wallet per registered read (borst 2026-11-17, step 2) ─────────────────────────
// Every registered read gets a paper record that starts accruing at once, so its paper run doesn't wait for a person to
// make a wallet. The CLAIM still has to be earned: these records move no stage, are judged by nothing until a signed
// judgment page covers them, and show as COUNTS only (no R sums, no dollars).
//
// The id is a hash, not a wallet: "0x" + the first 40 hex of sha256("nexus/house-paper/v1/" + read). No private key
// is known for it, so nobody can sign for it: no owner signature (requireOwner), no trading key, no live order. It is
// paper by construction, and the agent routes and exec refuse anything else for it anyway (house paper = read only).
//
// Who: every registered read except a read that already has its own paper wallet (level_reclaim, oi_div_reversal_4h)
// and session_momentum, retired on Nov 13 under the old rule before its run would start. Reads no longer retire
// (2026-11-20), so "every read keeps running" would give it a run; starting one is borst's call, its own PR (it is the
// same event session_fade trades the other way, so the two runs would be one bet taken both ways). A new registration
// adds its read here in the same PR (housePaper.test.mjs fails otherwise).
//
// What: the same config the two hand-made paper wallets run (the graded exit, the 11 main-card coins, no filters, caps
// wide enough never to bind), with signalMode REGISTERED_READ + read (the brain runs the scoreboard's own generator,
// workers/nexus-lab-api/registeredReadLive.mjs).
import { LEVEL_RECLAIM_PAPER_CONFIG } from "./levelReclaim.mjs";

export const HOUSE_PAPER_TAG = "nexus/house-paper/v1/";

// Computed once from the tag (housePaper.test.mjs recomputes each). Frozen: an id never changes for its read.
export const HOUSE_PAPER_IDS = Object.freeze({
  rsi_reset_deep: "0x9a61b0888a84ed40f7b4d783400aec8ae1eedcbd",
  oi_div_reversal: "0x41783694fa09bc07b31ca4f067dc09a4bde6802b",
  confluence_follow: "0x3f326e6d1c6b71bc3ae64605d5045ef8ef847479",
  oi_coil_break: "0xf94fc07c972f7a922150bcd7e347a3f4ef7c0ec0",
  session_fade: "0xbaab05e8809ffd7706d9103647a74fe56739bdfc",
  level_reclaim_tight: "0xe8dbf959e6b0f932b49caf99d06f3547ad22f663",
  spot_absorb: "0x66a13127c59f36c97a9285df48cc56089adb1583",
  btc_lead_lag: "0x97371cec6dc63aa0e9c0747110e5e3042b6217a5",
  funding_basis_split: "0xbe07c41cb236e57a0bcdfc6a521a482187eae0c0",
  smart_consensus_2x: "0xc84313955e8a30fc3e719df67248c2bfa610f896",
  shelf_breakdown_short: "0x161d743f8a4557c76c9d5871dfe85f157619e555",
  bb_rsi_momentum: "0x955010226b3a2124790aba173950cfa826569258",
  session_fade_short: "0xccc0821fac9d5083006fc56322eddf4804407de5",
  oi_div_reversal_4h_long: "0x8ab3611f863ce15295db684376bc1884abae738f",
});
/** Registered reads with no house run, and why. */
export const HOUSE_PAPER_SKIP = Object.freeze({
  level_reclaim: "has its own paper wallet",
  oi_div_reversal_4h: "has its own paper wallet",
  session_momentum: "retired Nov 13 under the old rule; a run for it is borst's call (2026-11-20)",
});

const HOUSE_IDS = new Set(Object.values(HOUSE_PAPER_IDS));
/** Is this address a house paper run? (lowercase or not) */
export const isHousePaper = (address) => HOUSE_IDS.has(String(address || "").toLowerCase());
/** The read a house paper id runs, or null. */
export const housePaperRead = (address) => Object.keys(HOUSE_PAPER_IDS).find((r) => HOUSE_PAPER_IDS[r] === String(address || "").toLowerCase()) || null;

/** The config a house paper run is set up with (and must keep). */
export function housePaperConfig(read) {
  if (!HOUSE_PAPER_IDS[read]) throw new Error(`${read} has no house paper run`);
  return readPaperConfig(read);
}

/**
 * Any registered read on paper, at its exact rule: what a house run trades, and what the Strategy Shelf loads into a
 * user's agent (borst 2026-11-22, "open the shelf"). The brain refuses it anywhere but PAPER (registeredReadRefusal) and
 * lab-api refuses the graded exit live (gradedExitRefusal), so it can't become a live config by an edit.
 */
export function readPaperConfig(read) {
  // level_reclaim's paper wallet config, field for field, with this mode and read (housePaper.test.mjs pins it)
  return {
    ...LEVEL_RECLAIM_PAPER_CONFIG,
    signalMode: "REGISTERED_READ",
    read,
    symbols: [...LEVEL_RECLAIM_PAPER_CONFIG.symbols],
    takeProfits: [],
  };
}

/**
 * What the setup job does for one house run, from what is stored. Pure.
 * @returns {{ action: "create" | "keep" | "mismatch", config?: object, why?: string }}
 */
export function housePaperPlan(read, storedConfig) {
  const want = housePaperConfig(read);
  if (storedConfig == null) return { action: "create", config: want };
  // never rewritten: a changed config would cut the record in two. A difference is reported, never "fixed".
  const same = JSON.stringify(canon(storedConfig)) === JSON.stringify(canon(want));
  return same ? { action: "keep" } : { action: "mismatch", why: `${read}: stored config differs from the house config` };
}
function canon(o) {
  if (Array.isArray(o)) return o.map(canon);
  if (o && typeof o === "object") return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]));
  return o;
}
