// Guards the Amplitude opt-out (tools/amplitudeOptOut.mjs, wired in vite.config.ts). Fails in CI if
// an Orderly SDK upgrade moves the init call, so full tracking can't come back unnoticed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patchAmplitudeInit, isOrderlyHooksDist, AMPLITUDE_INIT } from "./amplitudeOptOut.mjs";

const hooks = readFileSync(new URL("../node_modules/@orderly.network/hooks/dist/index.mjs", import.meta.url), "utf8");
const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

test("the installed Orderly SDK starts Amplitude exactly once, with the call we patch", () => {
  assert.equal(hooks.split(AMPLITUDE_INIT).length - 1, 1);
  const out = patchAmplitudeInit(hooks);
  assert.ok(!out.includes(AMPLITUDE_INIT));
  assert.match(out, /defaultTracking: false/);
  assert.match(out, /ipAddress: false/);
});

test("the patched options turn every automatic capture off and keep Orderly's server zone", async () => {
  const { isPageViewTrackingEnabled, isSessionTrackingEnabled, isFormInteractionTrackingEnabled, isFileDownloadTrackingEnabled, isAttributionTrackingEnabled } =
    await import("../node_modules/@amplitude/analytics-client-common/lib/esm/default-tracking.js");
  let seen;
  const amplitude = { init: (_id, opts) => { seen = opts; } };
  const amplitudeId = "k", options = { serverZone: "EU" };
  // Run the exact patched statement against a fake client.
  new Function("amplitude", "amplitudeId", "options", patchAmplitudeInit(AMPLITUDE_INIT))(amplitude, amplitudeId, options);
  assert.equal(seen.serverZone, "EU");
  assert.equal(seen.trackingOptions.ipAddress, false);
  for (const on of [isPageViewTrackingEnabled, isSessionTrackingEnabled, isFormInteractionTrackingEnabled, isFileDownloadTrackingEnabled, isAttributionTrackingEnabled]) {
    assert.equal(on(seen.defaultTracking), false);
  }
  // And unpatched, Amplitude treats "not set" as everything on — the reason this patch exists.
  assert.equal(isPageViewTrackingEnabled(undefined), true);
});

test("a changed SDK fails the build instead of shipping full tracking", () => {
  assert.throws(() => patchAmplitudeInit("amplitude.init(key, opts);"), /SDK changed/);
  assert.throws(() => patchAmplitudeInit(AMPLITUDE_INIT + AMPLITUDE_INIT), /found 2/);
});

test("only Orderly's hooks bundle is matched, and the plugin is wired into the build", () => {
  assert.ok(isOrderlyHooksDist("/x/node_modules/@orderly.network/hooks/dist/index.mjs"));
  assert.ok(isOrderlyHooksDist("C:\\x\\node_modules\\@orderly.network\\hooks\\dist\\index.mjs?v=1"));
  assert.ok(!isOrderlyHooksDist("/x/node_modules/@orderly.network/ui/dist/index.mjs"));
  assert.match(cfg, /amplitudeOptOut\(\)/);
});
