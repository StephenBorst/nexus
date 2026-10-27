// ── XMTP's per-wallet device limit ──────────────────────────────────────────────────────────────
// Every browser, phone or app that ever enabled messaging registers an XMTP "installation" on the
// wallet's inbox, and XMTP caps how many one inbox may hold. At the cap, Client.create throws and
// messaging silently can't start. libxmtp's text (read from @xmtp/wasm-bindings, v7 SDK):
//   "Cannot register a new installation because the InboxID <id> has already registered <n>/<max>
//    installations. Please revoke existing installations first."
// These rules spot that error and pick which devices to revoke. The revoke itself (one wallet
// signature, no client needed) lives in app/hooks/useXMTP.ts.

/** Devices we keep when revoking: the newest ones (the phone and browsers in use now). */
export const KEEP_NEWEST = 3;

const text = (e) => (e instanceof Error ? e.message : typeof e === "string" ? e : (() => { try { return JSON.stringify(e) ?? String(e); } catch { return String(e); } })());

/** @returns {{ inboxId: string | null, used: number | null, max: number | null } | null} null = not the limit error */
export function installationLimit(err) {
  const m = text(err);
  if (!/already registered\s+\d+\s*\/\s*\d+\s+installations|revoke existing installations/i.test(m)) return null;
  const inbox = m.match(/InboxID\s+([0-9a-f]{64})/i);
  const counts = m.match(/already registered\s+(\d+)\s*\/\s*(\d+)/i);
  return {
    inboxId: inbox ? inbox[1].toLowerCase() : null,
    used: counts ? Number(counts[1]) : null,
    max: counts ? Number(counts[2]) : null,
  };
}

/**
 * Which installations to revoke: everything except the `keep` newest (by XMTP's creation time).
 * One with no timestamp counts as oldest. This browser isn't registered yet (that's what failed),
 * so none of these is the device in hand.
 * @param {Array<{ id: string, bytes: Uint8Array, clientTimestampNs?: bigint | number | null }>} installations
 * @returns {{ revoke: typeof installations, keep: typeof installations }}
 */
export function revokePlan(installations, keep = KEEP_NEWEST) {
  const list = Array.isArray(installations) ? installations.filter((i) => i && i.bytes) : [];
  const ts = (i) => (i.clientTimestampNs == null ? -1n : BigInt(i.clientTimestampNs));
  const sorted = [...list].sort((a, b) => (ts(a) < ts(b) ? 1 : ts(a) > ts(b) ? -1 : 0)); // newest first
  const k = Math.max(0, Math.min(keep, sorted.length));
  return { keep: sorted.slice(0, k), revoke: sorted.slice(k) };
}

/** The plain line shown to the user. */
export function limitMessage(lim) {
  const n = lim && lim.used != null && lim.max != null ? ` (${lim.used} of ${lim.max})` : "";
  return `This wallet has hit XMTP's device limit${n}. Every browser or app that ever turned on messaging counts as one. Remove old devices to turn it on here.`;
}
