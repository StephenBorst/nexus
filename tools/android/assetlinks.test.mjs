// The Android app's full-screen check rests on public/.well-known/assetlinks.json. A malformed file
// fails silently on the phone (the app just shows Chrome's address bar), so CI checks it instead.
// Run: node --test tools/android/assetlinks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildAssetLinks, normalizeFingerprint, ANDROID_PACKAGE, ASSETLINKS_PATH } from "./assetlinks.mjs";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

test("fingerprints normalize to upper-case colon pairs; junk is refused", () => {
  assert.equal(normalizeFingerprint(FP.toLowerCase()), FP);
  assert.equal(normalizeFingerprint(FP.replace(/:/g, "")), FP);
  assert.equal(normalizeFingerprint(` ${FP} `), FP);
  for (const bad of ["", "AB:CD", FP + ":00", FP.replace("14", "ZZ"), null]) assert.throws(() => normalizeFingerprint(bad), /not a SHA-256/);
});

test("the statement has Android's exact shape, deduped", () => {
  const out = buildAssetLinks([FP, FP.toLowerCase(), "00".repeat(32)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(out[0].target.namespace, "android_app");
  assert.equal(out[0].target.package_name, ANDROID_PACKAGE);
  assert.deepEqual(out[0].target.sha256_cert_fingerprints, [FP, normalizeFingerprint("00".repeat(32))]);
  assert.throws(() => buildAssetLinks([]), /at least one/);
});

test("package id matches the Android runbook", () => {
  const doc = readFileSync(new URL("../../docs/android-app.md", import.meta.url), "utf8");
  assert.ok(doc.includes(ANDROID_PACKAGE), "docs/android-app.md names a different package id");
});

test("the committed assetlinks.json (once it exists) is valid", (t) => {
  if (!existsSync(ASSETLINKS_PATH)) return t.skip("not written yet: waiting on the Play fingerprints");
  const got = JSON.parse(readFileSync(ASSETLINKS_PATH, "utf8"));
  const fps = got?.[0]?.target?.sha256_cert_fingerprints || [];
  assert.deepEqual(got, buildAssetLinks(fps));
  assert.ok(fps.length >= 2, "list both the Play app-signing key and the upload key");
});
