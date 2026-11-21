// Sealed reads (docs/research/sealed-reads.md, signed by borst in session 2026-11-20): the rule stays private, its
// fingerprint is public from day one, every call it makes is public and graded like any call. This module is the ONE
// public copy of the fingerprint rule, so anyone can recompute a revealed bundle's hash and compare. Pure.
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// sha256 of the signed page's text above "## Results" (sealedReads.test.mjs re-reads the page and checks it).
export const SEALED_PAGE_SHA256 = "3d79af77e60221fc2547b0efa80187f2f9092f863d45918f69f15d09bd5b18cd";

// The bundle's three files, in this order (page §1.1): the rule in plain words, the code that fires it, its numbers.
export const SEAL_PARTS = Object.freeze(["rule", "code", "params"]);

const bytesOf = (b) => (typeof b === "string" ? utf8ToBytes(b) : b instanceof Uint8Array ? b : null);

/**
 * The fingerprint (page §1.2): sha256 over the three files joined in SEAL_PARTS order, each preceded by its file name
 * and its byte length as `<name>\n<length>\n`. `files` = [{ part, name, bytes }] (bytes = Uint8Array or a UTF-8 string).
 * Returns lowercase hex, or null when a part is missing, repeated, out of order or not bytes.
 */
export function sealFingerprint(files) {
  if (!Array.isArray(files) || files.length !== SEAL_PARTS.length) return null;
  const chunks = [];
  for (let i = 0; i < SEAL_PARTS.length; i++) {
    const f = files[i];
    const bytes = bytesOf(f?.bytes);
    if (!f || f.part !== SEAL_PARTS[i] || typeof f.name !== "string" || !f.name || /\n/.test(f.name) || !bytes) return null;
    chunks.push(utf8ToBytes(`${f.name}\n${bytes.length}\n`), bytes);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return bytesToHex(sha256(all));
}

/** A revealed bundle matches its seal only if its fingerprint equals the published one exactly (page §1.3). */
export function revealMatches(files, publishedFingerprint) {
  const fp = sealFingerprint(files);
  return !!fp && typeof publishedFingerprint === "string" && fp === publishedFingerprint.toLowerCase();
}

// ── The sealed reads on record (page §1.2) ─────────────────────────────────────────────────────────────────────────
// Only public facts: the name, the fingerprint, the wallet that posts its calls, the day the fingerprint was committed
// here, and borst's X post once it exists. The rule itself stays in the private repo until its reveal.
export const SEALED_READS = Object.freeze([
  Object.freeze({
    name: "house-1",
    label: "House signal",
    fingerprint: "b71e0dfd42b32465f0cdc7e1c45abf13e62e75c4766e50ba333fca8f388b0c6e",
    wallet: "0x76A22635ECD0e86c555Ccd2202D250D82f3bB17B", // borst 2026-11-20: posts calls only; he holds the key
    committedAt: "2026-11-20", // PR #397, merged on GitHub 2026-11-20: the public date the fingerprint holds
    xPost: null, // { url, at (ISO) } once borst has posted the fingerprint from his public X account
    // borst's ruling 2026-11-21 (recorded under the page's Results): the X post is waived for house-1; the GitHub
    // merge of the fingerprint is the outside date. It counts from the next 00:00 UTC after this ruling.
    xPostWaivedAt: "2026-11-21",
  }),
]);

const DAY_MS = 24 * 3600e3;
/**
 * When a sealed read starts counting (page §1.2): the next 00:00 UTC after BOTH the commit here and borst's X post.
 * Null until the X post is recorded: nothing counts before an outside party holds the date. A read borst has ruled
 * the X post waived for (`xPostWaivedAt`, a date recorded under the page's Results) counts from the next 00:00 UTC
 * after the commit and that ruling: the GitHub merge of the fingerprint is then the outside date.
 */
export function sealedCountsFrom(read) {
  const c = Date.parse(`${read?.committedAt}T00:00:00Z`);
  const posted = typeof read?.xPost?.url === "string" ? Date.parse(read?.xPost?.at || "") : NaN;
  const waived = /^\d{4}-\d{2}-\d{2}$/.test(read?.xPostWaivedAt || "") ? Date.parse(`${read.xPostWaivedAt}T00:00:00Z`) : NaN;
  const x = Number.isFinite(posted) ? posted : waived;
  if (!Number.isFinite(c) || !Number.isFinite(x)) return null;
  const later = Math.max(c, x);
  return new Date(Math.floor(later / DAY_MS) * DAY_MS + DAY_MS).toISOString();
}
