import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SEALED_PAGE_SHA256, SEAL_PARTS, sealFingerprint, revealMatches } from "./sealedReads.mjs";

test("the signed sealed-reads page is pinned above Results", () => {
  const doc = readFileSync(new URL("../../docs/research/sealed-reads.md", import.meta.url), "utf8");
  const above = doc.slice(0, doc.indexOf("## Results"));
  assert.equal(createHash("sha256").update(above).digest("hex"), SEALED_PAGE_SHA256);
  assert.match(above, /Signed by borst in session 2026-11-20 \("sign sealed reads"\)/);
  assert.match(above, /On-chain anchoring is off \(borst,\s+2026-11-20\)/);
  assert.match(above, /each preceded by its file name and byte\s+length/);
});

const bundle = (code = "export const fire = () => null;\n") => [
  { part: "rule", name: "rule.md", bytes: "Fade the flush.\n" },
  { part: "code", name: "rule.mjs", bytes: code },
  { part: "params", name: "params.json", bytes: '{"k":1}\n' },
];

test("the fingerprint is sha256 over name + byte length + bytes, in the page's order", () => {
  const b = bundle();
  const manual = createHash("sha256");
  for (const f of b) { const bytes = Buffer.from(f.bytes, "utf8"); manual.update(`${f.name}\n${bytes.length}\n`); manual.update(bytes); }
  assert.equal(sealFingerprint(b), manual.digest("hex"));
  assert.deepEqual([...SEAL_PARTS], ["rule", "code", "params"]);
});

test("any change to any file, its name or the order changes the fingerprint or refuses it", () => {
  const fp = sealFingerprint(bundle());
  assert.notEqual(sealFingerprint(bundle("export const fire = () => 1;\n")), fp);
  const renamed = bundle(); renamed[2] = { ...renamed[2], name: "params2.json" };
  assert.notEqual(sealFingerprint(renamed), fp);
  assert.equal(sealFingerprint([bundle()[1], bundle()[0], bundle()[2]]), null, "wrong order");
  assert.equal(sealFingerprint(bundle().slice(0, 2)), null, "a missing part");
  assert.equal(sealFingerprint([{ ...bundle()[0], name: "a\nb" }, ...bundle().slice(1)]), null, "a name can't fake a length line");
  assert.ok(revealMatches(bundle(), fp.toUpperCase()));
  assert.ok(!revealMatches(bundle("tampered"), fp));
});
