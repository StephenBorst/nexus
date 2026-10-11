// Writes public/.well-known/assetlinks.json, which lets the Android app (a Trusted Web Activity)
// open trade.nexustradinglabs.com full-screen without Chrome's address bar. Android checks that the
// app's signing certificate fingerprint is listed here; a typo silently falls back to a browser bar.
//
//   node tools/android/assetlinks.mjs <SHA-256> [<SHA-256> ...]
//
// Pass BOTH fingerprints from docs/android-app.md step 6: Play's App signing key AND your upload key
// (PWABuilder's). Accepts "AB:CD:…" or plain hex, any case; refuses anything that isn't 32 bytes.
// Fingerprints are public numbers (they identify a certificate, they can't sign anything).
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ANDROID_PACKAGE = "com.nexustradinglabs.app";
export const ASSETLINKS_PATH = new URL("../../public/.well-known/assetlinks.json", import.meta.url);

export function normalizeFingerprint(raw) {
  const hex = String(raw || "").trim().replace(/[:\s-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error(`not a SHA-256 fingerprint (need 32 bytes / 64 hex chars): "${raw}"`);
  return hex.match(/../g).join(":");
}

export function buildAssetLinks(fingerprints, pkg = ANDROID_PACKAGE) {
  const fps = [...new Set(fingerprints.map(normalizeFingerprint))];
  if (!fps.length) throw new Error("give at least one fingerprint");
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fps },
  }];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const out = buildAssetLinks(process.argv.slice(2));
    mkdirSync(new URL(".", ASSETLINKS_PATH), { recursive: true });
    writeFileSync(ASSETLINKS_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote public/.well-known/assetlinks.json (${out[0].target.sha256_cert_fingerprints.length} fingerprint(s), ${ANDROID_PACKAGE})`);
  } catch (e) {
    console.error(`assetlinks: ${e.message}`);
    process.exit(1);
  }
}
