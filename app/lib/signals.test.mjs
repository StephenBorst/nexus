// The Signals bell, v2: every row with its grade. Run: node --test app/lib/signals.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSignals, countUnseen, readRows, readStageLine, NOT_GRADED } from "./signals.mjs";

const sig = (symbol, f) => ({ symbol, funding_rate_8h: f });
const NOW = Date.UTC(2026, 10, 14, 21, 0, 0);
const scorecard = {
  axes: [
    { name: "funding_fade", verdict: "NOISE", r: { samples: 3933 }, random: { pooled: { verdict: "BELOW_RANDOM" } } },
    { name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", verdict: "PREDICTIVE" },
    { name: "level_reclaim", label: "Prior-day high/low swept and reclaimed", verdict: "PREDICTIVE" },
  ],
  pipeline: { reads: [
    { axis: "oi_div_reversal_4h", stage: "PAPER", paperWallet: "0xd4", numbers: { events: 85, meanR: 0.31, beatsRandomPct: 99.2 } },
    { axis: "level_reclaim", stage: "REGISTERED", paperWallet: "0x95", numbers: { events: 96, meanR: 0.12, beatsRandomPct: 99 } },
    { axis: "session_momentum", stage: "RETIRED", paperWallet: "0x00", numbers: {} },
  ] },
};
const FADE_LINE = /^Nearest graded rule: the plain funding fade grades NOISE, worse than random entries \(3,933 samples\)\./;

test("every row carries a grade line; nothing claims an edge, a proof or an entry", () => {
  const out = buildSignals({
    signals: [sig("BTC", 0.0006), sig("SOL", -0.0005), { symbol: "ETH", funding_rate_8h: 0.0001, trend: "TREND_DOWN", trend_move_pct: -9.9, trend_oi_pct: 1.4, mark_price: 1800, ema8_4h: 1850 }],
    consensus: { BTC: { side: "SHORT" } },
    xrayEvents: [{ wallet: "0xAbC0000000000000000000000000000000000000", kind: "TIER_UP", toTier: "CONSISTENT", ts: NOW }],
    scorecard, now: NOW,
  });
  assert.ok(out.length >= 4);
  for (const r of out) {
    assert.ok(r.graded, `${r.kind} has a grade line`);
    assert.doesNotMatch(`${r.title} ${r.detail}`, /edge|proven|room to run|lower-risk|entries set up|where the information is|buy now|sell now/i, r.id);
  }
});

test("funding rows: inputs side by side, labelled with the plain fade's live grade", () => {
  const align = buildSignals({ signals: [sig("BTC", 0.0006)], consensus: { BTC: { side: "SHORT" } }, scorecard })[0];
  assert.equal(align.kind, "FADE_ALIGN");
  assert.equal(align.id, "fade-align-BTC-SHORT");
  assert.equal(align.title, "BTC: funding stretched, graded callers lean short");
  assert.match(align.detail, /Two inputs, not a verdict\./);
  assert.match(align.graded, FADE_LINE);
  const div = buildSignals({ signals: [sig("BTC", 0.0006)], consensus: { BTC: { side: "LONG" } }, scorecard })[0];
  assert.equal(div.kind, "DIVERGENCE");
  const plain = buildSignals({ signals: [sig("SOL", -0.0005)], consensus: null, scorecard })[0];
  assert.equal(plain.kind, "FUNDING");
  assert.match(plain.detail, /^Shorts pay 0\.050%\/8h: the crowd is heavily short\. The fade \(long\) is a mechanical rule\.$/);
  // scoreboard unread: say so, never invent a grade
  assert.match(buildSignals({ signals: [sig("SOL", -0.0005)] })[0].graded, /unread/);
});

test("momentum: facts only, not graded", () => {
  const m = buildSignals({ signals: [{ symbol: "ETH", trend: "TREND_UP", trend_move_pct: 6.2, trend_oi_pct: 2, mark_price: 1900, ema8_4h: 1880, funding_rate_8h: 0.0005 }] })[0];
  assert.equal(m.kind, "MOMENTUM");
  assert.equal(m.title, "ETH is trending up, open interest rising");
  assert.equal(m.detail, "+6.2% over the trend window, open interest +2%/hr. Price is 1.1% above its 4H EMA8 ($1,880). Funding already leans long (0.050%/8h).");
  assert.equal(m.graded, NOT_GRADED);
});

test("a registered read's paper trade leads the bell with its served stage and out-of-sample numbers", () => {
  const runs = {
    oi_div_reversal_4h: { ok: true, count: 3, target: 30, open: { coin: "ETH", side: "SHORT", openedAt: new Date(NOW - 2 * 3600e3).toISOString() }, trades: [] },
    level_reclaim: { ok: true, count: 8, target: 30, open: null, trades: [{ n: 8, coin: "BTC", side: "LONG", closedAt: new Date(NOW - 6 * 3600e3).toISOString(), outcome: "LOSS", r: -1.02 }] },
    session_momentum: { ok: true, count: 1, open: { coin: "X", side: "LONG", openedAt: new Date(NOW).toISOString() } },
  };
  const out = buildSignals({ signals: [sig("BTC", 0.0006)], scorecard, paperRuns: runs, now: NOW });
  assert.deepEqual(out.slice(0, 2).map((r) => r.kind), ["READ", "READ"], "graded reads outrank every ungraded row");
  assert.equal(out[0].title, "ETH: a registered read opened a paper short");
  assert.equal(out[0].detail, "Extreme 4h move on falling OI, faded. Opened 2h ago on its paper wallet; it closes on its own stop, target or clock.");
  assert.equal(out[0].graded, "Stage PAPER · 3 of 30 paper trades · out-of-sample 85 events, mean +0.31R, beats random 99%.");
  assert.equal(out[0].path, "/proof/paper/oi_div_reversal_4h");
  assert.equal(out[1].title, "BTC: a registered read closed a paper long (loss, −1.02R)");
  assert.ok(!out.some((r) => /session_momentum|X:/.test(r.id + r.title)), "a retired read never shows");
});

test("a paper trade closed more than a day ago is no longer news", () => {
  const runs = { level_reclaim: { ok: true, count: 8, open: null, trades: [{ n: 8, coin: "BTC", side: "LONG", closedAt: new Date(NOW - 30 * 3600e3).toISOString(), outcome: "LOSS", r: -1 }] } };
  assert.deepEqual(readRows(scorecard, runs, NOW), []);
  assert.equal(readStageLine({ stage: "REGISTERED", numbers: { events: 0 } }, null), "Stage REGISTERED · out-of-sample 0 events.");
});

test("ignores funding below the stretch threshold; tier ids are stable per day", () => {
  assert.deepEqual(buildSignals({ signals: [sig("BTC", 0.0001)] }), []);
  const ts = 1_700_000_000_000;
  const tier = buildSignals({ xrayEvents: [{ wallet: "0xAbC0000000000000000000000000000000000000", kind: "TIER_UP", toTier: "CONSISTENT", ts }] })[0];
  assert.equal(tier.id, `tier-0xabc0000000000000000000000000000000000000-CONSISTENT-${Math.floor(ts / 86400000)}`);
  assert.match(tier.graded, /X-Ray/);
});

test("countUnseen counts ids not yet seen", () => {
  assert.equal(countUnseen([{ id: "a" }, { id: "b" }], { a: 1 }), 1);
  assert.equal(countUnseen([{ id: "a" }], new Set(["a"])), 0);
});

test("the bell reads /intel/bell, says each row's grade, and keeps green/red for money", () => {
  const src = readFileSync(new URL("../components/SignalsNavButton.tsx", import.meta.url), "utf8");
  assert.match(src, /\/intel\/bell/);
  assert.match(src, /s\.graded/);
  assert.doesNotMatch(src, /live · public · graded/);
  assert.doesNotMatch(src, /#3ecf8e/, "no money green on a signal");
});
