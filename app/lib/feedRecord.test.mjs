// app/lib/feedRecord.mjs. Run: node --test app/lib/feedRecord.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feedRecords, recordLine, watchedFeed } from "./feedRecord.mjs";

const c = (wallet, outcome, r, over = {}) => ({ wallet, symbol: "PERP_ETH_USDC", gradedOutcome: outcome, gradedR: r, ...over });

test("a caller's whole graded record from the feed, losses included, copies and open calls left out", () => {
  const m = feedRecords([
    c("0xAA", "WIN", 1.5), c("0xaa", "LOSS", -1), c("0xAA", "LOSS", -1),
    c("0xAA", undefined, null), // open
    c("0xAA", "WIN", 3, { duplicateOf: "x" }), // a marked copy
    c("0xBB", "WIN", 2),
  ]);
  assert.deepEqual(m.get("0xaa"), { graded: 3, wins: 1, netR: -0.5 });
  assert.equal(recordLine(m.get("0xaa")), "3 graded · 1 won · −0.50R net");
  assert.equal(recordLine(m.get("0xbb")), "1 graded · 1 won · +2.00R net");
  assert.equal(recordLine(m.get("0xcc")), "no graded calls yet");
});

test("Your coins: the feed narrowed to the watched coins, any symbol spelling", () => {
  const feed = [{ symbol: "PERP_ETH_USDC" }, { symbol: "BTC" }, { symbol: "PERP_SOL_USDC" }];
  assert.deepEqual(watchedFeed(feed, ["eth", "SOL"]).map((t) => t.symbol), ["PERP_ETH_USDC", "PERP_SOL_USDC"]);
  assert.deepEqual(watchedFeed(feed, []), []);
});

test("the feed wires it: a Your coins view, the record on every card, coin names open the drawer", () => {
  const src = readFileSync(new URL("../pages/feed/index.tsx", import.meta.url), "utf8");
  assert.match(src, /view === "coins"/);
  assert.match(src, /watchedFeed\(feed, watchCoins\)/);
  assert.match(src, /recordLine\(/);
  assert.match(src, /<CoinLink coin=\{ticker\}/);
});
