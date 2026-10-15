// Guards the first-load trims in vite.config.ts (firstLoadTrims). The crypto stand-in
// (app/lib/nodeCryptoLite.mjs) covers only createHash("sha256") + randomBytes, and the lodash-es
// redirect only works for NAMED imports. If an SDK upgrade starts calling anything else, these fail
// in CI before a phone ever sees a broken page. Run: node --test tools/firstLoadTrims.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../node_modules/${p}`, import.meta.url), "utf8");
const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

test("LayerZero's Solana SDK only calls crypto.createHash('sha256')", () => {
  const src = read("@layerzerolabs/lz-solana-sdk-v2/dist/index.mjs");
  assert.match(src, /import crypto from ['"]crypto['"]/);
  const members = new Set([...src.matchAll(/\bcrypto\.([A-Za-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...members], ["createHash"]);
  const algs = new Set([...src.matchAll(/\bcrypto\.createHash\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
  assert.deepEqual([...algs], ["sha256"]);
});

test("spl-type-length-value only imports createHash and hashes sha256", () => {
  const src = read("@solana/spl-type-length-value/lib/esm/splDiscriminate.js");
  assert.match(src, /import \{ createHash \} from ['"]crypto['"]/);
  assert.deepEqual([...src.matchAll(/createHash\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]), ["sha256"]);
});

test("brorand only asks Node crypto for randomBytes", () => {
  const src = read("brorand/index.js");
  const members = new Set([...src.matchAll(/\bcrypto\.([A-Za-z]+)/g)].map((m) => m[1]).filter((m) => m !== "getRandomValues"));
  assert.deepEqual([...members], ["randomBytes"]);
});

test("the lodash imports redirected to lodash-es are named imports of real lodash-es exports", async () => {
  const hooks = read("@orderly.network/hooks/dist/index.mjs");
  const conn = read("@orderly.network/wallet-connector/dist/index.mjs");
  const named = (src) => [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lodash['"]/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  for (const src of [hooks, conn]) {
    assert.doesNotMatch(src, /import\s+[A-Za-z_$][\w$]*\s*(,|from)\s*['"]lodash['"]/, "default import of lodash would not tree-shake");
  }
  const names = [...named(hooks), ...named(conn)];
  assert.ok(names.length > 0);
  const lodashEs = await import("lodash-es");
  for (const n of names) assert.equal(typeof lodashEs[n], "function", `lodash-es has no ${n}`);
});

test("vite.config.ts allowlists exactly the importers checked above", () => {
  for (const frag of ["lz-solana-sdk-v2", "spl-type-length-value", "brorand", "@orderly\\\\.network\\\\/hooks", "@orderly\\\\.network\\\\/wallet-connector"]) {
    assert.ok(cfg.includes(frag.replace(/\\\\/g, "\\")), `vite.config.ts no longer names ${frag}`);
  }
  assert.match(cfg, /firstLoadTrims\(\),/);
});
