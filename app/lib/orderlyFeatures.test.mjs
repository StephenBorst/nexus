import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDERLY_FEATURES } from "./orderlyFeatures.mjs";

test("Orderly Predict stays off until it's a decision, not an SDK default", () => {
  assert.equal(ORDERLY_FEATURES.prediction, false, "only an explicit false disables it in the SDK");
});

test("the provider passes the features and nothing re-enables Predict", () => {
  const src = readFileSync(new URL("../components/orderlyProvider/index.tsx", import.meta.url), "utf8");
  assert.match(src, /features=\{ORDERLY_FEATURES\}/);
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@orderly.network/prediction"], undefined, "no direct Predict dependency yet");
});
