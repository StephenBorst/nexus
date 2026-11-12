import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deactivateWarning, deactivatedMessage, restingStop } from "./agentControls.mjs";

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

test("the copy names the stop that stays resting on Orderly, never a stop that isn't there", () => {
  const withBs = { ...live, backstop: { id: 7, trigger: 1970 } };
  assert.deepEqual(restingStop(withBs), { price: 1970, own: false });
  assert.match(deactivateWarning(withBs), /only the exchange backstop stop, at \$1970/);
  assert.doesNotMatch(deactivateWarning(withBs), /NO stop/);
  assert.match(deactivatedMessage(withBs), /still open on Orderly with only the exchange backstop stop, at \$1970/);
  const own = { ...live, backstop: { id: 8, trigger: 1990.5, foreign: true } };
  assert.match(deactivateWarning(own), /only the position stop you set, at \$1990\.5/);
  // a take-profit-only slot-holder, a record without an id, a bad price: no stop is claimed
  for (const bs of [{ id: 8, trigger: null, foreign: true }, { trigger: 1970 }, { id: 7, trigger: "x" }, { id: 7, trigger: 0 }]) {
    assert.equal(restingStop({ ...live, backstop: bs }), null, JSON.stringify(bs));
    assert.match(deactivateWarning({ ...live, backstop: bs }), /NO stop/);
  }
});

test("lab-api's DEACTIVATE reply uses the same copy", () => {
  const src = readFileSync(new URL("../../workers/nexus-lab-api/index.js", import.meta.url), "utf8");
  assert.match(src, /import \{ deactivatedMessage \} from "\.\.\/\.\.\/app\/lib\/agentControls\.mjs";/);
});
