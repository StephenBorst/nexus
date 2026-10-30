// The REGISTERED stress-hour study (docs/research/stress-hours-prereg.md): the page and the code say the
// same thing, nothing that trades imports it, behaviour on hand-built tapes, no lookahead, and the
// count tool counts only. Run: node --test workers/nexus-lab-api/stressHours.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { STRESS_RULE, STRESS_STUDY, stressPanel, stressHours, stressEpisodes, inStress, judgedHourSet, stressLabel } from "./stressHours.mjs";
import { stressCount, STRESS_READS } from "../../tools/explorers/stressCount.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);
const COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "DOGE", "AVAX", "HYPE"];

test("the brain and exec never import the study (it labels hours; it never trades)", () => {
  for (const f of ["../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js", "../nexus-agent-exec/logic.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /stressHours/, `${f} must not import the stress study`);
  }
});

// The page as registered on 2026-10-30: everything above "## Results". A changed rule is a new
// registration under a new name, never an edit here.
const DOC = readFileSync(new URL("../../docs/research/stress-hours-prereg.md", import.meta.url), "utf8");
const REGISTERED_PREFIX_SHA256 = "db50e7896677089b5b8f824b0711f2fe3809daa656e0a02529c93ec53af7ff66";

test("the registration above Results is exactly as signed", () => {
  const cut = DOC.indexOf("\n## Results");
  assert.ok(cut > 0, "the Results heading is missing");
  assert.equal(createHash("sha256").update(DOC.slice(0, cut)).digest("hex"), REGISTERED_PREFIX_SHA256);
});

test("the numbers on the page are the numbers in the code", () => {
  assert.deepEqual({ ...STRESS_RULE }, {
    windowH: 4, oiDrop: 0.02, breadth: 5, movePct: 0.9, lookbackH: 720, minHistory: 360, minCoins: 6, afterH: 24, minJudgedH: 20, episodeGapH: 24,
  });
  assert.equal(STRESS_STUDY.registeredAt, "2026-10-31T00:00:00Z");
  assert.equal(STRESS_STUDY.limit, "2027-04-30T00:00:00Z");
  assert.deepEqual([STRESS_STUDY.minEach, STRESS_STUDY.minAtLimit, STRESS_STUDY.shifts, STRESS_STUDY.minShiftDays, STRESS_STUDY.seed, STRESS_STUDY.alpha], [30, 20, 1000, 7, 20261031, 0.05]);
  for (const needle of ["**5 of the 9**", "**2% or more**", "**4h**", "**90th percentile**", "at least 6 readable coins", "24h after a stress hour", "20 of those 24 hours",
    "2026-10-31T00:00:00Z", "2027-04-30", "1,000", "7 days", "seed 20261031", "Holm", "30 STRESS and 30 CALM", "fewer than 20 STRESS"]) {
    assert.ok(DOC.includes(needle), `the page doesn't say "${needle}"`);
  }
});

test("the study covers exactly the reads registered at signing, each counted by the tool", () => {
  const atSigning = REGISTERED_READS.filter((r) => Date.parse(r.registeredAt) <= Date.parse("2026-10-30T23:59:59Z")).map((r) => r.axis).sort();
  assert.deepEqual([...STRESS_STUDY.reads].sort(), atSigning);
  for (const n of STRESS_STUDY.reads) { assert.equal(typeof STRESS_READS[n], "function", `${n} has no generator`); assert.ok(DOC.includes(`\`${n}\``), `${n} not named on the page`); }
});

// Nine coins, gently noisy; `shock(h)` returns a multiplier set for hour h: { oi, px } per coin index.
function panel(n, shock = () => null, seed = 3) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  return COINS.map((coin, ci) => {
    let p = 100 + ci, oi = 1000 + ci;
    const oiHist = [], candleHist = [];
    for (let i = 0; i < n; i++) {
      const o = p;
      const k = shock(i, ci);
      p *= 1 + (rnd() - 0.5) * 0.004 + (k?.px || 0);
      oi *= 1 + (rnd() - 0.5) * 0.004 + (k?.oi || 0);
      candleHist.push({ t: T0 + i * H, o, h: Math.max(o, p) * (1 + rnd() * 0.001 + Math.abs(k?.px || 0)), l: Math.min(o, p) * (1 - rnd() * 0.001), c: p });
      oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: 0 });
    }
    return { coin, oiHist, candleHist };
  });
}

const AT = 600; // hour of the hand-built cascade (past the 15-day history the move rank needs)
const cascade = (nCoins) => (i, ci) => (i === AT && ci < nCoins ? { oi: -0.04, px: -0.05 } : i === AT ? { px: -0.05 } : null);

test("a board-wide move with five coins delevering is a stress hour; four is not", () => {
  const five = stressHours(panel(800, cascade(5)));
  assert.ok(five.includes(T0 + AT * H + 120000), "the cascade hour is a stress hour, stamped when its rows were written");
  assert.ok(five.every((t) => t >= T0 + AT * H && t < T0 + (AT + STRESS_RULE.windowH) * H), "and only the 4h it sits inside");
  assert.deepEqual(stressHours(panel(800, cascade(4))), []);
});

test("delevering without the board moving is not stress", () => {
  const quiet = (i, ci) => (i === AT && ci < 6 ? { oi: -0.04 } : null);
  assert.deepEqual(stressHours(panel(800, quiet)), []);
});

test("an hour with fewer than six readable coins is not judged (never calm by default)", () => {
  const sets = panel(800, cascade(5)).map((s, i) => (i >= 5 ? { ...s, oiHist: [] } : s));
  assert.deepEqual(stressPanel(sets), []);
});

test("no history, no verdict: the move rank needs 15 days first", () => {
  const early = (i, ci) => (i === 100 && ci < 9 ? { oi: -0.04, px: -0.05 } : null);
  assert.deepEqual(stressHours(panel(400, early)), []);
});

test("no lookahead: the future never changes past stress hours or judged hours", () => {
  const full = panel(1500, (i, ci) => ((i === 700 || i === 1100) && ci < 6 ? { oi: -0.05, px: 0.06 } : null));
  const base = stressHours(full);
  const baseJudged = [...judgedHourSet(full)];
  assert.ok(base.length > 0);
  for (const cutH of [800, 1000, 1200]) {
    const cut = T0 + cutH * H;
    const poisoned = full.map((s) => ({ ...s, oiHist: s.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1 } : r)) }));
    const before = (xs) => xs.filter((t) => t <= cut);
    assert.deepEqual(before(stressHours(poisoned)), before(base), `stress looked past ${cutH}h`);
    const pastHour = (xs) => xs.filter((h) => h * H + 120000 <= cut);
    assert.deepEqual(pastHour([...judgedHourSet(poisoned)]), pastHour(baseJudged), `judging looked past ${cutH}h`);
  }
});

test("labels: STRESS inside the window; CALM only with 20 of the 24 hours judged; else UNJUDGED", () => {
  const S = T0 + 100 * H;
  const all = new Set(Array.from({ length: 300 }, (_, i) => i + Math.round(T0 / H)));
  assert.equal(stressLabel(S + 23 * H, [S], all), "STRESS");
  assert.equal(stressLabel(S + 24 * H, [S], all), "CALM");
  const gappy = new Set([...all].filter((h) => h % 6 !== 0)); // 20 of every 24 judged
  assert.equal(stressLabel(S + 200 * H, [S], gappy), "CALM");
  const gappier = new Set([...all].filter((h) => h % 4 !== 0)); // 18 of 24
  assert.equal(stressLabel(S + 200 * H, [S], gappier), "UNJUDGED");
  assert.equal(stressLabel(S + 5 * H, [S], new Set()), "STRESS", "a stress window labels even when later hours are unjudged");
});

test("episodes merge hours within 24h; the window is [S, S+24h)", () => {
  const hs = [0, 2, 30, 80].map((h) => T0 + h * H);
  assert.deepEqual(stressEpisodes(hs).map((e) => e.hours), [2, 1, 1]);
  assert.equal(stressEpisodes([T0, T0 + 24 * H]).length, 1);
  assert.equal(inStress(T0 - 1, hs), false);
  assert.equal(inStress(T0, hs), true);
  assert.equal(inStress(T0 + 25 * H, hs), true);   // 23h after the hour-2 stress
  assert.equal(inStress(T0 + 26 * H, hs), false);  // 24h after it: outside
  assert.equal(inStress(T0 + 30 * H, hs), true);
});

test("the count tool returns counts and nothing else", () => {
  const sets = panel(1500, (i, ci) => (i === 900 && ci < 6 ? { oi: -0.05, px: -0.06 } : null));
  const fakeRead = () => [{ t: T0 + 905 * H, side: "LONG" }, { t: T0 + 1300 * H, side: "SHORT" }];
  const r = stressCount(sets, sets, { days: 60, now: T0 + 1500 * H, reads: { fake: fakeRead } });
  assert.deepEqual(Object.keys(r).sort(), ["episodes", "hoursCovered", "judgedHours", "perRead", "stressHours"]);
  assert.deepEqual(r.perRead.fake, { events: 18, STRESS: 9, CALM: 9, UNJUDGED: 0 });
  for (const k of ["episodes", "hoursCovered", "judgedHours", "stressHours"]) assert.equal(typeof r[k], "number");
});
