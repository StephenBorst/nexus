// Wallet X-Ray input + the device's recent list (borst 2026-11-21). Pure, tested (xrayInput.test.mjs).
//
// What the box accepts: a 0x address (40 hex) or an ENS name ("vitalik.eth", "nick.base.eth", a DNS name set up on
// ENS). A name is resolved on Ethereum mainnet in the browser (app/pages/analyze/ens.ts) and the page then runs on the
// RESOLVED address, printing "name → 0x…" so the reader sees exactly which wallet was graded. Nothing here trusts a
// name: the grade is always of an address.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// An ENS-style name: dot-separated labels, letters/digits/hyphen/underscore or any non-ASCII (emoji / IDN names are
// valid ENS), last label at least 2 letters. ENSIP-15 normalisation itself is viem's job at resolve time.
const NAME = /^(?:[a-z0-9_\-\u0080-￿]+\.)+[a-z\u0080-￿]{2,}$/i;

/**
 * @returns {{ kind: "address", address: string } | { kind: "name", name: string } | { kind: "empty" } | { kind: "invalid", reason: string }}
 */
export function parseWalletInput(raw) {
  const s = String(raw ?? "").trim().replace(/^@/, "");
  if (!s) return { kind: "empty" };
  if (ADDRESS.test(s)) return { kind: "address", address: s };
  if (/^0x/i.test(s)) return { kind: "invalid", reason: "A wallet address is 0x and 40 hex characters." };
  if (/\s/.test(s)) return { kind: "invalid", reason: "One wallet at a time: no spaces." };
  if (NAME.test(s)) return { kind: "name", name: s.toLowerCase() };
  return { kind: "invalid", reason: "Enter a 0x… address or an ENS name like vitalik.eth." };
}

export const isWalletAddress = (s) => ADDRESS.test(String(s ?? "").trim());

// ── Recent X-rays on this device ─────────────────────────────────────────────
export const RECENT_KEY = "nx_xray_recent_v1";
export const RECENT_MAX = 8;

/** Newest first, one row per address (case-insensitive), capped. A row: { address, name?, at }. */
export function pushRecent(list, row) {
  if (!row || !isWalletAddress(row.address)) return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  const a = row.address.toLowerCase();
  const prev = (Array.isArray(list) ? list : []).find((r) => String(r?.address || "").toLowerCase() === a);
  const keep = (Array.isArray(list) ? list : []).filter((r) => r && isWalletAddress(r.address) && r.address.toLowerCase() !== a);
  // A later plain-address run keeps the name an earlier ENS run found.
  const name = row.name || prev?.name || undefined;
  return [{ address: row.address, ...(name ? { name } : {}), at: Number(row.at) || 0 }, ...keep].slice(0, RECENT_MAX);
}

/** Read the stored list defensively: anything malformed is dropped, never thrown. */
export function readRecent(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((r) => r && isWalletAddress(r.address)).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

/** "0x1234…abcd", or the name with the short address beside it. */
export function walletLabel(row) {
  const a = String(row?.address || "");
  const s = a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
  return row?.name ? `${row.name} · ${s}` : s;
}
