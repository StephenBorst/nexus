// oi_div_reversal_4h — the grader and the brain's live gate are ONE rule (pipeline-if-then.md, Edge: "the agent
// rule for it, with a parity test proving the live gate equals the grader hour by hour"; Tradeable: "borst sets up
// one paper wallet for it with the preset as registered, on the main coins only"). Synthetic tapes only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  oiDivReversalEvents, oiDivReversal4hEvents, OI_DIV, OI_DIV_4H, oiDiv4hLive, oiDiv4hRefusal, OI_DIV_4H_LIVE_RULES,
  OI_DIV_4H_PAPER_CONFIG, OI_DIV_4H_DEPLOY,
} from "./oiDivReversal.mjs";
import * as grader from "../../workers/nexus-lab-api/explorerReads.mjs";
import { deriveSignal, signalSourceT } from "../../workers/nexus-agent-brain/logic.mjs";
import { brainSignalKey } from "../../workers/nexus-agent-exec/logic.mjs";
import { axisForConfig, PARITY_ACT_WINDOW_MS, unsimulatedFilters } from "./paperParity.mjs";
import { gradedExitRefusal } from "./gradedExit.mjs";
import { LEVEL_RECLAIM_MAIN_SYMBOLS } from "./levelReclaim.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 7, 1);

// Seeded oi:hist the way the brain writes it: one row per hour, a few minutes past the hour, with the odd
// missing hour, and bursts where price runs while OI drains, so the rule fires often enough to mean something.
function tape(seed, hours = 2000) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let px = 100, oi = 1e6, burst = 0, dir = 1;
  const out = [];
  for (let i = 0; i < hours; i++) {
    if (!burst && rnd() < 0.02) { burst = 4; dir = rnd() < 0.5 ? -1 : 1; }
    if (burst) { px *= 1 + dir * (0.006 + rnd() * 0.01); oi *= 1 - (0.006 + rnd() * 0.01); burst--; }
    else { px *= 1 + (rnd() - 0.5) * 0.008; oi *= 1 + (rnd() - 0.5) * 0.01; }
    if (rnd() < 0.02) continue; // a missed hour
    out.push({ t: T0 + i * H + Math.floor(rnd() * 20 * 60000), price: px, oi, funding: 0 });
  }
  return out;
}

test("the grader imports the shared rule (moved, not copied)", () => {
  assert.equal(grader.oiDivReversal4hEvents, oiDivReversal4hEvents);
  assert.equal(grader.oiDivReversalEvents, oiDivReversalEvents);
  assert.equal(grader.EXPLORER_GENS.oi_div_reversal_4h, oiDivReversal4hEvents);
  assert.equal(grader.EXPLORER_GENS.oi_div_reversal, oiDivReversalEvents);
  assert.equal(grader.OI_DIV_4H, OI_DIV_4H);
  // the signed settings (oi-div-reversal-4h-prereg.md): 4h window, OI −2%, 12h cooldown, else the 24h rule's
  assert.deepEqual({ ...OI_DIV_4H }, { ...OI_DIV, windowH: 4, oiDrop: 0.02, cooldownH: 12 });
});

test("parity: the live gate, ticked on what the brain has stored, fires exactly the graded events", () => {
  let total = 0;
  for (const seed of [1, 7, 42]) {
    const rows = tape(seed, 1200);
    const graded = oiDivReversal4hEvents({ oiHist: rows });
    total += graded.length;
    const fired = new Map(); // t → side, first firing per event
    // The brain writes the hour's row, then evaluates in the same tick; it ticks again every 5 min. A full
    // re-run per tick costs ~10 ms here, so the ticks are: the first and last tick of every graded event's
    // hour, the tick just after that hour, and every 5th row's write (no event there may fire).
    const ticks = new Set();
    for (const e of graded) for (const after of [5000, 55 * 60000, H + 5000]) ticks.add(e.t + after);
    rows.forEach((r, i) => { if (i % 5 === 0) ticks.add(r.t + 5000); });
    for (const now of [...ticks].sort((a, b) => a - b)) {
      const live = oiDiv4hLive(rows.filter((r) => r.t <= now), now);
      assert.deepEqual(oiDiv4hLive(rows, now), live, "rows not yet written change nothing");
      if (live.side) {
        assert.ok(now - live.t >= 0 && now - live.t < OI_DIV_4H_LIVE_RULES.maxAgeMs, "fires only in the hour after its event");
        if (!fired.has(live.t)) fired.set(live.t, live.side);
      }
    }
    for (const [t, side] of fired) assert.ok(graded.some((e) => e.t === t && e.side === side), `seed ${seed}: fired ${side} at ${new Date(t).toISOString()} with no graded event`);
    for (const e of graded) assert.equal(fired.get(e.t), e.side, `seed ${seed}: graded ${e.side} at ${new Date(e.t).toISOString()} never fired`);
  }
  assert.ok(total >= 30, `the tapes produce enough events to test (${total})`);
});

test("the live window is the parity check's action window (1h)", () => {
  assert.equal(OI_DIV_4H_LIVE_RULES.maxAgeMs, H);
  assert.equal(OI_DIV_4H_LIVE_RULES.maxAgeMs, PARITY_ACT_WINDOW_MS);
});

test("live gate: an event older than an hour, or a history that stopped growing, sits out with the reason", () => {
  const rows = tape(7);
  const graded = oiDivReversal4hEvents({ oiHist: rows });
  const e = graded[Math.floor(graded.length / 2)];
  const late = e.t + H + 60000;
  const r = oiDiv4hLive(rows.filter((x) => x.t <= late), late);
  assert.ok(r.side === null || r.t !== e.t, "an hour-old event no longer fires");
  const stale = rows[rows.length - 1].t + 4 * H;
  assert.match(oiDiv4hLive(rows, stale).reason, /OI history stale/);
  assert.equal(oiDiv4hLive([], Date.now()).side, null);
});

test("brain: with no live fields (the switch off, or no history read) it sits out and says why", () => {
  const sig = deriveSignal({ fundingRate: 0.01 }, { signalMode: "OI_DIV_4H", mode: "PAPER" });
  assert.equal(sig.direction, "NONE");
  assert.match(sig.reason, /off/);
});

test("brain: PAPER only — a live config is refused even when the read fires", () => {
  const raw = { oiDiv4hSide: "LONG", oiDiv4hReason: "extreme 4h drop on falling OI, faded", oiDiv4hT: T0 + 900 * H };
  for (const mode of ["AUTONOMOUS", "ASSISTED", undefined]) {
    const sig = deriveSignal(raw, { signalMode: "OI_DIV_4H", mode }, null, null, { liveLift: true });
    assert.equal(sig.direction, "NONE", `mode ${mode}`);
    assert.match(sig.reason, /paper only/);
  }
  assert.equal(oiDiv4hRefusal({ signalMode: "OI_DIV_4H", mode: "PAPER" }), null);
  assert.equal(oiDiv4hRefusal({ signalMode: "BASIS_FADE", mode: "AUTONOMOUS" }), null, "other modes untouched");
});

test("brain → exec: a PAPER signal carries its event time, so exec takes each event once", () => {
  const t = T0 + 900 * H;
  const raw = { oiDiv4hSide: "SHORT", oiDiv4hReason: "extreme 4h rally on falling OI, faded", oiDiv4hT: t };
  const config = { signalMode: "OI_DIV_4H", mode: "PAPER" };
  assert.equal(deriveSignal(raw, config).direction, "SHORT");
  assert.equal(signalSourceT(raw, config), t);
  assert.equal(brainSignalKey({ symbol: "PERP_SOL_USDC", direction: "SHORT", sourceT: t }), `PERP_SOL_USDC|SHORT|${t}`);
});

test("parity route: an OI_DIV_4H config is checked against the oi_div_reversal_4h axis", () => {
  assert.equal(axisForConfig({ signalMode: "OI_DIV_4H" }), "oi_div_reversal_4h");
  assert.equal(axisForConfig({ signalMode: "OI_DIV_4H", invertSignal: true }), null);
  const src = readFileSync(new URL("../../workers/nexus-lab-api/parityEvents.mjs", import.meta.url), "utf8");
  assert.match(src, /oi:hist:PERP_/, "its events come from the oi:hist the grader reads");
});

test("ON for PAPER only: wrangler sets OI_DIV_4H_LIVE, the brain gates on it and reads oi:hist through the shared gate", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-brain/index.js", import.meta.url), "utf8");
  assert.match(src, /const oiDivLive = env\.OI_DIV_4H_LIVE === "true";/);
  assert.match(src, /config\.signalMode === "OI_DIV_4H" && !oiDiv4hRefusal\(config\)/);
  assert.match(src, /oiDiv4hLive\(raw \? JSON\.parse\(raw\) : \[\]\)/);
  const toml = readFileSync(new URL("../../workers/nexus-agent-brain/wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^OI_DIV_4H_LIVE = "true"$/m);
  // the oi:hist rows are recorded before any market is evaluated, so the gate sees this hour's row on the same tick
  assert.ok(src.indexOf("recordOiForSymbols(HARNESS_SYMBOLS") < src.indexOf("evaluateSymbol(symbol, env"), "rows first, then the read");
});

test("the paper config is exactly what was graded: registered rule, graded exit, main-card coins, nothing else", async () => {
  const c = OI_DIV_4H_PAPER_CONFIG;
  const { MAIN_COINS } = await import("../../tools/explorers/exitBridge.mjs");
  assert.equal(c.mode, "PAPER");
  assert.equal(c.signalMode, "OI_DIV_4H");
  assert.equal(c.exitContract, "R_CONTRACT");
  assert.equal(gradedExitRefusal(c, true), null, "the graded exit accepts it as is");
  assert.ok(gradedExitRefusal({ ...c, mode: "AUTONOMOUS" }, false), "and refuses it off PAPER");
  assert.equal(oiDiv4hRefusal(c), null);
  assert.deepEqual(unsimulatedFilters(c), [], "no gate the grader doesn't simulate");
  assert.equal(c.invertSignal, false);
  assert.deepEqual([...c.symbols].sort(), MAIN_COINS.map((x) => `PERP_${x}_USDC`).sort(), "the main card (SUI is on the holdout line)");
  assert.deepEqual([...c.symbols], [...LEVEL_RECLAIM_MAIN_SYMBOLS]);
  assert.equal(axisForConfig(c), "oi_div_reversal_4h");
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
        if (t.includes("OI_DIV_4H") || t.includes(OI_DIV_4H_DEPLOY)) hits.push(p.split("/app/")[1]);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(hits.sort(), ["pages/lab/AgentView.tsx", "pages/lab/index.tsx", "pages/lab/types.ts"]);
  const lab = readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8");
  assert.match(lab, /searchParams\.get\("deploy"\) !== OI_DIV_4H_DEPLOY/);
  assert.ok(!/href[^\n]*deploy=/.test(lab), "the Lab doesn't link to it");
  const presets = readFileSync(new URL("../config/strategyPresets.ts", import.meta.url), "utf8");
  assert.ok(!/oi_div_reversal_4h|OI_DIV_4H/.test(presets), "not in the Strategy Library, no /proof Load");
});
