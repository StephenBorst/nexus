// Paper ledger: the chain must catch any edit, gap or reorder, and the root must
// be stable for the same records. Runs on fixed fixtures; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextPaperHead, verifyPaperLog, paperRoot, canonicalPaperRow, GENESIS_HEAD, paperSeqKey,
} from "../../app/lib/paperLedger.mjs";

const row = (n, pnl) => ({
  symbol: "PERP_BTC_USDC", direction: "LONG", entry_price: 100 + n, exit_price: 101 + n,
  qty: 1, leverage: 2, pnl, pnl_percent: 1, reason: "TP", strategy: "x",
  opened_at: "2026-10-01T00:00:00.000Z", closed_at: "2026-10-01T01:00:00.000Z",
});

async function build(rows) {
  let head = GENESIS_HEAD; const out = [];
  for (let i = 0; i < rows.length; i++) {
    head = await nextPaperHead(head, i + 1, rows[i]);
    out.push({ seq: i + 1, row: rows[i], head });
  }
  return out;
}

test("an honest chain verifies and reports its head", async () => {
  const log = await build([row(1, 5), row(2, -3), row(3, 2)]);
  const v = await verifyPaperLog(log);
  assert.equal(v.ok, true);
  assert.equal(v.count, 3);
  assert.equal(v.head, log[2].head);
});

test("editing one closed trade breaks the chain at that row", async () => {
  const log = await build([row(1, 5), row(2, -3), row(3, 2)]);
  log[1] = { ...log[1], row: { ...log[1].row, pnl: 40 } }; // rewrite a loss as a win
  const v = await verifyPaperLog(log);
  assert.equal(v.ok, false);
  assert.equal(v.atSeq, 2);
});

test("deleting a row is a gap, not a silent shorter record", async () => {
  const log = await build([row(1, 5), row(2, -3), row(3, 2)]);
  const v = await verifyPaperLog([log[0], log[2]]);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "gap");
});

test("canonical row ignores key order and fills missing fields with null", () => {
  const a = canonicalPaperRow({ symbol: "A", pnl: 1 });
  const b = canonicalPaperRow({ pnl: 1, symbol: "A" });
  assert.equal(a, b);
  assert.equal(JSON.parse(a).length, 12);
});

test("paper root is order-independent, lowercases wallets, skips empty agents", async () => {
  const agents = [
    { wallet: "0xAAA", head: "h1", count: 2 },
    { wallet: "0xbbb", head: "h2", count: 1 },
    { wallet: "0xccc", head: GENESIS_HEAD, count: 0 },
  ];
  const r1 = await paperRoot(agents);
  const r2 = await paperRoot([...agents].reverse().map((a) => ({ ...a, wallet: a.wallet.toUpperCase() })));
  assert.equal(r1.count, 2);
  assert.equal(r1.ledgerHash, r2.ledgerHash);
  assert.match(r1.ledgerHash, /^[0-9a-f]{64}$/);
});

test("a changed agent head changes the root", async () => {
  const base = [{ wallet: "0xaaa", head: "h1", count: 2 }];
  const r1 = await paperRoot(base);
  const r2 = await paperRoot([{ wallet: "0xaaa", head: "h9", count: 2 }]);
  assert.notEqual(r1.ledgerHash, r2.ledgerHash);
});

test("storage keys sort by sequence and are per wallet", () => {
  assert.ok(paperSeqKey("0xABC", 2) > paperSeqKey("0xABC", 1));
  assert.equal(paperSeqKey("0xABC", 1), "arena:paper:log:0xabc:00000001");
});
