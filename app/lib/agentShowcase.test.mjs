// agentShowcase.mjs: counts and states only; unread never 0.
// Run: node --test app/lib/agentShowcase.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTitle, paperRows, haltLine, liveLine, runsSummary } from "./agentShowcase.mjs";

test("read titles", () => {
  assert.equal(readTitle("oi_div_reversal_4h"), "OI div reversal 4h");
  assert.equal(readTitle("level_reclaim"), "Level reclaim");
  assert.equal(readTitle("rsi_reset_deep"), "RSI reset deep");
  assert.equal(readTitle("smart_consensus_2x"), "Smart consensus 2x");
  assert.equal(readTitle("bb_rsi_momentum"), "BB RSI momentum");
});

test("paper rows: furthest first, unread last and never counted", () => {
  const r = paperRows({ runs: {
    rsi_reset_deep: { count: 0, target: 30, open: false, house: true },
    level_reclaim: { count: 13, target: 30, open: false },
    oi_div_reversal_4h: { count: 9, target: 30, open: true },
    session_fade: { count: 9, target: 30, open: false, house: true },
    spot_absorb: { unread: true },
  } });
  assert.deepEqual(r.rows.map((x) => x.id), ["level_reclaim", "oi_div_reversal_4h", "session_fade", "rsi_reset_deep", "spot_absorb"]);
  assert.equal(r.trades, 31);
  assert.equal(r.openNow, 1);
  assert.equal(r.rows[4].count, null);
  assert.match(runsSummary(r), /^4 reads|^5 reads/);
  assert.equal(paperRows(null).unread, true);
  assert.equal(runsSummary(paperRows(null)), "The paper runs are unread right now.");
});

test("halt + live lines: unread is said, never a default", () => {
  assert.equal(haltLine(null).paused, null);
  assert.equal(haltLine({ halted: true }).paused, true);
  assert.match(haltLine({ halted: false }).text, /open/);
  assert.equal(liveLine(null), "Live agents: unread right now.");
  assert.equal(liveLine({ count: 0 }), "No live agent is publishing a position right now.");
  assert.equal(liveLine({ count: 2 }), "2 live agents are publishing their positions right now.");
});

test("no P&L words or money in the showcase", () => {
  const src = readFileSync(new URL("./agentShowcase.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /pnl|profit|proven|\bedge\b|usd|dollar/i);
});
