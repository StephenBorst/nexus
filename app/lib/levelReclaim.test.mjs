// level_reclaim — the grader and the brain's staged live gate are ONE rule (pipeline-if-then.md,
// Edge: "the agent rule for it, with a parity test proving the live gate equals the grader hour by
// hour"). Synthetic tapes only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { levelReclaimEvents, levelReclaimLive, levelReclaimRefusal, LEVEL_LIVE } from "./levelReclaim.mjs";
import { levelReclaimEvents as graderGen, EXPLORER_GENS } from "../../workers/nexus-lab-api/explorerReads.mjs";
import { deriveSignal, signalSourceT } from "../../workers/nexus-agent-brain/logic.mjs";
import { brainSignalKey } from "../../workers/nexus-agent-exec/logic.mjs";
import { axisForConfig, PARITY_ACT_WINDOW_MS } from "./paperParity.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 8, 1); // a UTC midnight

// Seeded hourly tape that wanders, with occasional wicks through the day's range, so prior-day
// levels get swept and reclaimed often enough for the test to mean something.
function tape(seed, days = 45) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let px = 100;
  const out = [];
  for (let i = 0; i < days * 24; i++) {
    const o = px;
    px = Math.max(1, px * (1 + (rnd() - 0.5) * 0.012));
    const wick = rnd() < 0.08 ? 0.015 : 0.003;
    const h = Math.max(o, px) * (1 + rnd() * wick), l = Math.min(o, px) * (1 - rnd() * wick);
    out.push({ t: T0 + i * H, o, h, l, c: px, v: 1 });
  }
  return out;
}

// What the brain sees on a tick at `now`: only candles that have closed (it appends each bar once closed).
const seenAt = (candles, now) => candles.filter((c) => c.t + H <= now);

test("the grader imports the shared rule (moved, not copied)", () => {
  assert.equal(graderGen, levelReclaimEvents);
  assert.equal(EXPLORER_GENS.level_reclaim, levelReclaimEvents);
});

test("parity: the live gate, ticked every hour on what the brain has stored, fires exactly the graded events", () => {
  let total = 0;
  for (const seed of [1, 7, 42, 99, 2026]) {
    const candles = tape(seed);
    const graded = levelReclaimEvents({ candleHist: candles });
    total += graded.length;
    const fired = new Map(); // t → side, first firing per event time
    // The brain ticks every 5 min; one tick 2 min after each hourly close is enough for the hourly series.
    for (let i = 0; i < candles.length; i++) {
      const now = candles[i].t + H + 2 * 60000;
      const live = levelReclaimLive(seenAt(candles, now), now);
      // A bar still forming (or a future one) changes nothing: the gate reads closed bars only.
      assert.deepEqual(levelReclaimLive(candles, now), live);
      if (live.side) {
        assert.ok(now - live.t >= 0 && now - live.t < LEVEL_LIVE.maxAgeMs, "fires only in the hour after its event");
        if (!fired.has(live.t)) fired.set(live.t, live.side);
      }
    }
    // Every firing is a graded event (no lookahead, no extra events) …
    for (const [t, side] of fired) assert.ok(graded.some((e) => e.t === t && e.side === side), `seed ${seed}: fired ${side} at ${new Date(t).toISOString()} with no graded event`);
    // … and every graded event fires, except a second event in the SAME hour (both levels reclaimed by
    // one bar): the agent can hold one position, so one of them fires and the other is a "busy" miss.
    const byT = new Map();
    for (const e of graded) byT.set(e.t, [...(byT.get(e.t) || []), e.side]);
    for (const [t, sides] of byT) {
      assert.ok(fired.has(t), `seed ${seed}: graded event at ${new Date(t).toISOString()} never fired`);
      assert.ok(sides.includes(fired.get(t)));
    }
  }
  assert.ok(total >= 20, `the tapes produce enough events to test (${total})`);
});

test("the live window is the parity check's action window (1h): an event is the agent's to take for that hour only", () => {
  assert.equal(LEVEL_LIVE.maxAgeMs, H);
  assert.equal(LEVEL_LIVE.maxAgeMs, PARITY_ACT_WINDOW_MS);
});

test("live gate: an event older than an hour, or stale candles, sits out with the reason", () => {
  const candles = tape(7);
  const graded = levelReclaimEvents({ candleHist: candles });
  const e = graded[Math.floor(graded.length / 2)];
  const late = e.t + LEVEL_LIVE.maxAgeMs + 60000;
  const r = levelReclaimLive(seenAt(candles, late), late);
  assert.ok(r.side === null || r.t !== e.t, "an hour-old event no longer fires");
  const now = candles[candles.length - 1].t + H + 4 * H; // the brain stopped storing bars 4h ago
  assert.match(levelReclaimLive(candles, now).reason, /candles stale/);
  assert.equal(levelReclaimLive([], Date.now()).side, null);
});

test("brain: with no live fields (the switch off, or no candles read) it sits out and says why", () => {
  const sig = deriveSignal({ fundingRate: 0.01 }, { signalMode: "LEVEL_RECLAIM", mode: "PAPER" });
  assert.equal(sig.direction, "NONE");
  assert.match(sig.reason, /staged \(off\)/);
});

test("brain: PAPER only — a live config is refused even when the read fires", () => {
  const raw = { levelReclaimSide: "LONG", levelReclaimReason: "prior-day low swept and reclaimed", levelReclaimT: T0 + 30 * H };
  for (const mode of ["AUTONOMOUS", "ASSISTED", undefined]) {
    const sig = deriveSignal(raw, { signalMode: "LEVEL_RECLAIM", mode });
    assert.equal(sig.direction, "NONE", `mode ${mode}`);
    assert.match(sig.reason, /paper only/);
  }
  assert.equal(levelReclaimRefusal({ signalMode: "LEVEL_RECLAIM", mode: "PAPER" }), null);
  assert.equal(levelReclaimRefusal({ signalMode: "BASIS_FADE", mode: "AUTONOMOUS" }), null, "other modes untouched");
});

test("brain → exec: a PAPER signal carries its event time, so exec takes each event once", () => {
  const t = T0 + 30 * H;
  const raw = { levelReclaimSide: "SHORT", levelReclaimReason: "prior-day high swept and reclaimed", levelReclaimT: t };
  const config = { signalMode: "LEVEL_RECLAIM", mode: "PAPER" };
  const sig = deriveSignal(raw, config);
  assert.equal(sig.direction, "SHORT");
  assert.equal(signalSourceT(raw, config), t);
  assert.equal(brainSignalKey({ symbol: "PERP_ETH_USDC", direction: "SHORT", sourceT: t }), `PERP_ETH_USDC|SHORT|${t}`);
  assert.equal(signalSourceT(raw, { signalMode: "CONFLUENCE" }), null, "other modes carry no source time");
});

test("parity route: a LEVEL_RECLAIM config is checked against the level_reclaim axis", () => {
  assert.equal(axisForConfig({ signalMode: "LEVEL_RECLAIM" }), "level_reclaim");
  assert.equal(axisForConfig({ signalMode: "LEVEL_RECLAIM", invertSignal: true }), null);
});

test("ON for PAPER only (2026-11-05, its paper-wallet PR): wrangler sets LEVEL_RECLAIM_LIVE, the brain gates on it, live stays refused", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-brain/index.js", import.meta.url), "utf8");
  assert.match(src, /const levelLive = env\.LEVEL_RECLAIM_LIVE === "true";/);
  assert.match(src, /config\.signalMode === "LEVEL_RECLAIM" && !levelReclaimRefusal\(config, \{ liveLift: liftOf\(address, config\) \}\)/, "only configs the paper-only rule (or the disarmed one-wallet lift) accepts make the brain read candles");
  assert.match(src, /deriveSignal\(raw, config, config\.respectRegime \? regime : null, cons, \{ liveLift: liftOf\(address, config\) \}\)/);
  const toml = readFileSync(new URL("../../workers/nexus-agent-brain/wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^\[vars\]\s*$/m);
  assert.match(toml, /^LEVEL_RECLAIM_LIVE = "true"$/m);
  for (const mode of ["AUTONOMOUS", "ASSISTED"]) assert.ok(levelReclaimRefusal({ signalMode: "LEVEL_RECLAIM", mode }), `${mode} is refused`);
});

test("the paper config is exactly what was graded: registered rule, graded exit, main-card coins, nothing else", async () => {
  const { LEVEL_RECLAIM_PAPER_CONFIG: c, LEVEL_RECLAIM_MAIN_SYMBOLS } = await import("./levelReclaim.mjs");
  const { gradedExitRefusal } = await import("./gradedExit.mjs");
  const { unsimulatedFilters } = await import("./paperParity.mjs");
  const { MAIN_COINS } = await import("../../tools/explorers/exitBridge.mjs");
  assert.equal(c.mode, "PAPER");
  assert.equal(c.signalMode, "LEVEL_RECLAIM");
  assert.equal(c.exitContract, "R_CONTRACT");
  assert.equal(gradedExitRefusal(c, true), null, "the graded exit accepts it as is");
  assert.ok(gradedExitRefusal({ ...c, mode: "AUTONOMOUS" }, false), "and refuses it off PAPER");
  assert.equal(levelReclaimRefusal(c), null);
  assert.deepEqual(unsimulatedFilters(c), [], "no gate the grader doesn't simulate");
  assert.equal(c.invertSignal, false);
  // The scoreboard's main card, out of sample (SUI is on the holdout line).
  assert.deepEqual([...c.symbols].sort(), MAIN_COINS.map((x) => `PERP_${x}_USDC`).sort());
  assert.deepEqual([...c.symbols], [...LEVEL_RECLAIM_MAIN_SYMBOLS]);
  assert.equal(axisForConfig(c), "level_reclaim", "parity checks it against its own axis");
});

test("no public preset and no public link: only the Lab's hidden ?deploy= handler loads it", () => {
  const roots = ["app/pages", "app/components", "app/config", "app/utils", "app/hooks"].map((d) => new URL(`../../${d}/`, import.meta.url).pathname);
  const hits = [];
  const walk = (dir) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|js)$/.test(n)) {
        const t = readFileSync(p, "utf8");
        if (t.includes("LEVEL_RECLAIM") || t.includes("level-reclaim-paper")) hits.push(p.split("/app/")[1]);
      }
    }
  };
  roots.forEach(walk);
  // the type union, the read-only label in the Agent tab, the hidden link's handler: nothing else
  assert.deepEqual(hits.sort(), ["pages/lab/AgentView.tsx", "pages/lab/index.tsx", "pages/lab/types.ts"]);
  const lab = readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8");
  assert.match(lab, /searchParams\.get\("deploy"\) !== LEVEL_RECLAIM_DEPLOY/);
  assert.ok(!lab.includes("href") || !/href[^\n]*deploy=/.test(lab), "the Lab doesn't link to it");
  const exits = readFileSync(new URL("./axisExits.mjs", import.meta.url), "utf8");
  assert.ok(!exits.includes("level_reclaim"), "no preset trades level_reclaim");
  const presets = readFileSync(new URL("../config/strategyPresets.ts", import.meta.url), "utf8");
  assert.ok(!/level_reclaim|LEVEL_RECLAIM/.test(presets), "not in the Strategy Library, no /proof Load");
});
