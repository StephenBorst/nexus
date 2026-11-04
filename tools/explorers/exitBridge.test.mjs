// The exit bridge (docs/research/level-reclaim-exit-gap.md): the steps add up, each hypothesis
// moves only its own step, the cause rule follows the signed page, and on a synthetic tape the
// bridge's last step equals what the scoreboard's own code serves for the same population.
// No network: synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bridge, causes, bridgeRows, oosEvents, servedEquivalent, panels, MAIN_COINS, FEE_PER_TRADE_BPS } from "./exitBridge.mjs";

// The page as signed on 2026-10-31 (#204): everything above "## Results". Results are appended,
// never an edit above them.
const DOC = readFileSync(new URL("../../docs/research/level-reclaim-exit-gap.md", import.meta.url), "utf8");
const SIGNED_PREFIX_SHA256 = "5a8beee7f77387fb508d0da890288b3f8b0d86e9df621cc97f30e9df5718043b";

test("the page above Results is exactly as signed", () => {
  const cut = DOC.indexOf("\n## Results");
  assert.ok(cut > 0, "the Results heading is missing");
  assert.equal(createHash("sha256").update(DOC.slice(0, cut)).digest("hex"), SIGNED_PREFIX_SHA256);
});

const row = (o) => ({ coin: "X", t: 0, side: "LONG", reason: "SL", holdH: 10, stopBps: 200, r: -1, grossBps: -200, ...o, netBps: (o.grossBps ?? -200) - FEE_PER_TRADE_BPS });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("the fee is the graded exit's own round trip (3 bps a side)", () => {
  assert.equal(FEE_PER_TRADE_BPS, 6);
});

test("main card leaves the holdout coins out, as the scoreboard's out-of-sample grade does", () => {
  assert.ok(!MAIN_COINS.includes("SUI"));
  assert.ok(MAIN_COINS.includes("BTC"));
});

test("the steps add up exactly to S4 − S0", () => {
  const ev = [{ side: "LONG", r: 1.5 }, { side: "LONG", r: -1 }, { side: "SHORT", r: 0 }, { side: "SHORT", r: 1.5 }];
  const tr = [
    row({ r: 1.5, reason: "TP", stopBps: 100, grossBps: 150 }),
    row({ r: -1, reason: "SL", stopBps: 400, grossBps: -400 }),
    row({ r: 0, reason: "TIMEOUT", stopBps: 200, grossBps: -90 }),
  ];
  const b = bridge(ev, tr);
  const sum = Object.values(b.steps).reduce((s, x) => s + x, 0);
  close(sum, b.S.S4 - b.S.S0);
  close(b.move, b.S.S4 - b.S.S0);
  close(b.steps.H1, -6);
  close(b.steps.S3b, 0); // the two walkers agree on every touched trade here
});

test("H2 is the covariance of R with stop width, exactly", () => {
  const tr = [row({ r: 1.5, stopBps: 100, grossBps: 150, reason: "TP" }), row({ r: -1, stopBps: 500, grossBps: -500 })];
  const b = bridge([{ side: "LONG", r: 0.25 }], tr);
  const rs = [1.5, -1], ss = [100, 500];
  const mr = (rs[0] + rs[1]) / 2, ms = (ss[0] + ss[1]) / 2;
  const cov = ((rs[0] - mr) * (ss[0] - ms) + (rs[1] - mr) * (ss[1] - ms)) / 2;
  close(b.steps.H2, cov);
  assert.ok(b.R1 > 0 && b.S.S2 < 0, "positive in R, negative in bps: the weighting case");
});

test("equal stops: no weighting step; untouched trades closing red show up only as H3", () => {
  const tr = [row({ r: 1.5, reason: "TP", grossBps: 300 }), row({ r: 0, reason: "TIMEOUT", grossBps: -150 }), row({ r: 0, reason: "TIMEOUT", grossBps: -150 })];
  const b = bridge([{ side: "LONG", r: 1.5 }, { side: "LONG", r: 0 }, { side: "LONG", r: 0 }], tr);
  close(b.steps.H4, 0);
  close(b.steps.H2, 0);
  close(b.steps.H3, -100);
  close(b.alone.H3, -100);
  assert.equal(b.untouched, 2);
});

test("a different traded population shows up only as H4", () => {
  const tr = [row({ r: -1, grossBps: -200 })];
  const b = bridge([{ side: "LONG", r: 1.5 }, { side: "LONG", r: 1.5 }, { side: "LONG", r: -1 }], tr);
  close(b.steps.H4, (-1 - (2 / 3)) * 200);
  close(b.steps.H2, 0);
  close(b.steps.H3, 0);
});

test("a trade the two walkers disagree on lands in S3b, never in a hypothesis", () => {
  const b = bridge([{ side: "LONG", r: -1 }], [row({ r: -1, reason: "SL", grossBps: -260 })]);
  close(b.steps.S3b, -60);
  close(b.steps.H3, 0);
});

test("causes: nothing is named under 30 trades (the first pull is descriptive)", () => {
  const tr = Array.from({ length: 24 }, () => row({ r: 0, reason: "TIMEOUT", grossBps: -100 }));
  const ev = tr.map(() => ({ side: "LONG", r: 0.3 }));
  const c = causes(ev, tr, bridge(ev, tr));
  assert.equal(c.named, false);
});

test("causes at 30+: a step counts if ≥ a third of the move, same sign, and it survives dropping the biggest trade", () => {
  const tr = Array.from({ length: 30 }, (_, i) => row({ t: i, r: 0, reason: "TIMEOUT", grossBps: -100 }));
  const ev = tr.map(() => ({ side: "LONG", r: 0 }));
  const b = bridge(ev, tr);
  const c = causes(ev, tr, b);
  assert.equal(c.named, true);
  assert.deepEqual(c.causes, ["H3"]); // −100 of a −106 move; fees (−6) are under a third
});

test("causes: a step carried by one huge trade does not count", () => {
  // 29 flat untouched trades and one that timed out −3000 bps: H3 is all one trade.
  const tr = Array.from({ length: 30 }, (_, i) => row({ t: i, r: 0, reason: "TIMEOUT", grossBps: i === 0 ? -3000 : 0 }));
  const ev = tr.map(() => ({ side: "LONG", r: 0 }));
  const c = causes(ev, tr, bridge(ev, tr));
  assert.equal(c.named, true);
  assert.ok(!c.causes.includes("H3"), "dropping the one trade leaves H3 at 0");
});

test("panels: exit mix, stop-width halves and holds are descriptive counts", () => {
  const tr = [row({ reason: "TP", r: 1.5, grossBps: 150, stopBps: 100, holdH: 5 }), row({ reason: "SL", stopBps: 400, grossBps: -400, holdH: 20 }), row({ reason: "TIMEOUT", r: 0, grossBps: 10, holdH: 168 })];
  const p = panels(tr);
  assert.equal(p.exits.TP.n, 1);
  assert.equal(p.exits.TIMEOUT.n, 1);
  assert.equal(p.stopWidth.narrow.n + p.stopWidth.wide.n, 3);
  assert.equal(p.hold.timeouts.avgHoldH, 168);
});

// ── Parity with the scoreboard's own code on a synthetic tape ───────────────────────────────────
function tape(coin, seed, hours, t0) {
  let s = seed, px = 100;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const oiHist = [], candleHist = [];
  for (let i = 0; i < hours; i++) {
    const t = t0 + i * 3600e3;
    const o = px;
    px = Math.max(1, px * (1 + (rnd() - 0.5) * 0.02));
    const h = Math.max(o, px) * (1 + rnd() * 0.004), l = Math.min(o, px) * (1 - rnd() * 0.004);
    candleHist.push({ t, o, h, l, c: px, v: 1000 });
    oiHist.push({ t: t + 120e3, price: o, oi: 1e6, funding: (rnd() - 0.5) * 2e-4 });
  }
  return { coin, oiHist, candleHist };
}
// A stand-in gen: fires every 23h, alternating sides. The bridge doesn't care what the rule is.
const everyN = (cs) => cs.candleHist.filter((_, i) => i > 100 && i % 23 === 0).map((c, k) => ({ t: c.t, side: k % 2 ? "SHORT" : "LONG" }));

test("on the same population, the bridge's S4 and T equal the scoreboard's graded exit", () => {
  const t0 = Date.UTC(2026, 8, 1);
  const sets = [tape("AAA", 7, 1400, t0), tape("BBB", 11, 1400, t0), tape("CCC", 19, 1400, t0)];
  const fromMs = t0 + 300 * 3600e3;
  const events = oosEvents(sets, everyN, fromMs);
  const { eventR, trades } = bridgeRows(events);
  const b = bridge(eventR, trades);
  const served = servedEquivalent(sets, everyN, fromMs);
  assert.ok(trades.length >= 20, `enough trades to mean something (${trades.length})`);
  assert.equal(trades.length, served.exitTrades);
  assert.equal(eventR.length, served.events);
  assert.ok(Math.abs(b.S.S4 - served.exitNetBps) <= 0.06, `S4 ${b.S.S4} vs served ${served.exitNetBps}`);
  assert.ok(Math.abs(b.R0 - served.meanR) <= 0.005, `R0 ${b.R0} vs served ${served.meanR}`);
  assert.equal(b.rMissing, 0);
  // since the fill-price fix (2026-10-31) the two walkers agree on touched trades; what's left is
  // the graded exit's stop rounded to 0.001%
  assert.ok(Math.abs(b.steps.S3b) < 0.05, `S3b ${b.steps.S3b}`);
});

// What S3b found on its first run (2026-10-31): the as-traded walker filled an exit at the hour's
// EXTREME while the R grade books the levels. Fixed the same day as a measurement change (stepExit
// fills at the level, backtest.fill.test.mjs): a deep-wick stop now fills at the stop, and S3b is 0.
test("S3b: a stop that triggers on a deep wick fills at the stop, so the walkers agree", () => {
  const t0 = Date.UTC(2026, 9, 1), H = 3600e3;
  const candleHist = [], oiHist = [];
  for (let i = 0; i < 300; i++) {
    const t = t0 + i * H;
    const c = i === 101 ? { o: 100, h: 100.2, l: 90, c: 99 } : { o: 100, h: 100.5, l: 99.5, c: 100 };
    candleHist.push({ t, ...c, v: 1 });
    oiHist.push({ t: t + 120e3, price: 100, oi: 1, funding: 0 });
  }
  const sets = [{ coin: "WICK", oiHist, candleHist }];
  const gen = () => [{ t: t0 + 100 * H, side: "LONG" }];
  const { trades } = bridgeRows(oosEvents(sets, gen, t0));
  assert.equal(trades.length, 1);
  const [x] = trades;
  assert.equal(x.reason, "SL");
  assert.equal(x.r, -1);
  close(x.grossBps, -x.stopBps, 1e-6);
  const b = bridge([{ side: "LONG", r: -1 }], trades);
  close(b.steps.S3b, 0, 1e-6);
});
