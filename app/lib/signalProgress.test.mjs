import test from "node:test";
import assert from "node:assert/strict";
import { signalProgress, paperLine, paperWalletsFor } from "./signalProgress.mjs";
import { registrationFor, PAPER_MIN_TRADES } from "./readPipeline.mjs";

const read = (axis, stage, exitTrades, exitNetBps) => ({ axis, stage, numbers: { exitTrades, exitNetBps } });
const board = (...reads) => ({ pipeline: { reads } });

test("lists only reads served TRADEABLE/PAPER with a positive exit net (the headline's own test)", () => {
  const p = signalProgress(board(
    read("level_reclaim", "PAPER", 42, 25.2),
    read("oi_div_reversal_4h", "LEAD", 15, 109),
    read("confluence_follow", "TRADEABLE", 29, -5),
    read("oi_coil_break", "TRADEABLE", 0, 40),
  ));
  assert.deepEqual(p.map((x) => x.axis), ["level_reclaim"]);
  assert.equal(p[0].trades, 42);
});

test("the paper count is the wallet's lifetime trades against the signed gate; unread is null, never 0", () => {
  const wallet = registrationFor("level_reclaim").paperWallet;
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(wallet), "level_reclaim's paper wallet is recorded");
  const sc = board(read("level_reclaim", "PAPER", 42, 25.2));
  const got = signalProgress(sc, { [wallet.toLowerCase()]: 3 })[0].paper;
  assert.deepEqual(got, { wallet, trades: 3, target: PAPER_MIN_TRADES });
  assert.equal(PAPER_MIN_TRADES, 30);
  assert.equal(signalProgress(sc, {})[0].paper.trades, null);
  assert.deepEqual(paperWalletsFor(sc), [wallet]);
});

test("the plain line: count of the gate, unread, or no wallet yet; never a P&L number", () => {
  assert.equal(paperLine({ paper: { trades: 0, target: 30 } }), "On paper: 0 of 30 trades.");
  assert.equal(paperLine({ paper: { trades: null, target: 30 } }), "On paper: count unread right now.");
  assert.equal(paperLine({ paper: null }), "Paper wallet next.");
});

test("an unread or empty scoreboard lists nothing", () => {
  assert.deepEqual(signalProgress(null), []);
  assert.deepEqual(signalProgress({ failed: true }), []);
});
