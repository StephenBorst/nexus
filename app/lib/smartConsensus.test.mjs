// Smart Money consensus (app/lib/smartConsensus.mjs). Run: node --test app/lib/smartConsensus.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consensusFromBoard, CONSENSUS_RATIO } from "./smartConsensus.mjs";

const pos = (sym, side, szUsd = 1000, entry = 100) => ({ sym, coin: sym, tradeable: true, side, szUsd, entry });
const trader = (i, ...positions) => ({ address: `0x${i}`, positions });
const many = (n, sym, side, start = 0) => Array.from({ length: n }, (_, i) => trader(start + i, pos(sym, side)));

test("a near split is not consensus; it is named apart", () => {
  const board = [...many(10, "ETH", "SHORT"), ...many(8, "ETH", "LONG", 100), ...many(11, "BTC", "SHORT", 200), ...many(3, "BTC", "LONG", 300)];
  const { rows, splits } = consensusFromBoard(board);
  assert.deepEqual(rows.map((r) => `${r.sym} ${r.side} ${r.count}/${r.against}`), ["BTC SHORT 11/3"]);
  assert.deepEqual(splits, [{ sym: "ETH", long: 8, short: 10 }]);
  assert.equal(rows[0].tracked, board.length);
  assert.equal(CONSENSUS_RATIO, 2);
});

test("exactly 2× qualifies; one trader alone never does; untradeable positions don't count", () => {
  const board = [...many(4, "SOL", "LONG"), ...many(2, "SOL", "SHORT", 50), trader(90, pos("DOGE", "LONG")), trader(91, { ...pos("HL", "LONG"), tradeable: false }), trader(92, { ...pos("HL", "LONG"), tradeable: false })];
  const { rows, splits } = consensusFromBoard(board);
  assert.deepEqual(rows.map((r) => r.sym), ["SOL"]);
  assert.equal(rows[0].against, 2);
  assert.deepEqual(splits, []);
});

test("an even split is a split, ranked by how many traders hold it", () => {
  const board = [...many(3, "XRP", "LONG"), ...many(3, "XRP", "SHORT", 10), ...many(2, "ARB", "LONG", 20), ...many(2, "ARB", "SHORT", 30)];
  assert.deepEqual(consensusFromBoard(board).splits.map((s) => s.sym), ["XRP", "ARB"]);
});

test("the reference price is the biggest holder's entry; netUsd sums the side; at most 6 rows", () => {
  const board = [trader(1, pos("BTC", "LONG", 5_000, 60_000)), trader(2, pos("BTC", "LONG", 50_000, 61_000)), trader(3, pos("BTC", "LONG", 1_000, 0))];
  const r = consensusFromBoard(board).rows[0];
  assert.equal(r.refPrice, 61_000);
  assert.equal(r.netUsd, 56_000);
  const wide = Array.from({ length: 9 }, (_, k) => many(2, `C${k}`, "LONG", k * 10)).flat();
  assert.equal(consensusFromBoard(wide).rows.length, 6);
  assert.deepEqual(consensusFromBoard(null), { rows: [], splits: [] });
});

test("SmartMoneyView takes consensus from the shared rule", () => {
  const src = readFileSync(new URL("../pages/lab/SmartMoneyView.tsx", import.meta.url), "utf8");
  assert.match(src, /consensusFromBoard\(/);
});
