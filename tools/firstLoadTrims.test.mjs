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

// ── Amplitude's click-capture plugin ────────────────────────────────────────────────────────
test("Amplitude's client builds the autocapture plugin only when config.autocapture asks for it", () => {
  const src = read("@amplitude/analytics-browser/lib/esm/browser-client.js");
  const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@amplitude\/plugin-autocapture-browser['"]/g)].map((m) => m[1].trim());
  assert.deepEqual(imports, ["autocapturePlugin"], "the stand-in exports only autocapturePlugin");
  const uses = [...src.matchAll(/autocapturePlugin\(/g)].length;
  assert.equal(uses, 1, "built in exactly one place");
  assert.match(src, /if \(!isElementInteractionsEnabled\(this\.config\.autocapture\)\)[^\n]*\n[^\n]*\n[^\n]*this\.add\(autocapturePlugin\(/,
    "and only behind isElementInteractionsEnabled(this.config.autocapture)");
});

test("Orderly never sets autocapture, and unset autocapture means no element interactions", async () => {
  const hooks = read("@orderly.network/hooks/dist/index.mjs");
  const start = hooks.indexOf("function getAmplitudeConfig");
  const body = hooks.slice(start, hooks.indexOf("\n}\n", start));
  assert.ok(start > 0 && body.length > 0);
  assert.doesNotMatch(body, /autocapture/, "Orderly's Amplitude options name no autocapture");
  const { AMPLITUDE_INIT_PATCHED } = await import("./amplitudeOptOut.mjs");
  assert.doesNotMatch(AMPLITUDE_INIT_PATCHED, /autocapture/);
  const { isElementInteractionsEnabled } = await import("@amplitude/analytics-client-common");
  assert.equal(isElementInteractionsEnabled(undefined), false);
});

test("the stand-in is a plugin that does nothing", async () => {
  const { autocapturePlugin } = await import("../app/lib/amplitudeAutocaptureOff.mjs");
  const p = autocapturePlugin({});
  assert.equal(p.type, "enrichment");
  assert.equal(await p.setup({}, {}), undefined);
  const ev = { event_type: "x" };
  assert.equal(await p.execute(ev), ev);
});

test("the stand-in reaches only the top-level Amplitude client, never a nested copy (WooFi's)", async () => {
  const { AUTOCAPTURE_IMPORTER: re } = await import("./amplitudeOptOut.mjs");
  assert.ok(re.test("/repo/node_modules/@amplitude/analytics-browser/lib/esm/browser-client.js"));
  assert.ok(!re.test("/repo/node_modules/woofi-swap-widget-kit/node_modules/@amplitude/analytics-browser/lib/esm/browser-client.js"));
  assert.match(cfg, /AUTOCAPTURE_IMPORTERS = \[AUTOCAPTURE_IMPORTER\]/);
});
