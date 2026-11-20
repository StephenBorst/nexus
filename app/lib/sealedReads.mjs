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
