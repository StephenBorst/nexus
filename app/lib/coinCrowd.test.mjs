// Who's on this coin, in the coin panel (app/lib/coinCrowd.mjs). Run: node --test app/lib/coinCrowd.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { takesForCoin, crowdLine, callerRow, CROWD_TAKES_WINDOW_MS } from "./coinCrowd.mjs";

const NOW = Date.parse("2026-11-20T23:00:00Z");

test("takes that name the coin, newest first, inside a week", () => {
  const takes = [
    { id: "a", sym: "BTC", createdAt: NOW - 3600_000 },
    { id: "b", sym: "btc", createdAt: NOW - 60_000 },
    { id: "c", sym: "ETH", createdAt: NOW - 60_000 },
    { id: "d", sym: "BTC", createdAt: NOW - CROWD_TAKES_WINDOW_MS - 1 },
    { id: "e", createdAt: NOW },
  ];
  assert.deepEqual(takesForCoin(takes, "PERP_BTC_USDC", NOW).map((t) => t.id), ["b", "a"]);
  assert.deepEqual(takesForCoin(null, "BTC", NOW), []);
});

test("the header counts, in words; an unread source says so, never 0", () => {
  assert.equal(crowdLine({ participants: 3, callCount: 2 }, [{}]), "3 positioned · 2 open calls · 1 take this week");
  assert.equal(crowdLine({ participants: 1, callCount: 1 }, []), "1 positioned · 1 open call · 0 takes this week");
  assert.equal(crowdLine(null, null), "callers unread · takes unread");
  assert.equal(crowdLine({ participants: 0 }, []), "0 positioned · 0 takes this week");
});

test("a caller row: name or short wallet, merit glyph, graded record or 'ungraded', side as a label", () => {
  const r = callerRow({ wallet: "0xD9F7b3273b504e1473c3faba6341299d0ec9b449", displayName: "Banksy", direction: "SHORT", meritRank: { glyph: "▪", title: "Signal" }, record: { calls: 54, winRate: 44.4, avgR: 0.28 } });
  assert.deepEqual(r, { wallet: "0xd9f7b3273b504e1473c3faba6341299d0ec9b449", who: "Banksy", glyph: "▪", title: "Signal", record: "54 graded · 44% · +0.28R", side: "SHORT" });
  assert.equal(callerRow({ wallet: "0x73967d1fb1d3ed728a667fbeded44717c92d9624", direction: "LONG", record: null }).record, "ungraded");
  assert.equal(callerRow({ wallet: "0x73967d1fb1d3ed728a667fbeded44717c92d9624" }).who, "0x7396…9624");
});

test("no crowd side: the panel never sums callers into a lean", () => {
  const src = readFileSync(new URL("./coinCrowd.mjs", import.meta.url), "utf8") + readFileSync(new URL("../components/CoinCrowd.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.lean\b|longCount|shortCount|% LONG|% SHORT/);
  assert.match(readFileSync(new URL("../components/CoinCrowd.tsx", import.meta.url), "utf8"), /ungraded/i);
});
