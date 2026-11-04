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

test("brain: LEVEL_RECLAIM ships off — no live fields means it sits out and says why", () => {
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

test("it ships OFF: the brain gates on LEVEL_RECLAIM_LIVE and wrangler.toml does not set it", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-brain/index.js", import.meta.url), "utf8");
  assert.match(src, /const levelLive = env\.LEVEL_RECLAIM_LIVE === "true";/);
  const toml = readFileSync(new URL("../../workers/nexus-agent-brain/wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/^\s*LEVEL_RECLAIM_LIVE\s*=/m.test(toml), "LEVEL_RECLAIM_LIVE is set: it stays off until level_reclaim is served TRADEABLE and its paper-wallet PR turns it on");
});

test("no mode in the Lab, no preset: nothing in the app offers LEVEL_RECLAIM", () => {
  const roots = ["app/pages", "app/components", "app/config", "app/utils", "app/hooks"].map((d) => new URL(`../../${d}/`, import.meta.url).pathname);
  const hits = [];
  const walk = (dir) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|js)$/.test(n) && readFileSync(p, "utf8").includes("LEVEL_RECLAIM")) hits.push(p);
    }
  };
  roots.forEach(walk);
  assert.deepEqual(hits, []);
  const exits = readFileSync(new URL("./axisExits.mjs", import.meta.url), "utf8");
  assert.ok(!exits.includes("level_reclaim"), "no preset trades level_reclaim");
});
