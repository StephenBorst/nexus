// The Arena board's PAPER record must be the LIFETIME aggregate, not the rolling
// last-50 window, and a reset must leave a visible count. Pure function under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaPaperBlock } from "./routes-arena.mjs";

const DAY = 86400000;
const agg = { trades: 120, wins: 70, grossWin: 900, grossLoss: 500, net: 400, firstTradeAt: Date.parse("2026-08-01T00:00Z"), lastTradeAt: Date.parse("2026-08-01T00:00Z") + 10 * DAY };

test("lifetime aggregate wins over the rolling 50-trade window", () => {
  // Window shows 50 trades, all losses. Lifetime says 120 trades, 70 wins, net positive.
  const losingWindow = Array.from({ length: 50 }, (_, i) => ({ pnl: -5, opened_at: new Date(i * 1000).toISOString(), closed_at: new Date(DAY + i * 1000).toISOString() }));
  const b = arenaPaperBlock({ paper_trades: losingWindow, paper_agg: agg });
  assert.equal(b.lifetime, true);
  assert.equal(b.trades, 120, "must count the whole record, not the window");
  assert.equal(b.wins, 70);
  assert.equal(b.netPnl, 400);
  assert.equal(b.daysActive, 10);
  assert.ok(b.score > 0, "score comes from the lifetime figures");
});

test("agents with no aggregate yet are labelled as a window", () => {
  const rows = [{ pnl: 3, opened_at: new Date(0).toISOString(), closed_at: new Date(DAY).toISOString() }];
  const b = arenaPaperBlock({ paper_trades: rows });
  assert.equal(b.lifetime, false);
  assert.equal(b.window, "last 50 trades");
  assert.equal(b.trades, 1);
});

test("no paper history returns null, not a zeroed record", () => {
  assert.equal(arenaPaperBlock({}), null);
  assert.equal(arenaPaperBlock({ paper_trades: [], paper_agg: null }), null);
});

test("resets are counted on the card", () => {
  assert.equal(arenaPaperBlock({ paper_agg: agg, paper_resets: 2 }).resets, 2);
  assert.equal(arenaPaperBlock({ paper_agg: agg }).resets, 0);
});
