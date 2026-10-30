import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSignal, oiSnapshotDue, signalSourceT } from "./logic.mjs";

// raw helper: funding in decimal, changes in decimal
const raw = (o) => ({ fundingRate: 0, priceChange: 0, oiChange: 0, hasPrev: true, ...o });

test("CONFLUENCE: both agree (funding SHORT + OI SHORT) → SHORT conf 80", () => {
  // funding +0.02% >= 0.01% → SHORT; price up + OI down → SHORT
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01 }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  assert.equal(s.direction, "SHORT");
  assert.equal(s.confidence, 80);
});

test("CONFLUENCE: signals conflict → NONE", () => {
  // funding SHORT, but price down + OI up → LONG
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: -0.01, oiChange: 0.01 }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  assert.equal(s.direction, "NONE");
});

test("CONFLUENCE: only funding fires → NONE (needs both)", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0, oiChange: 0 }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  assert.equal(s.direction, "NONE");
});

test("FUNDING_ONLY: funding fires alone → trades, conf 65", () => {
  const s = deriveSignal(raw({ fundingRate: -0.0002, priceChange: 0, oiChange: 0 }), { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01 });
  assert.equal(s.direction, "LONG"); // negative funding → LONG
  assert.equal(s.confidence, 65);
});

test("OI_ONLY: OI fires alone → trades; funding ignored", () => {
  const s = deriveSignal(raw({ fundingRate: 0, priceChange: 0.01, oiChange: 0.01 }), { signalMode: "OI_ONLY" });
  assert.equal(s.direction, "LONG"); // price up + OI up → follow → LONG
  assert.equal(s.confidence, 65);
});

test("MOMENTUM: price up over threshold → LONG (trade with the move)", () => {
  const s = deriveSignal(raw({ priceChange: 0.01 }), { signalMode: "MOMENTUM", priceChangeThreshold: 0.5 });
  assert.equal(s.direction, "LONG");
  assert.equal(s.confidence, 60);
});

test("MOMENTUM: price down over threshold → SHORT", () => {
  const s = deriveSignal(raw({ priceChange: -0.01 }), { signalMode: "MOMENTUM", priceChangeThreshold: 0.5 });
  assert.equal(s.direction, "SHORT");
});

test("MEAN_REVERSION: price up over threshold → SHORT (fade)", () => {
  const s = deriveSignal(raw({ priceChange: 0.01 }), { signalMode: "MEAN_REVERSION", priceChangeThreshold: 0.5 });
  assert.equal(s.direction, "SHORT");
  assert.equal(s.confidence, 60);
});

test("MOMENTUM/MEAN_REVERSION: move below threshold → NONE", () => {
  // 0.2% move < 0.5% threshold
  assert.equal(deriveSignal(raw({ priceChange: 0.002 }), { signalMode: "MOMENTUM", priceChangeThreshold: 0.5 }).direction, "NONE");
  assert.equal(deriveSignal(raw({ priceChange: 0.002 }), { signalMode: "MEAN_REVERSION", priceChangeThreshold: 0.5 }).direction, "NONE");
});

test("MOMENTUM: no prior snapshot → NONE", () => {
  assert.equal(deriveSignal(raw({ priceChange: 0.01, hasPrev: false }), { signalMode: "MOMENTUM", priceChangeThreshold: 0.5 }).direction, "NONE");
});

test("fundingThreshold respected: below threshold → no funding signal", () => {
  // funding 0.005% < 0.01% threshold
  const s = deriveSignal(raw({ fundingRate: 0.00005, priceChange: 0.01, oiChange: -0.01 }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  assert.equal(s.direction, "NONE"); // funding doesn't fire → no confluence
});

test("oiChangeThreshold respected: tiny OI move ignored", () => {
  // oiChange 0.05% < 0.1% threshold → OI signal suppressed
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: 0.0005 }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01, oiChangeThreshold: 0.1 });
  assert.equal(s.direction, "NONE");
});

test("no prior snapshot (hasPrev false) → OI signal can't fire", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01, hasPrev: false }), { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  assert.equal(s.direction, "NONE");
});

test("default config = CONFLUENCE behavior", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01 }), {});
  assert.equal(s.direction, "SHORT");
  assert.equal(s.confidence, 80);
});

// ── Regime filter (opt-in) ──────────────────────────────────
import { computeRegime } from "./logic.mjs";

const mkRows = (n, upFrac, btcChg, fundPosFrac) =>
  Array.from({ length: n }, (_, i) => ({
    symbol: i === 0 ? "PERP_BTC_USDC" : `PERP_X${i}_USDC`,
    "24h_open": "100",
    "24h_close": String(i === 0 ? 100 + btcChg : (i / n < upFrac ? 101 : 99)),
    last_funding_rate: i / n < fundPosFrac ? "0.0001" : "-0.0001",
  }));

test("computeRegime: broad strength → RISK_ON", () => {
  const r = computeRegime(mkRows(20, 0.95, 5, 0.5));
  assert.equal(r.label, "RISK_ON");
  assert.ok(r.score >= 60);
});

test("computeRegime: broad weakness → RISK_OFF", () => {
  const r = computeRegime(mkRows(20, 0.1, -5, 0.5));
  assert.equal(r.label, "RISK_OFF");
  assert.ok(r.score < 42);
});

test("computeRegime: empty → null", () => {
  assert.equal(computeRegime([]), null);
});

test("respectRegime OFF: regime never gates (back-compat)", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01 }), { signalMode: "CONFLUENCE" }, { label: "RISK_ON", score: 80 });
  assert.equal(s.direction, "SHORT"); // not gated because respectRegime is absent
});

test("respectRegime ON: SHORT gated in RISK_ON", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01 }), { signalMode: "CONFLUENCE", respectRegime: true }, { label: "RISK_ON", score: 80 });
  assert.equal(s.direction, "NONE");
  assert.match(s.reason, /regime-gated/);
});

test("respectRegime ON: LONG gated in RISK_OFF", () => {
  // funding -0.02% → LONG; price down + OI up → LONG (confluence LONG)
  const s = deriveSignal(raw({ fundingRate: -0.0002, priceChange: -0.01, oiChange: 0.01 }), { signalMode: "CONFLUENCE", respectRegime: true }, { label: "RISK_OFF", score: 20 });
  assert.equal(s.direction, "NONE");
});

test("respectRegime ON: aligned trade passes (LONG in RISK_ON)", () => {
  const s = deriveSignal(raw({ fundingRate: -0.0002, priceChange: -0.01, oiChange: 0.01 }), { signalMode: "CONFLUENCE", respectRegime: true }, { label: "RISK_ON", score: 80 });
  assert.equal(s.direction, "LONG"); // aligned with tape → allowed
});

test("respectRegime ON: NEUTRAL never gates", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01 }), { signalMode: "CONFLUENCE", respectRegime: true }, { label: "NEUTRAL", score: 50 });
  assert.equal(s.direction, "SHORT");
});

// ── funding-percentile gate (opt-in) ──────────────────────────
test("fundingPercentileMin: FUNDING_ONLY SHORT suppressed when not extreme enough", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, fundingPercentileMin: 90 };
  // funding fires SHORT but pct 70 < 90 → suppressed
  const s = deriveSignal(raw({ fundingRate: 0.0002, fundingPct: 70 }), cfg);
  assert.equal(s.direction, "NONE");
});
test("fundingPercentileMin: SHORT passes when funding is extreme (pct >= min)", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, fundingPercentileMin: 90 };
  const s = deriveSignal(raw({ fundingRate: 0.0002, fundingPct: 95 }), cfg);
  assert.equal(s.direction, "SHORT");
});
test("fundingPercentileMin: LONG needs pct <= (100-min) (crowded shorts)", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, fundingPercentileMin: 90 };
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, fundingPct: 30 }), cfg).direction, "NONE"); // 30 > 10
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, fundingPct: 5 }), cfg).direction, "LONG");  // 5 <= 10
});
test("fundingPercentileMin: off (0/unset) or no pct → unchanged behavior", () => {
  assert.equal(deriveSignal(raw({ fundingRate: 0.0002, fundingPct: 10 }), { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01 }).direction, "SHORT");
  assert.equal(deriveSignal(raw({ fundingRate: 0.0002 }), { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, fundingPercentileMin: 90 }).direction, "SHORT"); // no pct → skip gate
});

// ── Smart-money gate (respectSmartMoney) ──────────────────────────────────────
test("smart-money gate: entry fighting strong consensus → NONE", () => {
  // FUNDING_ONLY wants SHORT; smart money strongly LONG (5 traders) → gated.
  const s = deriveSignal(
    raw({ fundingRate: 0.0002 }),
    { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, respectSmartMoney: true },
    null,
    { side: "LONG", count: 5 },
  );
  assert.equal(s.direction, "NONE");
  assert.match(s.reason, /smart-money-gated/);
});

test("smart-money gate: aligned consensus does NOT gate", () => {
  const s = deriveSignal(
    raw({ fundingRate: 0.0002 }),
    { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, respectSmartMoney: true },
    null,
    { side: "SHORT", count: 5 },
  );
  assert.equal(s.direction, "SHORT");
});

test("smart-money gate: weak consensus (<3) does NOT gate", () => {
  const s = deriveSignal(
    raw({ fundingRate: 0.0002 }),
    { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, respectSmartMoney: true },
    null,
    { side: "LONG", count: 2 },
  );
  assert.equal(s.direction, "SHORT");
});

test("smart-money gate: off by default (no opt-in) → not gated", () => {
  const s = deriveSignal(raw({ fundingRate: 0.0002 }), { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01 }, null, { side: "LONG", count: 9 });
  assert.equal(s.direction, "SHORT");
});

// ── EXTERNAL (Arena / bring-your-own-brain) — the house brain must stay silent ──
test("EXTERNAL: never emits a signal, even on a screaming confluence setup", () => {
  const s = deriveSignal(
    { fundingRate: 0.0005, priceChange: 0.02, oiChange: -0.05, hasPrev: true },
    { signalMode: "EXTERNAL", fundingThreshold: 0.01 }
  );
  assert.equal(s.direction, "NONE");
});

test("EXTERNAL: does not fall through to the CONFLUENCE default", () => {
  // The exact raw that fires CONFLUENCE must NOT fire under EXTERNAL.
  const raw = { fundingRate: 0.0002, priceChange: 0.01, oiChange: -0.01, hasPrev: true };
  const confluence = deriveSignal(raw, { signalMode: "CONFLUENCE", fundingThreshold: 0.01 });
  const external = deriveSignal(raw, { signalMode: "EXTERNAL", fundingThreshold: 0.01 });
  assert.notEqual(confluence.direction, "NONE", "sanity: this raw fires confluence");
  assert.equal(external.direction, "NONE");
});

// ── opt-in regime conditioning (session + volatility gates) ─────────────────
test("session gate: entry suppressed outside tradeSessions", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, tradeSessions: ["US", "EUROPE"] };
  // hourUtc 3 = ASIA → gated
  const asia = deriveSignal(raw({ fundingRate: -0.0002, hourUtc: 3 }), cfg);
  assert.equal(asia.direction, "NONE");
  assert.match(asia.reason, /session-gated/);
  // hourUtc 18 = US → allowed
  const us = deriveSignal(raw({ fundingRate: -0.0002, hourUtc: 18 }), cfg);
  assert.equal(us.direction, "LONG");
});

test("session gate: no-op when tradeSessions unset or hourUtc absent", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01 };
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, hourUtc: 3 }), cfg).direction, "LONG");
  const cfg2 = { ...cfg, tradeSessions: ["US"] };
  // hourUtc missing → cannot gate, so it trades (fail-open, matches other opt-in gates)
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002 }), cfg2).direction, "LONG");
});

test("volatility gate: min suppresses calm, max suppresses hot", () => {
  const base = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01 };
  // minVolAtrPct 0.7 → atr 0.4 gated, atr 0.9 allowed
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 0.4 }), { ...base, minVolAtrPct: 0.7 }).direction, "NONE");
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 0.9 }), { ...base, minVolAtrPct: 0.7 }).direction, "LONG");
  // maxVolAtrPct 0.5 → atr 0.9 gated, atr 0.3 allowed
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 0.9 }), { ...base, maxVolAtrPct: 0.5 }).direction, "NONE");
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 0.3 }), { ...base, maxVolAtrPct: 0.5 }).direction, "LONG");
});

test("regime gates apply BEFORE invert (suppress the faded entry too)", () => {
  const cfg = { signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, invertSignal: true, minVolAtrPct: 0.7 };
  // calm → gated even though invert would otherwise flip it
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 0.3 }), cfg).direction, "NONE");
  // high vol → fires and inverts (funding LONG → SHORT)
  assert.equal(deriveSignal(raw({ fundingRate: -0.0002, atrPct: 1.0 }), cfg).direction, "SHORT");
});

// ── atrPct helper (shared with the live brain's vol gate) ───────────────────
import { atrPct } from "./logic.mjs";
test("atrPct: computes ATR as % of last close", () => {
  // 5 flat-ish bars then a wide one; TR avg / last close.
  const c = [
    { o: 100, h: 101, l: 99, c: 100 },
    { o: 100, h: 102, l: 99, c: 101 },
    { o: 101, h: 103, l: 100, c: 102 },
    { o: 102, h: 104, l: 101, c: 103 },
    { o: 103, h: 110, l: 102, c: 108 }, // wide bar
  ];
  const a = atrPct(c);
  assert.ok(a > 0 && a < 20, `atr% in a sane range: ${a}`);
});
test("atrPct: null on too little history", () => {
  assert.equal(atrPct([{ o: 1, h: 1, l: 1, c: 1 }]), null);
  assert.equal(atrPct(null), null);
});

// ── BASIS_FADE — the scoreboard's PREDICTIVE read, traded ────────────────────
// The verdict comes from the SHARED rule in app/lib/basisFade.mjs (the same code
// axisbt grades with). deriveSignal only routes it — so these pin the routing, and
// above all that a missing basis NEVER silently falls through to funding/OI.
test("BASIS_FADE: routes the shared rule's verdict", () => {
  const s = deriveSignal({ basisSide: "SHORT", basisPct: 0.9, basisThr: 0.1, hasPrev: true }, { signalMode: "BASIS_FADE" });
  assert.equal(s.direction, "SHORT");
  assert.equal(s.confidence, 70);
  const l = deriveSignal({ basisSide: "LONG", basisPct: -0.9, basisThr: 0.1, hasPrev: true }, { signalMode: "BASIS_FADE" });
  assert.equal(l.direction, "LONG");
});

test("BASIS_FADE: no basis ⇒ NO signal, never a proxy through funding/OI", () => {
  // Funding is extreme AND OI diverges — CONFLUENCE would fire here. BASIS_FADE must not.
  const raw = { fundingRate: 0.05, priceChange: 0.02, oiChange: -0.05, hasPrev: true };
  assert.equal(deriveSignal(raw, { signalMode: "BASIS_FADE" }).direction, "NONE");
  assert.equal(deriveSignal({ ...raw, basisSide: null }, { signalMode: "BASIS_FADE" }).direction, "NONE");
  // and the same raw DOES fire confluence — proving the inputs were live, not empty.
  assert.notEqual(deriveSignal(raw, { signalMode: "CONFLUENCE" }).direction, "NONE");
});

test("BASIS_FADE: ignores a malformed side rather than trusting it", () => {
  for (const bad of ["BUY", "", 1, {}, undefined]) {
    assert.equal(deriveSignal({ basisSide: bad, hasPrev: true }, { signalMode: "BASIS_FADE" }).direction, "NONE");
  }
});

test("BASIS_FADE: a quiet tick explains itself", () => {
  const r = deriveSignal({ basisSide: null, basisReason: "accruing (12/48h)", hasPrev: true }, { signalMode: "BASIS_FADE" });
  assert.equal(r.direction, "NONE");
  assert.equal(r.reason, "accruing (12/48h)", "'no signal' can't distinguish not-wired from correctly-quiet");
  assert.equal(deriveSignal({ hasPrev: true }, { signalMode: "BASIS_FADE" }).reason, "no signal");
});

// ── oiSnapshotDue — one row per hour, written at the top of the hour (2026-10-30) ──
const HR = 3600000;
const at = (iso) => Date.parse(iso);
test("oiSnapshotDue: nothing recorded yet ⇒ due (in the first half-hour)", () => {
  assert.equal(oiSnapshotDue([], at("2026-10-28T21:02:00Z")), true);
  assert.equal(oiSnapshotDue(null, at("2026-10-28T21:02:00Z")), true);
  assert.equal(oiSnapshotDue([{ t: "nope" }], at("2026-10-28T21:02:00Z")), true, "unusable stamp ⇒ record rather than skip");
});

test("oiSnapshotDue: the hour already has its row ⇒ skip (no network call)", () => {
  assert.equal(oiSnapshotDue([{ t: at("2026-10-28T21:02:00Z") }], at("2026-10-28T21:07:00Z")), false);
  // The Oct 28 rewrite: a 20:30:05 row already sits in bucket 21, so 21:25 writes nothing.
  assert.equal(oiSnapshotDue([{ t: at("2026-10-28T20:30:05Z") }], at("2026-10-28T21:25:00Z")), false);
});

test("oiSnapshotDue: a new hour ⇒ due on its first tick; never in the second half-hour", () => {
  assert.equal(oiSnapshotDue([{ t: at("2026-10-28T20:02:00Z") }], at("2026-10-28T21:02:00Z")), true);
  assert.equal(oiSnapshotDue([{ t: at("2026-10-28T18:02:00Z") }], at("2026-10-28T21:35:00Z")), false,
    "back from an outage at :35: wait for 22:00, a row now would round into bucket 22");
  assert.equal(oiSnapshotDue([{ t: at("2026-10-28T18:02:00Z") }], at("2026-10-28T22:00:00Z")), true);
});

test("oiSnapshotDue: 5-min ticks over a day write exactly one row per hour, at the top of the hour", () => {
  const hist = [];
  const t0 = at("2026-10-28T00:02:00Z");
  for (let now = t0; now < t0 + 24 * HR; now += 5 * 60000) if (oiSnapshotDue(hist, now)) hist.push({ t: now });
  assert.equal(hist.length, 24);
  const buckets = hist.map((r) => Math.round(r.t / HR));
  for (let i = 1; i < buckets.length; i++) assert.equal(buckets[i], buckets[i - 1] + 1, "one per bucket, none skipped");
  for (const r of hist) assert.equal(new Date(r.t).getUTCMinutes(), 2, "written before the :17 reads it prices");
});

test("oiSnapshotDue: reads the LAST row, not the first", () => {
  const now = at("2026-10-28T21:10:00Z");
  const hist = [{ t: now - 10 * HR }, { t: at("2026-10-28T21:02:00Z") }];
  assert.equal(oiSnapshotDue(hist, now), false, "an old first row must not force a re-record");
});

test("signalSourceT: the basis row's time for BASIS_FADE, null otherwise", () => {
  const raw = { basisT: 1793305055105, basisDevT: 1793305055999 };
  assert.equal(signalSourceT(raw, { signalMode: "BASIS_FADE" }), 1793305055105);
  assert.equal(signalSourceT(raw, { signalMode: "BASIS_FADE", basisAnchor: "MEAN" }), 1793305055999);
  assert.equal(signalSourceT(raw, { signalMode: "FUNDING_ONLY" }), null);
  assert.equal(signalSourceT({}, { signalMode: "BASIS_FADE" }), null);
  assert.equal(signalSourceT(null, { signalMode: "BASIS_FADE" }), null);
});
