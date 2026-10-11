// The first-load crypto stand-in must give the same answers as Node's crypto for the calls
// its three importers make. Run: node --test app/lib/nodeCryptoLite.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import lite, { createHash, randomBytes } from "./nodeCryptoLite.mjs";

const INPUTS = ["", "event:PacketSent", "spl_token_metadata_interface:initialize_account", "ünïcødé ✓", "x".repeat(10000)];

test("sha256 hex (LayerZero's event discriminator) matches node:crypto", () => {
  for (const s of INPUTS) {
    assert.equal(lite.createHash("sha256").update(s).digest("hex"), nodeCrypto.createHash("sha256").update(s).digest("hex"));
  }
});

test("sha256 Buffer digest + subarray (spl discriminator) matches node:crypto", () => {
  for (const s of INPUTS) {
    const a = createHash("sha256").update(s).digest();
    const b = nodeCrypto.createHash("sha256").update(s).digest();
    assert.ok(Buffer.isBuffer(a));
    assert.deepEqual([...a.subarray(0, 8)], [...b.subarray(0, 8)]);
    assert.deepEqual([...a], [...b]);
  }
});

test("bytes in, chained updates, and digest encodings match node:crypto", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const mine = createHash("SHA256").update("a").update(bytes).update("b");
  const ref = nodeCrypto.createHash("sha256").update("a").update(bytes).update("b");
  assert.equal(mine.digest("base64"), ref.digest("base64"));
});

test("anything but sha256 throws instead of returning a wrong hash", () => {
  assert.throws(() => createHash("sha512"), /sha256 only/);
  assert.throws(() => createHash("md5"), /sha256 only/);
});

test("randomBytes returns a Buffer of the requested length, not all zeros", () => {
  const r = randomBytes(32);
  assert.ok(Buffer.isBuffer(r));
  assert.equal(r.length, 32);
  assert.ok(r.some((b) => b !== 0));
  assert.equal(lite.randomBytes(0).length, 0);
});
