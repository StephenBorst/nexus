// A Hyperliquid wallet's watched record (hlRecord.mjs): realized since the anchor, net of fees; forward only;
// a stale, gapped or missing tape is never a row. Run: node --test app/lib/hlRecord.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hlAnchor, hlRealizedRow, nextHlRow, HL_SYNC_FRESH_MS } from "./hlRecord.mjs";
import { xrayTrack } from "../../workers/nexus-lab-api/logic.mjs";

const DAY = 86_400_000;
const T0 = 1_790_000_000_000;
// compact fill: [tid, time, coin, px, sz, side, dir, closedPnl, fee]
const fill = (tid, time, coin, pnl, fee = "1") => [tid, time, coin, "1", "1", "A", "Close Long", String(pnl), String(fee)];
const tape = (fills, syncedAt, completeFrom = null) => ({ v: 1, fills, completeFrom, syncedAt });

test("the first row is the anchor: fills before it never count", () => {
  const r = nextHlRow([], tape([fill(1, T0 - DAY, "ETH", 5000)], T0), { now: T0, minGapMs: 20 * 3600e3 });
  assert.equal(r.row.anchor, T0);
  assert.equal(r.row.realized, 0, "a past win is not this record's P&L");
  assert.equal(hlAnchor([r.row]), T0);
});

test("later rows: closed P&L net of fees since the anchor, per coin wins / losses", () => {
  const hist = [{ t: T0, anchor: T0, realized: 0 }];
  const fills = [fill(1, T0 - 10, "BTC", 999), fill(2, T0 + 10, "ETH", 100, 2), fill(3, T0 + 20, "SOL", -40, 1), fill(4, T0 + 30, "ETH", 50, 0)];
  const r = nextHlRow(hist, tape(fills, T0 + DAY), { now: T0 + DAY, minGapMs: 20 * 3600e3 });
  assert.equal(r.row.realized, 100 - 2 + 50 - 40 - 1);
  assert.deepEqual([r.row.markets, r.row.wins, r.row.losses, r.row.venue], [2, 1, 1, "hl"]);
});

test("never stored: no tape, a tape not synced just now, a gap since the anchor; and the daily throttle holds", () => {
  const hist = [{ t: T0, anchor: T0, realized: 0 }];
  const now = T0 + DAY;
  assert.deepEqual(hlRealizedRow(null, { anchor: T0, now }), { refused: "unread" });
  assert.deepEqual(hlRealizedRow(tape([], now - HL_SYNC_FRESH_MS - 1), { anchor: T0, now }), { refused: "stale" });
  assert.deepEqual(hlRealizedRow(tape([], now, T0 + 5), { anchor: T0, now }), { refused: "gap" }, "complete only from after the anchor");
  assert.ok(hlRealizedRow(tape([], now, T0 - 5), { anchor: T0, now }).row, "complete from before the anchor is fine");
  assert.deepEqual(nextHlRow(hist, tape([], T0 + 3600e3), { now: T0 + 3600e3, minGapMs: 20 * 3600e3 }), { skip: "fresh" });
});

test("graded by the same xrayTrack as an Orderly record", () => {
  const rows = [{ t: T0, anchor: T0, realized: 0 }];
  for (let d = 1; d <= 5; d++) rows.push({ t: T0 + d * DAY, anchor: T0, realized: d * 100 });
  const tk = xrayTrack(rows);
  assert.equal(tk.scored, true);
  assert.equal(tk.netRealized, 500);
});
