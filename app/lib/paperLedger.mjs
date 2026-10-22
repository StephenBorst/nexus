// ── Paper ledger: an append-only, hash-chained record of every PAPER close ──────
// Why: paper was the one part of the Arena nobody could check. The live ledger is
// hashed and anchored on Arbitrum; paper was a running total in a KV blob the owner
// could reset. This module gives every paper close a numbered row and chains each
// row to the one before it, so any gap, edit or deletion breaks the chain.
//
// Pure + dependency-free (WebCrypto only), imported by the exec worker (writes the
// chain), the lab-api (serves + verifies it) and the tests, so all three agree on
// the bytes being hashed. ⚠️ Changing FIELDS or the separator breaks every existing
// head, so treat both as frozen once a paper ledger exists.

export const PAPER_FIELDS = [
  "symbol", "direction", "entry_price", "exit_price", "qty", "leverage",
  "pnl", "pnl_percent", "reason", "strategy", "opened_at", "closed_at",
];
export const GENESIS_HEAD = "0".repeat(64);

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The exact bytes hashed for one row. Missing fields are null, never omitted, so a
// later row with an extra key cannot silently change what an earlier one hashed to.
export function canonicalPaperRow(row) {
  return JSON.stringify(PAPER_FIELDS.map((f) => row?.[f] ?? null));
}

// head_n = sha256(head_{n-1} ":" seq ":" canonicalRow(row_n))
export async function nextPaperHead(prevHead, seq, row) {
  return sha256Hex(`${prevHead || GENESIS_HEAD}:${seq}:${canonicalPaperRow(row)}`);
}

// Recompute the chain from seq 1. `entries` = [{ seq, row, head }] in any order.
// Returns the final head, or the first seq where the stored head does not match.
export async function verifyPaperLog(entries) {
  const sorted = [...(entries || [])].sort((a, b) => a.seq - b.seq);
  let head = GENESIS_HEAD;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.seq !== i + 1) return { ok: false, count: i, head, reason: "gap", atSeq: i + 1 };
    head = await nextPaperHead(head, e.seq, e.row);
    if (e.head !== head) return { ok: false, count: i, head, reason: "mismatch", atSeq: e.seq };
  }
  return { ok: true, count: sorted.length, head };
}

// One root over every agent's paper head, so a single on-chain anchor commits to
// all paper records at once. Agents with no paper trades are left out.
export async function paperRoot(agents) {
  const rows = (agents || [])
    .filter((a) => Number(a.count) > 0 && a.head)
    .map((a) => [String(a.wallet).toLowerCase(), a.head, Number(a.count)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { ledgerHash: await sha256Hex(JSON.stringify(rows)), count: rows.length };
}

export const paperSeqKey = (wallet, seq) =>
  `arena:paper:log:${String(wallet).toLowerCase()}:${String(seq).padStart(8, "0")}`;
export const paperLogPrefix = (wallet) => `arena:paper:log:${String(wallet).toLowerCase()}:`;
