// ── The Holders Room, by one set of rules (borst 2026-11-27, "keep going thru them all") ─────────────────────────────
// What the audit found:
//   · the room's signature rode in the URL (GET /feed/holders?sig=…), so it sat in every proxy and edge log for its
//     10-minute life: it now goes in a POST body (house rule: signatures never in a URL),
//   · it signed only through an injected browser wallet, so WalletConnect and the Android app couldn't enter: it signs
//     with the CONNECTED wallet's provider, as the Lab signature does,
//   · a failed balance read showed "LOCKED" to a holder (the tier hook falls back to NONE): an unread balance now says so,
//     and the server answers 503 `balance_unread` when no Base RPC answers instead of 403 "not a holder",
//   · the server listed `lab:*` once (KV returns ≤ 1000 keys a page), so records past the first page never reached the
//     room: it pages with the cursor now,
//   · the rows showed the author's own status word ("HIT_TP") as if graded: holders calls are private (isPublic false),
//     so the grader never grades them (grading.mjs reads public calls only) and the author can still edit them. Each row
//     now says that, and shows the levels and the note.
// Pure + tested (holdersRoom.test.mjs). The worker's shared.mjs re-exports `holdersRoomMessage` from here.

export const HOLDERS_SIG_TTL_MS = 10 * 60 * 1000;   // the server's window
export const HOLDERS_SIG_REUSE_MS = 8 * 60 * 1000;  // the client re-signs before the server would refuse

/** Canonical challenge: client and server build it identically or ecrecover lands on another address. */
export function holdersRoomMessage(address, ts) {
  return `Nexus Holders Room
Address: ${String(address).toLowerCase()}
Timestamp: ${ts}`;
}

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const toHex = (b) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Sign the room's challenge with the CONNECTED wallet (EIP-1193 personal_sign), as signLabAuth does, so WalletConnect
 * and the Android app work. Throws a readable Error.
 * @returns {Promise<{ ts: number, sig: string }>}
 */
export async function signHoldersAccess(address, wallet, now = Date.now()) {
  if (!isEvm(address)) throw new Error("$NEXUS lives on Base: connect an EVM wallet to enter.");
  const provider = wallet?.provider;
  if (!provider || typeof provider.request !== "function") throw new Error("Connect your wallet to enter.");
  const lower = address.toLowerCase();
  const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) || [];
  const account = accounts.find((a) => typeof a === "string" && a.toLowerCase() === lower)
    || (typeof wallet?.address === "string" && wallet.address.toLowerCase() === lower ? wallet.address : null);
  if (!account) throw new Error(`Switch your wallet to ${address.slice(0, 6)}…${address.slice(-4)} to enter.`);
  const sig = await provider.request({ method: "personal_sign", params: [toHex(new TextEncoder().encode(holdersRoomMessage(lower, now))), account] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("The wallet returned no signature.");
  return { ts: now, sig };
}

/** A holders call as the room shows it: marked holders-only, never a marked copy. */
export const isHoldersCall = (t) => !!t && t.holdersOnly === true && !t.duplicateOf && !!t.symbol;

/**
 * What the room says about a call's result. A private holders call is never graded; an older call that is both
 * public and holders-only IS graded (the grader reads public calls), so its grade is shown instead.
 * @returns {{ graded: boolean, line: string }}
 */
export function holderCallState(t) {
  const r = Number(t?.gradedR);
  const rTxt = Number.isFinite(r) ? ` ${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R` : "";
  if (t?.isPublic === true && t?.gradedOutcome === "WIN") return { graded: true, line: `Graded: won${rTxt}.` };
  if (t?.isPublic === true && t?.gradedOutcome === "LOSS") return { graded: true, line: `Graded: lost${rTxt}.` };
  if (t?.isPublic === true) return { graded: true, line: "Public, so the grader tracks it: not settled yet." };
  return { graded: false, line: authorStatusLine(t?.status) };
}

const AUTHOR_WORDS = {
  ACTIVE: "open", HIT_TP: "hit target", STOPPED_OUT: "stopped", INVALIDATED: "invalidated", CLOSED: "closed",
};
/** "The author marks it: hit target." The author's own word, never a grade. */
export function authorStatusLine(status) {
  const w = AUTHOR_WORDS[String(status || "").toUpperCase()];
  return w ? `The author marks it: ${w}.` : "No status from the author.";
}

export const NOT_GRADED_LINE = "Holders calls are private, so they aren’t graded, and the author can still edit them. Publish a call to get it graded.";

/** Newest first, holders calls only. */
export function holderRows(feed) {
  return (Array.isArray(feed) ? feed : []).filter(isHoldersCall)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

/**
 * Why the room is shut, in words, from what the tier read returned.
 * @returns {{ kind: "NOT_EVM"|"UNREAD"|"BELOW", line: string, short: number|null }}
 */
export function lockState({ address, balance, need }) {
  if (!isEvm(address)) return { kind: "NOT_EVM", line: "$NEXUS lives on Base, so the room reads an EVM wallet. Connect one to check your tier.", short: null };
  if (balance == null || !Number.isFinite(Number(balance))) return { kind: "UNREAD", line: "Couldn’t read your $NEXUS balance on Base just now. This isn’t a verdict on your wallet: try again.", short: null };
  const short = Math.max(0, Number(need) - Number(balance));
  const fmt = (x) => Math.floor(x).toLocaleString("en-US");
  // What you hold rounds down, what's left rounds up: never claim you're closer than you are.
  return { kind: "BELOW", line: `You hold ${fmt(Number(balance))} $NEXUS. The room opens at ${fmt(Number(need))}: ${Math.ceil(short).toLocaleString("en-US")} to go.`, short };
}

/** The server's refusal, in words. status = HTTP status, or 0 for no answer. */
export function roomError(status) {
  if (status === 401) return "The signature was refused or ran out. Sign again to enter.";
  if (status === 403) return "The server read your balance under the room’s line just now. If you just bought, give it a minute.";
  if (status === 503) return "The server couldn’t read your balance on Base. Nothing is wrong with your wallet: try again.";
  if (status === 405) return "This page is out of date. Reload to enter.";
  return "Couldn’t reach the room. Try again.";
}
