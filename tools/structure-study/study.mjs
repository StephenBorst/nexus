// ── Structure × house funding fade: the registered test, as code ────────────────────────────────
// docs/research/structure-house-fade-prereg.md is the protocol; PREREG below is its parameter block,
// pinned to the document by prereg.test.mjs (a change to either fails CI). This module is pure: the
// runner (run.mjs) brings the calls and the candles, this file only decides.
//
// Report-only. Nothing live reads it: no card, no gate, no agent.
import { createHash } from "node:crypto";

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };

export const PREREG = deepFreeze({
  id: "structure-house-fade-v1",
  registered: "2026-09-30",
  cutoffMs: 1790726400000,
  population: {
    wallet: "0xfc8c4f4e5ad8535571c199633aa1ec63e8f34a52",
    source: "nexus-signal",
    idPrefix: "nexus-",
    minGradeV: 3,
    outcomes: ["WIN", "LOSS"],
  },
  stage1: {
    file: "tools/structure-study/population-stage1.json",
    n: 163,
    sha256: "8964d348345bdbd43b29931184723f74ca7b5343e17fd42c95cfb6c19a5686c0",
  },
  candles: { venue: "orderly-perp", resolution: "240", pageDays: 40, weeksBefore: 28 },
  structure: {
    fractalK: 2,
    atrLen: 14,
    zoneLookbackBars: 180,
    zoneAtrMult: 1,
    minH4Bars: 60,
    weeklyWindow: 26,
    weeklyMinWeeks: 8,
  },
  test: {
    sided: "two",
    permutations: 10000,
    seed: 7,
    alpha: 0.05,
    minPerGroup: 30,
    minGapR: 0.4,
    survivorMeanAbove: 0,
    halves: "same-sign",
    leaveOneMarketOut: "same-sign",
    maxFetchFailureShare: 0.1,
  },
  stage2: {
    windowDays: 14,
    readNotBeforeDays: 28,
    minPerGroup: 15,
    minGapR: 0.2,
    survivorMeanAbove: 0,
  },
});

export const VERDICTS = Object.freeze({
  SILENCE_COUNTER_CYCLE: "SILENCE_COUNTER_CYCLE",   // counter-cycle fades did reliably worse
  SILENCE_WITH_STRUCTURE: "SILENCE_WITH_STRUCTURE", // fades WITH structure did reliably worse
  NOT_SHOWN: "NOT_SHOWN",
  INSUFFICIENT: "INSUFFICIENT",
  VOID: "VOID",
});

// Same generator as workers/nexus-lab-api/backtest.mjs (pinned by study.test.mjs), kept local so
// the runner needs no worker dependencies.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** n, wins, losses, hit rate, mean R, total R for a list of rows with `r`. */
export function summarize(rows) {
  const rs = rows.map((x) => x.r);
  const wins = rs.filter((r) => r > 0).length;
  return {
    n: rs.length,
    wins,
    losses: rs.length - wins,
    hitRate: rs.length ? wins / rs.length : null,
    meanR: mean(rs),
    sumR: rs.reduce((s, r) => s + r, 0),
  };
}

/** Sample standard deviation (n − 1). */
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Two-sided permutation test on the difference of means, gap = mean(a) − mean(b): shuffle the
 * pooled values `iters` times (seeded), count shuffles at least as extreme as the real gap.
 * p = (hits + 1) / (iters + 1), so p is never 0.
 */
export function permutationTest(a, b, { iters, seed }) {
  const gap = mean(a) - mean(b);
  const arr = [...a, ...b];
  const total = arr.reduce((s, x) => s + x, 0);
  const na = a.length, nb = b.length;
  const rnd = mulberry32(seed);
  const bar = Math.abs(gap) - 1e-12;
  let hits = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    let sa = 0;
    for (let i = 0; i < na; i++) sa += arr[i];
    if (Math.abs(sa / na - (total - sa) / nb) >= bar) hits++;
  }
  return { gap, p: (hits + 1) / (iters + 1) };
}

/** mean(with structure) − mean(counter-cycle), or null when either group is empty. */
export function groupGap(rows) {
  const w = rows.filter((x) => !x.counterCycle).map((x) => x.r);
  const c = rows.filter((x) => x.counterCycle).map((x) => x.r);
  return w.length && c.length ? mean(w) - mean(c) : null;
}

/** The gap in the earlier and the later half of the calls (by post time). */
export function halves(rows) {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
  const cut = Math.floor(sorted.length / 2);
  const part = (xs) => ({ n: xs.length, gap: groupGap(xs), from: xs[0]?.createdAt ?? null, to: xs[xs.length - 1]?.createdAt ?? null });
  return { first: part(sorted.slice(0, cut)), second: part(sorted.slice(cut)) };
}

/** The gap with each market left out in turn: no single market may carry the result. */
export function leaveOneMarketOut(rows) {
  const markets = [...new Set(rows.map((x) => x.market))].sort();
  return markets.map((m) => ({ market: m, left: rows.filter((x) => x.market === m).length, gap: groupGap(rows.filter((x) => x.market !== m)) }));
}

/** Smallest true gap this split detects 80% of the time at two-sided α = 0.05 (normal approx.). */
export function minDetectableGap(n1, n2, sd) {
  if (!(n1 > 0) || !(n2 > 0) || !(sd > 0)) return null;
  return (1.959964 + 0.841621) * sd * Math.sqrt(1 / n1 + 1 / n2);
}

const sameSign = (x, s) => x != null && s !== 0 && Math.sign(x) === s;

/**
 * Stage 1, exactly as registered. `rows` = classified calls {id, market, createdAt, r, counterCycle}.
 * A pass needs ALL of: n per group, |gap| ≥ minGapR, two-sided p ≤ alpha, the surviving group's
 * mean R above survivorMeanAbove, the same sign in both halves, and the same sign with any one
 * market left out. Anything short of that is NOT_SHOWN (or INSUFFICIENT on sample size).
 */
export function decideStage1(rows, T = PREREG.test) {
  const W = rows.filter((x) => !x.counterCycle), X = rows.filter((x) => x.counterCycle);
  const groups = { with: summarize(W), counter: summarize(X) };
  const sd = stdev(rows.map((x) => x.r));
  const power = { sd, minDetectableGapR: minDetectableGap(W.length, X.length, sd) };
  if (W.length < T.minPerGroup || X.length < T.minPerGroup) {
    return {
      verdict: VERDICTS.INSUFFICIENT,
      reasons: [`needs ≥${T.minPerGroup} calls per group; has ${W.length} with structure, ${X.length} counter-cycle`],
      groups, power, gap: groupGap(rows), p: null, checks: [], halves: halves(rows), leaveOneOut: [],
    };
  }
  const { gap, p } = permutationTest(W.map((x) => x.r), X.map((x) => x.r), { iters: T.permutations, seed: T.seed });
  const direction = gap >= T.minGapR ? VERDICTS.SILENCE_COUNTER_CYCLE : gap <= -T.minGapR ? VERDICTS.SILENCE_WITH_STRUCTURE : null;
  const survivor = direction === VERDICTS.SILENCE_COUNTER_CYCLE ? groups.with : direction === VERDICTS.SILENCE_WITH_STRUCTURE ? groups.counter : null;
  const hv = halves(rows);
  const lomo = leaveOneMarketOut(rows);
  const s = Math.sign(gap);
  const checks = [
    { name: "gap", pass: direction != null, detail: `|gap| ${Math.abs(gap).toFixed(3)}R, needs ≥ ${T.minGapR}R` },
    { name: "p", pass: p <= T.alpha, detail: `two-sided p ${p.toFixed(4)}, needs ≤ ${T.alpha}` },
    { name: "survivor", pass: survivor != null && survivor.meanR > T.survivorMeanAbove, detail: survivor ? `surviving group mean ${survivor.meanR.toFixed(3)}R, needs > ${T.survivorMeanAbove}R` : "no surviving group (gap below the bar)" },
    { name: "halves", pass: sameSign(hv.first.gap, s) && sameSign(hv.second.gap, s), detail: `gap by half: ${fmtR(hv.first.gap)} then ${fmtR(hv.second.gap)}` },
    { name: "leaveOneMarketOut", pass: lomo.every((x) => sameSign(x.gap, s)), detail: lomo.filter((x) => !sameSign(x.gap, s)).map((x) => `${x.market} out → ${fmtR(x.gap)}`).join(", ") || "same sign with every market left out" },
  ];
  const pass = checks.every((c) => c.pass);
  return {
    verdict: pass ? direction : VERDICTS.NOT_SHOWN,
    reasons: checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`),
    groups, power, gap, p, checks, halves: hv, leaveOneOut: lomo,
  };
}

/**
 * Stage 2 (confirmation on calls posted after the cutoff). Only a stage-1 pass can be confirmed:
 * same direction, |gap| ≥ minGapR, surviving group's mean above survivorMeanAbove.
 */
export function decideStage2(rows, stage1Verdict, S = PREREG.stage2) {
  const W = rows.filter((x) => !x.counterCycle), X = rows.filter((x) => x.counterCycle);
  const groups = { with: summarize(W), counter: summarize(X) };
  const gap = groupGap(rows);
  if (stage1Verdict !== VERDICTS.SILENCE_COUNTER_CYCLE && stage1Verdict !== VERDICTS.SILENCE_WITH_STRUCTURE) {
    return { verdict: "NOT_APPLICABLE", reasons: [`stage 1 read ${stage1Verdict}; there is nothing to confirm`], groups, gap };
  }
  if (W.length < S.minPerGroup || X.length < S.minPerGroup) {
    return { verdict: VERDICTS.INSUFFICIENT, reasons: [`needs ≥${S.minPerGroup} per group; has ${W.length} with structure, ${X.length} counter-cycle`], groups, gap };
  }
  const s = stage1Verdict === VERDICTS.SILENCE_COUNTER_CYCLE ? 1 : -1;
  const survivor = s === 1 ? groups.with : groups.counter;
  const reasons = [];
  if (!(s * gap >= S.minGapR)) reasons.push(`gap ${fmtR(gap)}, needs ${s === 1 ? "≥ +" : "≤ −"}${S.minGapR}R`);
  if (!(survivor.meanR > S.survivorMeanAbove)) reasons.push(`surviving group mean ${fmtR(survivor.meanR)}, needs > ${S.survivorMeanAbove}R`);
  return { verdict: reasons.length ? "NOT_CONFIRMED" : "CONFIRMED", reasons, groups, gap };
}

/** Canonical hash of a call set: sorted `id|symbol|direction|entryPrice|createdAt|gradedOutcome|gradedR` lines. */
export function populationHash(calls) {
  const lines = calls.map((c) => [c.id, c.symbol, c.direction, c.entryPrice, c.createdAt, c.gradedOutcome, c.gradedR].join("|")).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Is this record entry a graded house call, per the registered population rule? */
export function isGradedHouseCall(t, P = PREREG.population) {
  return !!t && t.source === P.source && String(t.id || "").startsWith(P.idPrefix) &&
    Number(t.gradeV) >= P.minGradeV && P.outcomes.includes(t.gradedOutcome) &&
    Number.isFinite(Number(t.gradedR)) && Number.isFinite(Number(t.createdAt)) && !t.duplicateOf;
}

/** The fields the study keeps from a call (the population file stores exactly these). */
export function pickCall(t) {
  return {
    id: t.id, symbol: t.symbol, direction: t.direction,
    entryPrice: t.entryPrice, stopLoss: t.stopLoss, takeProfit1: t.takeProfit1,
    createdAt: t.createdAt, gradedOutcome: t.gradedOutcome, gradedR: t.gradedR, gradeV: t.gradeV,
  };
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
export const fmtR = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`);
const fmtPct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

const VERDICT_LINE = {
  SILENCE_COUNTER_CYCLE: "PASSED stage 1: counter-cycle house fades did reliably worse. Nothing changes until stage 2 confirms on new calls.",
  SILENCE_WITH_STRUCTURE: "PASSED stage 1, the other way: fades WITH structure did reliably worse. Nothing changes until stage 2 confirms on new calls.",
  NOT_SHOWN: "NOT SHOWN. Structure does not gate the house caller.",
  INSUFFICIENT: "INSUFFICIENT. Too few calls in a group to test. Structure does not gate the house caller.",
  VOID: "VOID. Too many markets failed to load. Re-run; nothing was decided.",
};

export function renderMarkdown(rep) {
  const L = [];
  const s1 = rep.stage1;
  L.push(`## Structure × house fade · stage ${rep.stage} replay`);
  L.push("");
  L.push(`Registered ${PREREG.registered} · run ${rep.runAt} · commit ${rep.commit || "local"}`);
  L.push("");
  L.push(`**Stage 1: ${VERDICT_LINE[s1.verdict] || s1.verdict}**`);
  L.push("");
  if (s1.groups) {
    L.push("| group | calls | hit rate | mean R |");
    L.push("|---|---|---|---|");
    L.push(`| with structure | ${s1.groups.with.n} | ${fmtPct(s1.groups.with.hitRate)} | ${fmtR(s1.groups.with.meanR)} |`);
    L.push(`| counter-cycle | ${s1.groups.counter.n} | ${fmtPct(s1.groups.counter.hitRate)} | ${fmtR(s1.groups.counter.meanR)} |`);
    L.push("");
    L.push(`Gap (with − counter): ${fmtR(s1.gap)} · two-sided p ${s1.p == null ? "—" : s1.p.toFixed(4)} · bar: |gap| ≥ ${PREREG.test.minGapR}R and p ≤ ${PREREG.test.alpha}`);
    if (s1.power?.minDetectableGapR != null) L.push(`Power: this split sees a true gap of ${s1.power.minDetectableGapR.toFixed(2)}R or more 80% of the time. Smaller effects read as NOT SHOWN.`);
    L.push("");
  }
  if (s1.checks?.length) {
    L.push("Checks:");
    for (const c of s1.checks) L.push(`- ${c.pass ? "pass" : "FAIL"} · ${c.name}: ${c.detail}`);
    L.push("");
  } else if (s1.reasons?.length) {
    for (const r of s1.reasons) L.push(`- ${r}`);
    L.push("");
  }
  if (rep.stage2) {
    L.push(`**Stage 2: ${rep.stage2.verdict}**${rep.stage2.reasons?.length ? ` (${rep.stage2.reasons.join("; ")})` : ""}`);
    if (rep.stage2.groups) L.push(`With structure ${rep.stage2.groups.with.n} calls ${fmtR(rep.stage2.groups.with.meanR)} · counter-cycle ${rep.stage2.groups.counter.n} calls ${fmtR(rep.stage2.groups.counter.meanR)} · gap ${fmtR(rep.stage2.gap)}`);
    L.push("");
  }
  L.push("Population and data:");
  for (const [k, p] of Object.entries(rep.populations)) {
    L.push(`- ${k}: ${p.n} calls · sha256 ${p.sha256.slice(0, 16)}… · classified ${p.classified} · not classified ${p.unclassified}${p.byReason && Object.keys(p.byReason).length ? ` (${Object.entries(p.byReason).map(([r, n]) => `${r} ${n}`).join(", ")})` : ""}`);
  }
  const failed = rep.markets.filter((m) => m.error);
  L.push(`- markets: ${rep.markets.length} read from Orderly 4H${failed.length ? ` · failed: ${failed.map((m) => `${m.symbol} (${m.error})`).join(", ")}` : ", none failed"}`);
  const gappy = rep.markets.filter((m) => m.gaps > 0);
  if (gappy.length) L.push(`- missing 4H bars (left missing, never filled): ${gappy.map((m) => `${m.symbol} ${m.gaps}`).join(", ")}`);
  L.push("");
  if (s1.diagnostics) {
    const d = s1.diagnostics;
    L.push("Diagnostics (recorded, not decisive; no split below can pass this study):");
    for (const [k, g] of Object.entries(d.parts)) L.push(`- ${k}: ${g.n} calls · ${fmtPct(g.hitRate)} · ${fmtR(g.meanR)}`);
    for (const [k, g] of Object.entries(d.bySide)) L.push(`- ${k}: ${g.n} calls · ${fmtR(g.meanR)}`);
    L.push("");
  }
  L.push("Report only. Nothing live reads this: no card, no gate, no agent.");
  return L.join("\n");
}

/** Recorded-not-decisive breakdowns of the classified rows. */
export function diagnostics(rows) {
  const part = (f) => summarize(rows.filter(f));
  return {
    parts: {
      "against weekly only": part((x) => x.againstWeekly && !x.intoZone),
      "into a 4H level only": part((x) => x.intoZone && !x.againstWeekly),
      "both": part((x) => x.againstWeekly && x.intoZone),
      "neither (with structure)": part((x) => !x.againstWeekly && !x.intoZone),
    },
    bySide: {
      "LONG · with structure": part((x) => x.direction === "LONG" && !x.counterCycle),
      "LONG · counter-cycle": part((x) => x.direction === "LONG" && x.counterCycle),
      "SHORT · with structure": part((x) => x.direction === "SHORT" && !x.counterCycle),
      "SHORT · counter-cycle": part((x) => x.direction === "SHORT" && x.counterCycle),
    },
  };
}
