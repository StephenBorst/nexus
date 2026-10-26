import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addViewed, readViewed, writeViewed, validViewed, viewedHref, VIEWED_MAX, VIEWED_KEY,
  pairsForAddress, didYouMean, sameAddress, SPOT_MAJORS, majorHref,
  needsSolanaFunds, openCallCount, callCountLine,
  isRealMarket, poolFlags, poolCaution,
  safeLogoUrl, fundingPayLine, readBrief, callerRecordLine, callDraft, chipMarks, chipKey, majorLogo,
  callStrip, isStripCall, openChipLine, labRowLine, readLabOpen, writeLabOpen, LAB_ROW_KEY, GRADED_WINDOW_MS, CALL_STRIP_MAX,
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

test("logos: only https on the data hosts; a bad stored logo is dropped, the row kept", () => {
  assert.equal(safeLogoUrl("https://dd.dexscreener.com/ds-data/tokens/solana/x.png"), "https://dd.dexscreener.com/ds-data/tokens/solana/x.png");
  assert.ok(safeLogoUrl("https://assets.geckoterminal.com/a.png"));
  assert.ok(safeLogoUrl("https://coin-images.coingecko.com/coins/images/1/large/b.png"));
  assert.equal(safeLogoUrl("http://dd.dexscreener.com/x.png"), null);
  assert.equal(safeLogoUrl("https://dexscreener.com.evil.io/x.png"), null);
  assert.equal(safeLogoUrl("javascript:alert(1)"), null);
  const s = memStore();
  s.setItem(VIEWED_KEY, JSON.stringify([{ kind: "spot", chain: "solana", ca: RAY, sym: "RAY", at: 1, img: "https://evil.io/x.png" }]));
  const [row] = readViewed(s);
  assert.equal(row.sym, "RAY");
  assert.equal(row.img, undefined);
});

test("logos: a re-view without a logo keeps the stored one; majors reuse it by address", () => {
  const img = "https://dd.dexscreener.com/ray.png";
  let l = addViewed([], { kind: "spot", chain: "solana", ca: RAY, sym: "RAY", img }, 1);
  l = addViewed(l, { kind: "spot", chain: "solana", ca: RAY, sym: "RAY" }, 2);
  assert.equal(l[0].img, img);
  const ray = SPOT_MAJORS.find((m) => m.sym === "RAY");
  assert.equal(majorLogo(ray, l), img);
  assert.equal(majorLogo(SPOT_MAJORS.find((m) => m.sym === "BTC"), l), null);
});

test("read brief: who pays, the open call count, and the not-graded tag; no funding → no line", () => {
  assert.equal(readBrief({ fundingAnnualPct: 12, callCount: 3 }), "Funding +12.0%/yr, longs pay · 3 public calls open · a mechanical rule, not graded.");
  assert.equal(readBrief({ fundingAnnualPct: -8.04, callCount: 1 }), "Funding −8.0%/yr, shorts pay · 1 public call open · a mechanical rule, not graded.");
  assert.equal(readBrief({ fundingAnnualPct: 0.01, callCount: 0 }), "Funding +0.0%/yr, flat · no public calls open · a mechanical rule, not graded.");
  assert.equal(readBrief({ fundingAnnualPct: null, callCount: 4 }), null);
  assert.equal(readBrief({ fundingAnnualPct: 5, callCount: undefined }), "Funding +5.0%/yr, longs pay · a mechanical rule, not graded.");
  assert.equal(fundingPayLine(NaN), null);
});

test("caller record: win rate always beside R and sample; no record = ungraded", () => {
  assert.equal(callerRecordLine({ calls: 12, winRate: 58.3, avgR: -0.3 }), "12 graded · 58% · −0.30R");
  assert.equal(callerRecordLine({ calls: 5, winRate: 60, avgR: 0.25 }), "5 graded · 60% · +0.25R");
  assert.equal(callerRecordLine(null), "ungraded");
  assert.equal(callerRecordLine({ calls: 0, winRate: 0, avgR: 0 }), "ungraded");
  assert.doesNotMatch(callerRecordLine({ calls: 9, winRate: 70, avgR: -0.1 }), /^\d+%$/);
});

test("call draft: entry = the mark (rounded), no side or levels; no mark → no entry", () => {
  const d = callDraft({ coin: "PERP_SOL_USDC", mark: 103.93412 });
  assert.equal(d.symbol, "SOL");
  assert.equal(d.entryPrice, "103.934");
  assert.equal(d.direction, undefined);
  assert.equal(d.stopLoss, undefined);
  assert.equal(callDraft({ coin: "BTC", mark: 64123.456 }).entryPrice, "64123.5");
  assert.equal(callDraft({ coin: "BONK", mark: 0.0000213 }).entryPrice, "0.000021");
  assert.equal(callDraft({ coin: "ETH", mark: null }).entryPrice, undefined);
  assert.equal(callDraft({ coin: "<x>", mark: 1 }), null);
});

test("chip dots: an open call on a listed coin, or a buy of that exact token", () => {
  const viewed = [
    { kind: "spot", chain: "solana", ca: RAY, sym: "RAY" },
    { kind: "spot", chain: "base", ca: "0x" + "a".repeat(40), sym: "RAY" }, // a same-ticker copy
    { kind: "perp", sym: "BTC" },
    { kind: "spot", chain: "base", ca: EVM, sym: "NEXUS" },
  ];
  const m = chipMarks(viewed, { openCoins: new Set(["RAY", "BTC"]), listed: new Set(["RAY", "BTC"]), buys: [{ chain: "base", ca: EVM.toLowerCase() }] });
  assert.deepEqual(m[chipKey(viewed[0])], { call: true, buy: false });
  assert.deepEqual(m[chipKey(viewed[2])], { call: true, buy: false });
  assert.deepEqual(m[chipKey(viewed[3])], { call: false, buy: true });
  // the copy shares the ticker, so it matches the listed-coin call too; an UNLISTED ticker never does
  const unlisted = chipMarks(viewed, { openCoins: new Set(["RAY"]), listed: new Set(), buys: [] });
  assert.equal(unlisted[chipKey(viewed[0])], undefined);
  assert.deepEqual(chipMarks(viewed, {}), {});
});

// ── public calls strip ──
const NOW = Date.UTC(2026, 9, 26, 12);
const LISTED = new Set(["BTC", "ETH", "SOL", "HYPE"]);
const call = (o) => ({ id: o.id ?? Math.random().toString(36).slice(2), wallet: "0xaa", symbol: "BTC", direction: "LONG",
  entryPrice: 100, stopLoss: 90, takeProfit1: 120, status: "ACTIVE", isPublic: true, createdAt: NOW - 3600000, ...o });

test("calls strip: one chip per coin, spellings merged, counts only (no side anywhere)", () => {
  const s = callStrip([
    call({ id: "a", symbol: "PERP_BTC_USDC", fillState: "OPEN" }),
    call({ id: "b", symbol: "BTC", direction: "SHORT", entryPrice: 100, stopLoss: 110, takeProfit1: 80, fillState: "WORKING" }),
    call({ id: "c", symbol: "btc", fillState: "WORKING" }),
    call({ id: "d", symbol: "ETH", fillState: "OPEN" }),
  ], LISTED, { now: NOW });
  assert.equal(s.mode, "open");
  assert.deepEqual(s.chips.map((c) => c.coin), ["BTC", "ETH"]);
  assert.equal(s.chips[0].calls, 3);
  assert.equal(s.chips[0].awaiting, 2);
  assert.equal(openChipLine(s.chips[0]), "3 calls · 2 awaiting fill");
  assert.equal(openChipLine(s.chips[1]), "1 call");
  // No long/short split and no lean: nothing on a chip names a side.
  for (const c of s.chips) assert.deepEqual(Object.keys(c).sort(), ["awaiting", "calls", "coin", "losses", "wins"]);
  assert.doesNotMatch(JSON.stringify(s), /LONG|SHORT/);
});

test("calls strip: an entry that hasn't traded is never counted as filled", () => {
  const s = callStrip([call({ fillState: "WORKING" }), call({ fillState: "WORKING" })], LISTED, { now: NOW });
  assert.equal(s.chips[0].awaiting, 2);
  assert.equal(openChipLine(s.chips[0]), "2 calls · all awaiting fill");
  assert.equal(openChipLine({ calls: 1, awaiting: 1 }), "1 call · 1 awaiting fill");
});

test("calls strip: listed coins only; an unreadable listed set shows nothing", () => {
  const rows = [call({ symbol: "USDJPY", fillState: "OPEN" }), call({ symbol: "PEPE", fillState: "OPEN" })];
  assert.deepEqual(callStrip(rows, LISTED, { now: NOW }), { mode: null, chips: [] });
  assert.deepEqual(callStrip([call({ fillState: "OPEN" })], new Set(), { now: NOW }), { mode: null, chips: [] });
  assert.deepEqual(callStrip([call({ fillState: "OPEN" })], null, { now: NOW }), { mode: null, chips: [] });
  assert.deepEqual(callStrip(null, LISTED, { now: NOW }), { mode: null, chips: [] });
});

test("calls strip: resolution rows, copies, holders-only, private and duplicate rows are skipped", () => {
  const dupe = call({ id: "same", fillState: "OPEN" });
  const s = callStrip([
    { resolution: true, symbol: "BTC", outcome: "WIN" },
    call({ fillState: "OPEN", duplicateOf: "0xbb" }),
    call({ fillState: "OPEN", holdersOnly: true }),
    call({ fillState: "OPEN", isPublic: false }),
    call({ fillState: "OPEN", entryPrice: 0 }),
    dupe, { ...dupe },
  ], LISTED, { now: NOW });
  assert.equal(s.chips.length, 1);
  assert.equal(s.chips[0].calls, 1);
  assert.equal(isStripCall({ resolution: true, symbol: "BTC", entryPrice: 1 }), false);
});

test("calls strip: invalid calls count nowhere", () => {
  const bad = call({ direction: "LONG", entryPrice: 100, stopLoss: 110, takeProfit1: 120 }); // stop above a long's entry
  assert.deepEqual(callStrip([bad], LISTED, { now: NOW }), { mode: null, chips: [] });
});

test("calls strip: nothing unresolved → wins and losses graded in the last 7 days", () => {
  const rows = [
    call({ symbol: "SOL", status: "HIT_TP", gradedOutcome: "WIN", gradedAt: NOW - 86400000 }),
    call({ symbol: "SOL", status: "STOPPED_OUT", gradedOutcome: "LOSS", gradedAt: NOW - 2 * 86400000 }),
    call({ symbol: "ETH", status: "STOPPED_OUT", gradedOutcome: "LOSS", gradedAt: NOW - 3 * 86400000 }),
    call({ symbol: "BTC", status: "HIT_TP", gradedOutcome: "WIN", gradedAt: NOW - GRADED_WINDOW_MS - 1 }), // too old
    call({ symbol: "HYPE", status: "HIT_TP", gradedOutcome: "WIN", gradedAt: NOW + 60000 }), // future stamp
    call({ symbol: "ETH", status: "CLOSED" }), // closed by its owner, never graded: not a W or an L
  ];
  const s = callStrip(rows, LISTED, { now: NOW });
  assert.equal(s.mode, "graded");
  assert.deepEqual(s.chips.map((c) => [c.coin, c.wins, c.losses]), [["SOL", 1, 1], ["ETH", 0, 1]]);
});

test("calls strip: unresolved calls win over the graded fallback; capped and ranked", () => {
  const rows = [
    call({ symbol: "SOL", status: "HIT_TP", gradedOutcome: "WIN", gradedAt: NOW - 1000 }),
    call({ symbol: "ETH", fillState: "OPEN" }),
  ];
  assert.equal(callStrip(rows, LISTED, { now: NOW }).mode, "open");
  const many = [];
  const big = new Set();
  for (let i = 0; i < 12; i++) { big.add(`C${i}`); for (let k = 0; k <= i; k++) many.push(call({ symbol: `C${i}`, fillState: "OPEN" })); }
  const s = callStrip(many, big, { now: NOW });
  assert.equal(s.chips.length, CALL_STRIP_MAX);
  assert.equal(s.chips[0].coin, "C11");
});

test("lab row line: inputs only, never a verdict", () => {
  assert.equal(labRowLine({ isPerp: true, fundingAnnualPct: 12.04, callCount: 3 }), "Funding +12.0%/yr, longs pay · 3 public calls open");
  assert.equal(labRowLine({ isPerp: true, fundingAnnualPct: -5, callCount: 0 }), "Funding −5.0%/yr, shorts pay · no public calls open");
  assert.equal(labRowLine({ isPerp: true, fundingAnnualPct: 4 }), "Funding +4.0%/yr, longs pay");
  assert.equal(labRowLine({ isPerp: true }), "Reading the funding tape…");
  assert.equal(labRowLine({ isPerp: false, coin: "PEPE" }), "Not a Nexus market · ask Nexus about PEPE");
  for (const t of [labRowLine({ isPerp: true, fundingAnnualPct: 40, callCount: 9 })]) assert.doesNotMatch(t, /edge|proven|graded|buy|sell/i);
});

test("lab row state: folded by default, remembered per browser, survives a broken storage", () => {
  const s = memStore();
  assert.equal(readLabOpen(s), false);
  writeLabOpen(s, true);
  assert.equal(s.getItem(LAB_ROW_KEY), "1");
  assert.equal(readLabOpen(s), true);
  writeLabOpen(s, false);
  assert.equal(readLabOpen(s), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLabOpen(broken), false);
  assert.doesNotThrow(() => writeLabOpen(broken, true));
  assert.equal(readLabOpen(undefined), false);
});
