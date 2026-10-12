import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addViewed, readViewed, writeViewed, validViewed, viewedHref, VIEWED_MAX, VIEWED_KEY,
  pairsForAddress, didYouMean, sameAddress, SPOT_MAJORS, majorHref,
  needsSolanaFunds, openCallCount, callCountLine,
  isRealMarket, poolFlags, poolCaution,
} from "./spotDiscovery.mjs";

const RAY = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
const EVM = "0x3D958634ab725B627919EF8F2Ed59227309fDba3";
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("viewed: newest first, one row per token, capped at 5", () => {
  let l = [];
  for (let i = 0; i < 7; i++) l = addViewed(l, { kind: "perp", sym: `T${i}` }, i);
  assert.equal(l.length, VIEWED_MAX);
  assert.equal(l[0].sym, "T6");
  l = addViewed(l, { kind: "perp", sym: "T4" }, 99);
  assert.deepEqual(l.map((v) => v.sym), ["T4", "T6", "T5", "T3", "T2"]);
});

test("viewed: keyed by chain + CA, not ticker (two RAYs stay two rows); EVM CA case-insensitive", () => {
  let l = addViewed([], { kind: "spot", chain: "solana", ca: RAY, sym: "RAY" }, 1);
  l = addViewed(l, { kind: "spot", chain: "base", ca: "0x" + "a".repeat(40), sym: "RAY" }, 2);
  assert.equal(l.length, 2);
  l = addViewed(l, { kind: "spot", chain: "base", ca: EVM, sym: "NEXUS" }, 3);
  l = addViewed(l, { kind: "spot", chain: "base", ca: EVM.toLowerCase(), sym: "NEXUS" }, 4);
  assert.equal(l.filter((v) => v.sym === "NEXUS").length, 1);
});

test("viewed: bad rows are refused on write and dropped on read", () => {
  assert.equal(validViewed({ kind: "spot", chain: "solana", ca: "not-a-mint", sym: "X" }), false);
  assert.equal(validViewed({ kind: "spot", chain: "solana", ca: RAY, sym: "<script>" }), false);
  assert.deepEqual(addViewed([], { kind: "spot", chain: "base", ca: "0x123", sym: "X" }), []);
  const s = memStore();
  s.setItem(VIEWED_KEY, JSON.stringify([{ kind: "spot", chain: "solana", ca: RAY, sym: "RAY", at: 1 }, { kind: "spot", chain: "x", ca: "javascript:alert(1)", sym: "BAD" }]));
  assert.deepEqual(readViewed(s).map((v) => v.sym), ["RAY"]);
  const broken = memStore(); broken.setItem(VIEWED_KEY, "{not json");
  assert.deepEqual(readViewed(broken), []);
  assert.deepEqual(readViewed(null), []);
});

test("viewed: write + read round-trip; blocked storage never throws", () => {
  const s = memStore();
  const l = addViewed([], { kind: "spot", chain: "solana", ca: RAY, sym: "RAY" }, 5);
  writeViewed(s, l);
  assert.deepEqual(readViewed(s), l);
  writeViewed({ setItem() { throw new Error("blocked"); } }, l);
});

test("viewed: a chip reopens by address (spot) or ticker (perp-only)", () => {
  assert.equal(viewedHref({ kind: "spot", ca: RAY, sym: "RAY" }), `/token/${RAY}`);
  assert.equal(viewedHref({ kind: "perp", sym: "BTC" }), "/token/BTC");
});

test("address search keeps the pairs whose BASE is the address", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const pairs = [
    { pairAddress: "a", baseAddress: "Bonk111", quoteAddress: SOL, liquidityUsd: 9e7 },
    { pairAddress: "b", baseAddress: SOL, liquidityUsd: 5e7 },
  ];
  assert.deepEqual(pairsForAddress(pairs, SOL).map((p) => p.pairAddress), ["b"]);
  assert.deepEqual(pairsForAddress([pairs[0]], SOL).map((p) => p.pairAddress), ["a"]); // nothing better: unchanged
  assert.ok(sameAddress(EVM, EVM.toLowerCase()));
  assert.ok(!sameAddress(RAY, RAY.toLowerCase())); // base58 is case-sensitive
});

test("did you mean: a different real token, deepest first; never for an address search", () => {
  const best = { baseAddress: RAY, chainId: "solana", liquidityUsd: 9e6, volume24h: 1e6 };
  const alts = [
    { baseAddress: RAY, chainId: "solana", liquidityUsd: 5e6, volume24h: 1e6 },           // same token, other pool
    { baseAddress: "0x" + "b".repeat(40), chainId: "bsc", liquidityUsd: 3000, volume24h: 9 }, // sub-floor copy
    { baseAddress: "0x" + "c".repeat(40), chainId: "base", liquidityUsd: 80000, volume24h: 20000 },
    { baseAddress: "0x" + "d".repeat(40), chainId: "eth", liquidityUsd: 400000, volume24h: 50000 },
  ];
  assert.equal(didYouMean(best, alts).chainId, "eth");
  assert.equal(didYouMean(best, alts, { addressQuery: true }), null);
  assert.equal(didYouMean(best, alts.slice(0, 2)), null);
  assert.equal(didYouMean(null, alts), null);
});

test("pinned majors: Solana majors open by mint, perp majors by ticker", () => {
  const by = Object.fromEntries(SPOT_MAJORS.map((m) => [m.sym, m]));
  assert.equal(majorHref(by.BTC), "/token/BTC");
  assert.equal(majorHref(by.SOL), "/token/So11111111111111111111111111111111111111112");
  assert.equal(majorHref(by.RAY), `/token/${RAY}`);
  for (const m of SPOT_MAJORS) if (m.ca) assert.ok(/^0x[0-9a-fA-F]{40}$/.test(m.ca) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.ca), m.sym);
});

test("bridge prompt: only when both balances were read and neither can pay", () => {
  assert.equal(needsSolanaFunds({ sol: 0, usdc: 0 }), true);
  assert.equal(needsSolanaFunds({ sol: 0.001, usdc: 50 }), true);  // USDC but no SOL for the fee
  assert.equal(needsSolanaFunds({ sol: 0.005, usdc: 50 }), false); // USDC + fee SOL: can buy
  assert.equal(needsSolanaFunds({ sol: 0.5, usdc: 0 }), false);
  assert.equal(needsSolanaFunds({ sol: null, usdc: 0 }), false);   // unknown → never nag
  assert.equal(needsSolanaFunds({ sol: 0, usdc: undefined }), false);
});

test("callers count: plain count of open public calls, no side split", () => {
  assert.equal(openCallCount({ callCount: 4, longCount: 3, shortCount: 1 }), 4);
  assert.equal(openCallCount({ callers: [{ sources: ["thesis"] }, { sources: ["position"] }, { sources: ["position", "thesis"] }] }), 2);
  assert.equal(openCallCount(null), 0);
  assert.equal(callCountLine(4, "RAY"), "4 public calls open on RAY");
  assert.equal(callCountLine(1, "RAY"), "1 public call open on RAY");
  assert.equal(callCountLine(0, "RAY"), null);
  assert.doesNotMatch(callCountLine(3, "RAY"), /long|short/i);
});

test("real market: a padded pool (liquidity ≈ market cap) or a thin one (no turnover) is not one", () => {
  const real = { liquidityUsd: 4e6, marketCap: 6e8, volume24h: 2e6 };
  assert.equal(isRealMarket(real), true);
  // ZRO-style copy: $3M "liquidity" on a $3.2M market cap, $1.5k traded
  const padded = { liquidityUsd: 3e6, marketCap: 3.2e6, volume24h: 1.5e5 };
  assert.deepEqual(poolFlags(padded), { padded: true, thin: false });
  assert.equal(isRealMarket(padded), false);
  const thin = { liquidityUsd: 2e6, marketCap: 9e7, volume24h: 1500 };
  assert.deepEqual(poolFlags(thin), { padded: false, thin: true });
  assert.equal(isRealMarket(thin), false);
  // floors still apply; unknown mcap / volume never flags on its own
  assert.equal(isRealMarket({ liquidityUsd: 4000, marketCap: 1e9, volume24h: 1e6 }), false);
  assert.deepEqual(poolFlags({ liquidityUsd: 1e6, marketCap: null, volume24h: null }), { padded: false, thin: false });
  assert.equal(isRealMarket(null), false);
});

test("did you mean skips padded and thin copies", () => {
  const best = { baseAddress: RAY, chainId: "solana", liquidityUsd: 9e6, marketCap: 5e8, volume24h: 1e6 };
  const alts = [
    { baseAddress: "0x" + "e".repeat(40), chainId: "bsc", liquidityUsd: 5e6, marketCap: 5.1e6, volume24h: 9e4 },  // padded
    { baseAddress: "0x" + "f".repeat(40), chainId: "base", liquidityUsd: 4e6, marketCap: 8e7, volume24h: 2000 },   // thin
    { baseAddress: "0x" + "c".repeat(40), chainId: "eth", liquidityUsd: 80000, marketCap: 2e6, volume24h: 20000 },
  ];
  assert.equal(didYouMean(best, alts).chainId, "eth");
});

test("pool caution: one line for padded or thin, nothing for a normal pool", () => {
  assert.match(poolCaution({ liquidityUsd: 3e6, marketCap: 3.2e6, volume24h: 1e5 }), /padded/);
  assert.match(poolCaution({ liquidityUsd: 2e6, marketCap: 9e7, volume24h: 100 }), /Almost nothing traded/);
  assert.equal(poolCaution({ liquidityUsd: 4e6, marketCap: 6e8, volume24h: 2e6 }), null);
});
