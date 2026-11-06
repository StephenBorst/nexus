import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deactivateWarning, deactivatedMessage } from "./agentControls.mjs";

const live = { symbol: "PERP_ETH_USDC", direction: "LONG", paper: false };

test("DEACTIVATE warns only when a LIVE position is open", () => {
  assert.equal(deactivateWarning(null), null);
  assert.equal(deactivateWarning(undefined), null);
  assert.equal(deactivateWarning({ ...live, paper: true }), null, "paper moves no money");
  const w = deactivateWarning(live);
  assert.match(w, /live ETH LONG/);
  assert.match(w, /NO stop/);
  assert.match(w, /KILL/);
  assert.match(deactivateWarning({ ...live, direction: "SHORT", symbol: "PERP_BTC_USDC" }), /BTC SHORT/);
});

test("the after-message never implies a live position was closed", () => {
  assert.equal(deactivatedMessage(null), "Agent deactivated. Trading key removed.");
  const m = deactivatedMessage(live);
  assert.match(m, /still open on Orderly/);
  assert.doesNotMatch(m, /closed\./i);
});

test("AgentView asks before DEACTIVATE and uses these strings", () => {
  const src = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function deactivateAgent()"), src.indexOf("async function saveConfig()"));
  assert.match(fn, /deactivateWarning\(/);
  assert.match(fn, /window\.confirm\(/);
  assert.match(fn, /deactivatedMessage\(/);
});
