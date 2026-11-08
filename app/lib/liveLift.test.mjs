// The one-wallet live lift of the graded exit (build #3 of docs/research/live-plan-level-reclaim.md), BUILT DISARMED.
// Run: node --test app/lib/liveLift.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLiveLift, liveLifted, liveLiftNote, livePlanRefusal, liftedSignalRefusal, LIVE_PLAN_LIMITS, LIVE_LIFT_VAR } from "./liveLift.mjs";
import { gradedExitRefusal } from "./gradedExit.mjs";
import { riskSizingRefusal } from "./riskSizing.mjs";
import { levelReclaimRefusal, LEVEL_RECLAIM_PAPER_CONFIG } from "./levelReclaim.mjs";
import { deriveSignal } from "../../workers/nexus-agent-brain/logic.mjs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const W = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
// The live plan's config: the paper wallet's config with the plan's size fields (live-plan-level-reclaim.md §3).
const LIVE = Object.freeze({
  ...LEVEL_RECLAIM_PAPER_CONFIG, mode: "AUTONOMOUS",
  riskPerTradeUsd: 10, leverage: 3, capitalPerTrade: 300, maxDailyLossUsdc: 30, maxTradesPerDay: 4,
});
const ARMED = `${W}@LEVEL_RECLAIM`;

test("DISARMED: the var is empty and identical in lab-api, exec and brain wrangler.toml", () => {
  const vals = ["workers/nexus-lab-api/wrangler.toml", "workers/nexus-agent-exec/wrangler.toml", "workers/nexus-agent-brain/wrangler.toml"].map((f) => {
    const m = new RegExp(`^${LIVE_LIFT_VAR} = "([^"]*)"$`, "m").exec(read(f));
    assert.ok(m, `${f} sets ${LIVE_LIFT_VAR}`);
    return m[1];
  });
  // Arming = borst, in person (live-plan-level-reclaim.md §6). The PR that arms changes this line, records the date,
  // the wallet and his sign-off on the plan. No session, scheduled task or merge arms it.
  assert.deepEqual(vals, ["", "", ""], "the one-wallet live lift is armed: that needs borst in person and its own PR");
  assert.equal(parseLiveLift("").size, 0);
});

test("parseLiveLift: wallet@mode entries, lowercased; bad wallets and unliftable modes dropped", () => {
  const m = parseLiveLift(` ${W.toUpperCase().replace("0X", "0x")}@level_reclaim , 0xnot@LEVEL_RECLAIM, ${OTHER}@BASIS_FADE, ${OTHER}`);
  assert.deepEqual([...m.keys()], [W]);
  assert.deepEqual([...m.get(W)], ["LEVEL_RECLAIM"]);
});

test("the plan's live config lifts all three paper-only refusals, for the listed wallet only", () => {
  assert.equal(livePlanRefusal(LIVE), null);
  assert.equal(liveLifted(LIVE, W, ARMED), true);
  const liveLift = liveLifted(LIVE, W, ARMED);
  assert.equal(gradedExitRefusal(LIVE, false, { liveLift }), null);
  assert.equal(riskSizingRefusal(LIVE, false, { liveLift }), null);
  assert.equal(levelReclaimRefusal(LIVE, { liveLift }), null);
  // every other wallet, and the same wallet with the var empty: refused as before
  for (const [w, v] of [[OTHER, ARMED], [W, ""], [W, `${W}@LEVEL_RECLAIM`.replace(W, OTHER)]]) {
    const l = liveLifted(LIVE, w, v);
    assert.equal(l, false);
    assert.match(gradedExitRefusal(LIVE, false, { liveLift: l }), /paper-only/);
    assert.match(riskSizingRefusal(LIVE, false, { liveLift: l }), /paper-only/);
    assert.match(levelReclaimRefusal(LIVE, { liveLift: l }), /paper only/);
  }
  // the default (no option) is the old paper-only rule
  assert.match(gradedExitRefusal(LIVE, false), /paper-only/);
  assert.match(levelReclaimRefusal(LIVE), /paper only/);
});

test("a lifted wallet still can't trade anything but the plan: every number is a ceiling, every gate is refused", () => {
  const off = (patch) => liveLifted({ ...LIVE, ...patch }, W, ARMED);
  const cases = {
    "no fixed risk": { riskPerTradeUsd: undefined },
    "risk above $10": { riskPerTradeUsd: 11 },
    "leverage above 3x": { leverage: 4 },
    "margin ceiling above $300": { capitalPerTrade: 301 },
    "no daily loss cap": { maxDailyLossUsdc: 0 },
    "daily loss above $30": { maxDailyLossUsdc: 31 },
    "trades/day above 4": { maxTradesPerDay: 5 },
    "a hold other than 168h": { maxHoldHours: 24 },
    "a coin off the main card": { symbols: ["PERP_SUI_USDC"] },
    "no coins": { symbols: [] },
    "inverted": { invertSignal: true },
    "an ungraded gate": { respectRegime: true },
    "vol targeting": { volTargetPct: 2 },
    "another read": { signalMode: "BASIS_FADE" },
    "no graded exit": { exitContract: undefined },
    "autocopy": { autocopy: { enabled: true, leaders: [OTHER] } },
  };
  for (const [why, patch] of Object.entries(cases)) assert.equal(off(patch), false, why);
  // a ladder / trail on the lifted config is still refused by the graded exit's own rules
  assert.match(gradedExitRefusal({ ...LIVE, trailingStopPct: 1 }, false, { liveLift: true }), /trailing stop/);
  // PAPER is never "lifted": it needs no lift
  assert.equal(liveLifted({ ...LIVE, mode: "PAPER" }, W, ARMED), false);
});

test("liveLiftNote says why a LISTED wallet's live config isn't lifted, and nothing for anyone else", () => {
  assert.match(liveLiftNote({ ...LIVE, leverage: 5 }, W, ARMED), /leverage is capped at 3x/);
  assert.equal(liveLiftNote(LIVE, W, ARMED), null);
  assert.equal(liveLiftNote({ ...LIVE, leverage: 5 }, OTHER, ARMED), null);
});

test("LIVE_PLAN_LIMITS match the live plan's page", () => {
  const plan = read("docs/research/live-plan-level-reclaim.md");
  assert.match(plan, /\*\*Fixed risk: \$10 per trade/);
  assert.match(plan, /\*\*3×\.\*\*/);
  assert.match(plan, /`maxDailyLossUsdc` \*\*\$30\*\*/);
  assert.match(plan, /`maxTradesPerDay` \*\*4\*\*/);
  assert.match(plan, /about \$300 of margin/);
  assert.deepEqual({ ...LIVE_PLAN_LIMITS }, { riskPerTradeUsd: 10, leverage: 3, maxDailyLossUsdc: 30, maxTradesPerDay: 4, capitalPerTrade: 300, maxHoldHours: 168 });
});

test("the brain: a lifted live config gets its level_reclaim signal; unlifted it sits out", () => {
  const raw = { levelReclaimSide: "LONG", levelReclaimReason: "prior-day low swept and reclaimed" };
  assert.equal(deriveSignal(raw, LIVE, null, null, { liveLift: true }).direction, "LONG");
  const out = deriveSignal(raw, LIVE, null, null);
  assert.equal(out.direction, "NONE");
});

test("every gate passes the wallet to the lift: exec, brain and all four lab-api config paths", () => {
  const exec = read("workers/nexus-agent-exec/index.js");
  assert.match(exec, /const liveLift = !paper && liveLifted\(config, address, lifts\);/);
  assert.match(exec, /riskSizingRefusal\(config, paper, \{ liveLift \}\)/);
  const brain = read("workers/nexus-agent-brain/index.js");
  assert.match(brain, /const liftOf = \(address, config\) => liveLifted\(config, address, lifts\);/);
  const api = read("workers/nexus-lab-api/index.js");
  assert.equal((api.match(/const liveLift = liveLifted\(cfgL, address, lifts\);/g) || []).length, 4);
  assert.equal((api.match(/gradedExitRefusal\(cfgL, [^)]*, \{ liveLift \}\)/g) || []).length, 4);
  assert.equal((api.match(/riskSizingRefusal\(cfgL, [^)]*, \{ liveLift \}\)/g) || []).length, 4);
  // nothing else imports the lift: one rule, these three users (and the Lab never decides it)
  assert.doesNotMatch(read("app/pages/lab/AgentView.tsx"), /liveLift/);
});

test("a lifted entry is the brain's read on a plan coin: no webhook, directive or autocopy, no other market", () => {
  const coin = LIVE.symbols[0];
  const brain = { symbol: coin, direction: "LONG", confidence: 70, timestamp: 1 };
  assert.equal(liftedSignalRefusal(brain, LIVE), null);
  for (const source of ["WEBHOOK", "DIRECTIVE", "COPY"]) {
    assert.match(liftedSignalRefusal({ ...brain, source }, LIVE), new RegExp(source.toLowerCase()), source);
  }
  // a directive carries its own leverage + capital (skips fixed-risk sizing): refused even untagged
  assert.match(liftedSignalRefusal({ ...brain, directive: { leverage: 20, capitalPerTrade: 5000 } }, LIVE), /isn't the plan/);
  assert.match(liftedSignalRefusal({ ...brain, symbol: "PERP_SUI_USDC" }, LIVE), /isn't one of the plan's coins/);
  assert.match(liftedSignalRefusal({ ...brain, symbol: coin }, { ...LIVE, symbols: [] }), /plan's coins/);
  for (const bad of [null, undefined, "x"]) assert.equal(liftedSignalRefusal(bad, LIVE), "no signal");
});

test("exec refuses a non-plan entry on a lifted wallet before anything is read or placed", () => {
  const exec = read("workers/nexus-agent-exec/index.js");
  const e = exec.slice(exec.indexOf("async function enterPosition("), exec.indexOf("\nasync function ", exec.indexOf("async function enterPosition(") + 10));
  const lift = e.indexOf("const liveLift = !paper && liveLifted(config, address, lifts);");
  const gate = e.indexOf("const why = liftedSignalRefusal(signal, config);");
  assert.ok(lift > 0 && gate > lift, "after the lift is decided");
  for (const later of ["getMarkPrice(", "agent:key:", '"/v1/order"', '"/v1/client/leverage"']) {
    const at = e.indexOf(later);
    assert.ok(at === -1 || gate < at, `before ${later}`);
  }
  assert.match(e, /if \(liveLift\) \{\s*const why = liftedSignalRefusal\(signal, config\);\s*if \(why\) \{ console\.error\([^\n]*\); return; \}/);
});
