import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pinnedRouter, SPOT_ROUTERS, ZEROX_ALLOWANCE_HOLDER } from "./spotRouters.mjs";

const BASE_NORDSTERN = "0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d"; // borst's live Base quote, 2026-11-12
const ATTACKER = "0x000000000000000000000000000000000000bEEF";

test("the routers read from live quotes (checksummed as served), and only those", () => {
  assert.equal(pinnedRouter(8453, BASE_NORDSTERN, BASE_NORDSTERN), true, "mixed case as the quote serves it");
  assert.equal(pinnedRouter(1, "0xa929c559E5e6537359680F39CB4E3708E1a14dd1", "0xa929c559E5e6537359680F39CB4E3708E1a14dd1"), true);
  assert.equal(pinnedRouter(42161, "0x57f96440f1b1cAD53B40A8924BD540b1279A491c", "0x57f96440f1b1cAD53B40A8924BD540b1279A491c"), true);
  assert.equal(pinnedRouter(10, "0xa575f37e869e6887564F87c07e2885e08D542C4a", "0xa575f37e869e6887564F87c07e2885e08D542C4a"), true);
  assert.equal(pinnedRouter(137, "0x99bA7d569EA69671B399A7cC488b687515F7EC23", "0x99bA7d569EA69671B399A7cC488b687515F7EC23"), true);
  for (const c of [1, 8453, 42161, 137]) assert.equal(pinnedRouter(c, ZEROX_ALLOWANCE_HOLDER, ZEROX_ALLOWANCE_HOLDER), true, `0x on ${c}`);
  assert.equal(pinnedRouter(10, ZEROX_ALLOWANCE_HOLDER, ZEROX_ALLOWANCE_HOLDER), false, "0x not seen live on Optimism");
  for (const list of Object.values(SPOT_ROUTERS)) for (const a of list) assert.match(a, /^0x[0-9a-f]{40}$/, "stored lowercase, full length");
});

test("refused: an unknown spender, a spender ≠ tx.to, another chain's router, an unlisted chain", () => {
  assert.equal(pinnedRouter(8453, ATTACKER, ATTACKER), false);
  assert.equal(pinnedRouter(8453, ATTACKER, BASE_NORDSTERN), false, "approve someone else, call the router");
  assert.equal(pinnedRouter(8453, BASE_NORDSTERN, ATTACKER), false, "approve the router, call someone else");
  assert.equal(pinnedRouter(42161, BASE_NORDSTERN, BASE_NORDSTERN), false, "Base's router on Arbitrum");
  assert.equal(pinnedRouter(4663, BASE_NORDSTERN, BASE_NORDSTERN), false, "Robinhood Chain: nothing read live yet");
  for (const bad of [undefined, null, "", 123]) assert.equal(pinnedRouter(8453, bad, bad), false, String(bad));
});

test("both users apply it: the worker's pick and the signer, before any approve", () => {
  const worker = readFileSync(new URL("../../workers/nexus-lab-api/spotQuote.mjs", import.meta.url), "utf8");
  const pick = worker.slice(worker.indexOf("export function pickSpotQuote("), worker.indexOf("usable.sort("));
  assert.match(pick, /if \(!pinnedRouter\(swap\.chainId, ap\.spender, tx\.to\)\) return false;/);
  const signer = readFileSync(new URL("../pages/token/swapExec.ts", import.meta.url), "utf8");
  const guard = signer.slice(signer.indexOf("async function quoteAndGuard("), signer.indexOf("export async function planBuy("));
  assert.match(guard, /if \(!pinnedRouter\(chainId, j\.approval\.spender, j\.tx\.to\)\) throw new Error\(/);
  assert.ok(guard.indexOf("pinnedRouter(") < guard.indexOf("return {"), "before the plan exists");
  const exec = signer.slice(signer.indexOf("export async function executeSwap("));
  const recheck = exec.indexOf("if (!pinnedRouter(plan.chainId, plan.spender, plan.tx.to)) throw new Error(");
  assert.ok(recheck > 0 && recheck < exec.indexOf("encApprove("), "re-checked right before the approve");
});
