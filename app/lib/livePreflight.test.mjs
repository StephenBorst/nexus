// Run: node --test app/lib/livePreflight.test.mjs
// The $10 live mechanics test's preflight (livePreflight.mjs): every line from the record, nothing guessed.
import test from "node:test";
import assert from "node:assert/strict";
import { preflight, expectedBackstop, triggerFits, BACKSTOP_MULT, EXEC_STALE_MS } from "./livePreflight.mjs";
import { BACKSTOP_MULT as EXEC_MULT, backstopTrigger } from "../../workers/nexus-agent-exec/backstop.mjs";
import { liveKey } from "./paperTape.mjs";

const W = "0x" + "ab".repeat(20);
const NOW = Date.UTC(2026, 10, 14, 12);
const LIVE = { mode: "AUTONOMOUS", signalMode: "CONFLUENCE", symbols: ["PERP_ETH_USDC"] };
const base = (over = {}) => ({ wallet: W, config: LIVE, state: {}, haltRaw: null, liftVar: "", killRaw: null, hasKey: true, heartbeatMs: NOW - 30_000, nowMs: NOW, ...over });
const line = (r, id) => r.checks.find((c) => c.id === id);
const pos = (over = {}) => ({ symbol: "PERP_ETH_USDC", direction: "LONG", entry_price: 3000, slPercent: 2, paper: false, ...over });

test("the multiplier is exec's own, and a snapped trigger from exec fits", () => {
  assert.equal(BACKSTOP_MULT, EXEC_MULT);
  for (const p of [pos(), pos({ direction: "SHORT" }), pos({ entry_price: 0.28888, slPercent: 4.4 })]) {
    const t = backstopTrigger({ direction: p.direction, entryPrice: p.entry_price, slPercent: p.slPercent, quoteTick: p.entry_price < 1 ? 0.00001 : 0.01 });
    assert.ok(triggerFits(p, t), `${p.direction} ${p.entry_price}`);
  }
  assert.equal(expectedBackstop(pos()), 2910);
  assert.equal(triggerFits(pos(), 2940), false, "tighter than 1.5x");
  assert.equal(triggerFits(pos(), 2800), false, "far past it");
});

test("ready for the entry: worker ticking, pause off, no kill, live agent, key stored; backstop waits", () => {
  const r = preflight(base());
  assert.equal(r.ready, true);
  assert.equal(r.step, "ENTRY");
  assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [
    ["exec", "PASS"], ["halt", "PASS"], ["kill", "PASS"], ["config", "PASS"], ["key", "PASS"], ["lift", "INFO"], ["backstop", "WAIT"], ["cleanup", "PASS"],
  ]);
  assert.match(line(r, "lift").line, /Not needed for the \$10 test/);
});

test("each blocker is a FAIL that says what to do", () => {
  const cases = [
    [{ heartbeatMs: NOW - EXEC_STALE_MS - 1 }, "exec", /ticked 3 min ago/],
    [{ heartbeatMs: null }, "exec", /heartbeat unread/],
    [{ haltRaw: JSON.stringify({ at: 1, reason: "weekend" }) }, "halt", /paused platform-wide \(“weekend”\)/],
    [{ haltRaw: "garbage" }, "halt", /paused/],
    [{ killRaw: "1" }, "kill", /kill is pending/],
    [{ config: null }, "config", /No agent/],
    [{ config: { ...LIVE, mode: "PAPER" } }, "config", /on PAPER/],
    [{ hasKey: false }, "key", /No trading key/],
    [{ state: { backstop_cleanup: [{ id: 1, symbol: "PERP_SOL_USDC" }] } }, "cleanup", /1 backstop cancel still queued \(SOL\)/],
  ];
  for (const [over, id, re] of cases) {
    const r = preflight(base(over));
    assert.equal(line(r, id).status, "FAIL", id);
    assert.match(line(r, id).line, re);
    assert.equal(r.ready, false, id);
  }
});

test("the lift: a graded-exit live config needs the wallet listed and the plan's config, else every entry is refused", () => {
  const graded = { mode: "AUTONOMOUS", signalMode: "LEVEL_RECLAIM", exitContract: "R_CONTRACT", riskPerTradeUsd: 10, leverage: 3, capitalPerTrade: 300,
    maxDailyLossUsdc: 30, maxTradesPerDay: 4, maxHoldHours: 168, symbols: ["PERP_ETH_USDC"] };
  assert.equal(line(preflight(base({ config: graded })), "lift").status, "FAIL", "not listed (disarmed)");
  assert.equal(line(preflight(base({ config: graded, liftVar: `${W}@LEVEL_RECLAIM` })), "lift").status, "PASS");
  const off = line(preflight(base({ config: { ...graded, leverage: 5 }, liftVar: `${W}@LEVEL_RECLAIM` })), "lift");
  assert.equal(off.status, "FAIL");
  assert.match(off.line, /isn’t the plan’s: leverage is capped at 3x/);
  assert.match(line(preflight(base({ liftVar: `${W}@LEVEL_RECLAIM` })), "lift").line, /Listed .* Not used by this config/);
});

test("the backstop: PASS on exec's own at 1.5x, FAIL when missing or off, INFO when the slot is the owner's or DCA", () => {
  const t = backstopTrigger({ direction: "LONG", entryPrice: 3000, slPercent: 2, quoteTick: 0.01 });
  const ok = preflight(base({ state: { current_position: pos({ backstop: { id: 77, trigger: t } }) } }));
  assert.equal(line(ok, "backstop").status, "PASS");
  assert.equal(line(ok, "backstop").orderId, "77");
  assert.match(line(ok, "backstop").line, /Orders → TP\/SL/);
  assert.equal(ok.step, "KILL");
  assert.match(ok.next, /Tap KILL/);
  assert.equal(line(preflight(base({ state: { current_position: pos() } })), "backstop").status, "FAIL");
  assert.equal(line(preflight(base({ state: { current_position: pos({ backstop: { id: 1, trigger: 2950 } }) } })), "backstop").status, "FAIL");
  assert.equal(line(preflight(base({ state: { current_position: pos({ backstop: { id: 1, trigger: 2900, foreign: true } }) } })), "backstop").status, "INFO");
  assert.equal(line(preflight(base({ state: { current_position: pos({ dca: {} }) } })), "backstop").status, "INFO");
  assert.equal(line(preflight(base({ state: { current_position: pos({ paper: true }) } })), "backstop").status, "WAIT", "a paper position isn't live");
});

test("after the test: live fills on the tape (an OFF one is a FAIL), slippage as context", () => {
  const slip = [{ t: NOW - 3_600_000, symbol: "PERP_ETH_USDC", kind: "entry", side: "BUY", mark: 3000, fill: 3000.6, bps: 2, order_id: "9" },
    { t: NOW - 1_800_000, symbol: "PERP_ETH_USDC", kind: "close", side: "SELL", mark: 3010, fill: 3009.7, bps: 1, order_id: "10" }];
  const pending = preflight(base({ state: { live_slip: slip } }));
  assert.equal(line(pending, "live_tape").status, "WAIT");
  assert.match(line(pending, "slippage").line, /^Live slippage over 2 exchange fills/);
  const checked = { checks: { [liveKey(slip[0])]: { verdict: "ON_TAPE" }, [liveKey(slip[1])]: { verdict: "ON_TAPE" } } };
  assert.equal(line(preflight(base({ state: { live_slip: slip }, tape: checked })), "live_tape").status, "PASS");
  const off = { checks: { ...checked.checks, [liveKey(slip[1])]: { verdict: "OFF", bps: 40 } } };
  const r = preflight(base({ state: { live_slip: slip }, tape: off }));
  assert.equal(line(r, "live_tape").status, "FAIL");
  assert.equal(r.ready, false);
  assert.equal(line(preflight(base()), "live_tape"), undefined, "no live fill, no line");
});
