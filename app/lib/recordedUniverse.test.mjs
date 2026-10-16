// The recorded universe: the nine, the signed-off holdout, and the pre-registration that names them.
// Run: node --test app/lib/recordedUniverse.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RECORDED_COINS, HOLDOUT_COINS, HOLDOUT_AXES, HOLDOUT_PERPS, FLOW_COINS, HOLDOUT_SIGNED_OFF, isHoldoutCoin } from "./recordedUniverse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the nine and the eight signed off by borst 2026-10-16 (a change = a reviewed edit)", () => {
  assert.deepEqual([...RECORDED_COINS], ["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "DOGE", "AVAX", "HYPE"]);
  assert.deepEqual([...HOLDOUT_COINS], ["ZEC", "NEAR", "SUI", "PUMP", "ENA", "ONDO", "INJ", "ZRO"]);
  assert.equal(HOLDOUT_SIGNED_OFF, "2026-10-16");
  assert.deepEqual([...HOLDOUT_AXES], ["basis_x_cvd", "basis_extreme"]);
});

test("no coin is on both lists; the recorder reads both", () => {
  for (const c of HOLDOUT_COINS) assert.ok(!RECORDED_COINS.includes(c), c);
  assert.deepEqual([...FLOW_COINS], [...RECORDED_COINS, ...HOLDOUT_COINS]);
  assert.deepEqual([...HOLDOUT_PERPS], HOLDOUT_COINS.map((c) => `PERP_${c}_USDC`));
});

test("isHoldoutCoin takes a bare coin or an Orderly symbol", () => {
  assert.equal(isHoldoutCoin("SUI"), true);
  assert.equal(isHoldoutCoin("PERP_ZEC_USDC"), true);
  assert.equal(isHoldoutCoin("btc"), false);
  assert.equal(isHoldoutCoin(null), false);
});

test("no agent preset or paper default trades a holdout coin", () => {
  const presets = readFileSync(join(ROOT, "app/config/strategyPresets.ts"), "utf8");
  const types = readFileSync(join(ROOT, "app/pages/lab/types.ts"), "utf8");
  for (const c of HOLDOUT_COINS) {
    assert.ok(!presets.includes(`PERP_${c}_USDC`), `preset lists ${c}`);
    assert.ok(!types.includes(`PERP_${c}_USDC`), `default config lists ${c}`);
  }
});

test("the pre-registration names the same coins, reads and date", () => {
  const doc = readFileSync(join(ROOT, "docs/research/holdout-universe-prereg.md"), "utf8");
  for (const c of HOLDOUT_COINS) assert.ok(doc.includes(c), c);
  for (const a of HOLDOUT_AXES) assert.ok(doc.includes(a), a);
  assert.ok(doc.includes(HOLDOUT_SIGNED_OFF));
});
