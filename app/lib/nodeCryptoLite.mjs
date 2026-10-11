// A two-function stand-in for Node's `crypto`, used ONLY by the three first-load modules that
// import it (see LITE_CRYPTO_IMPORTERS in vite.config.ts). Without it, the build pulls the whole
// crypto-browserify tree (elliptic, asn1, diffie-hellman, public-encrypt, …, ~1 MB raw) into the
// first-load chunk for one SHA-256 hash. What those importers call, checked 2026-10-11:
//   @layerzerolabs/lz-solana-sdk-v2   crypto.createHash("sha256").update(string).digest("hex")
//   @solana/spl-type-length-value     createHash("sha256").update(x).digest().subarray(0, n)
//   brorand                            require("crypto").randomBytes(n), only when `self` is missing
// Anything else throws loudly rather than returning a wrong answer. Lazy chunks (wallets, WooFi)
// still get the full polyfill.
import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";

class Sha256 {
  constructor() { this.h = sha256.create(); }
  update(data, enc) {
    this.h.update(typeof data === "string" ? Buffer.from(data, enc || "utf8") : data);
    return this;
  }
  digest(enc) {
    const out = Buffer.from(this.h.digest());
    return enc ? out.toString(enc) : out;
  }
}

export function createHash(alg) {
  if (String(alg).toLowerCase() !== "sha256") throw new Error(`nodeCryptoLite: createHash("${alg}") is not supported (sha256 only)`);
  return new Sha256();
}

export function randomBytes(n) {
  const out = Buffer.alloc(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export default { createHash, randomBytes };
