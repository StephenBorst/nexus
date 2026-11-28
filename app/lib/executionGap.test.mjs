import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executionGap, gapLine, runsLine, configDiff, lifetimeCount, PAIR_WINDOW_MIN, GAP_MIN_MATCHED, GAP_LINE_PAPER, NO_STAGE_LINE, GAP_SIGN_LINE } from "./executionGap.mjs";
import { readPaperConfig } from "./housePaper.mjs";

const T0 = Date.parse("2026-11-20T00:00:00Z");
const iso = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const row = (sym, dir, openMin, closeMin, entry, exit, reason, sl = 2) => ({ symbol: `PERP_${sym}_USDC`, direction: dir, opened_at: iso(openMin), closed_at: iso(closeMin), entry_price: entry, exit_price: exit, reason, sl_percent: sl });
const st = (startMin, trades, pos = null) => ({ started_at: iso(startMin), paper_trades: trades, current_position: pos });
const NOW = T0 + 10_000 * 60000;

test("pairs by coin + side within the window, nearest first; missed, extra and the gap in bps (+ = yours worse)", () => {
  const ref = st(0, [
    row("ETH", "LONG", 100, 400, 3000, 3090, "TP"),
    row("BTC", "SHORT", 500, 900, 90000, 91800, "SL"),
    row("SOL", "LONG", 1000, 1200, 150, 147, "SL"),          // you missed this one
  ]);
  const mine = st(50, [
    row("ETH", "LONG", 101, 401, 3000.6, 3089.1, "TP"),      // 1 min later, paid 2 bps more, sold 2.9 bps lower
    row("BTC", "SHORT", 503, 903, 89991, 91800, "SL"),        // a short that sold 1 bp lower = worse
    row("ETH", "SHORT", 700, 800, 3050, 3000, "TP"),          // the reference never took it
    row("BTC", "SHORT", 520, 530, 90000, 90000, "TIMEOUT"),   // same coin/side but 20 min off: not a pair
  ]);
  const g = executionGap({ read: "oi_div_reversal", config: readPaperConfig("oi_div_reversal"), state: mine, refWallet: "0xref", refState: ref, now: NOW });
  assert.equal(g.from, iso(50), "from the later of the two record starts");
  assert.equal(g.refCount, 3);
  assert.equal(g.matched, 2);
  const eth = g.pairs.find((p) => p.coin === "ETH");
  assert.deepEqual([eth.lagMin, eth.entryBps, eth.exitBps, eth.refR, eth.myR], [1, 2, 2.9, 1.5, 1.47]);
  const btc = g.pairs.find((p) => p.coin === "BTC");
  assert.equal(btc.entryBps, 1, "a short selling lower is worse");
  assert.deepEqual(g.missed.map((m) => m.coin), ["SOL"]);
  assert.deepEqual(g.extra.map((m) => `${m.coin} ${m.side}`).sort(), ["BTC SHORT", "ETH SHORT"]);
  assert.equal(g.medianLagMin, null, "under 5 paired trades: no medians");
  assert.equal(g.medianEntryBps, null);
  assert.deepEqual(g.configDiff, { entries: [], sizing: [] });
  assert.equal(gapLine(g), "Paired 2 of the read’s own 3 trades · missed 1 · extra 2. Medians from 5 paired trades (2 so far).");
  assert.equal(runsLine(g), "Your run 4 of 30 · its own run 3 of 30");
});

test("trades before the later record start never count; a fresh reference trade isn't 'missed' yet; open trades pair without R", () => {
  const ref = st(0, [row("ETH", "LONG", 10, 20, 3000, 3010, "TP")], { paper: true, symbol: "PERP_BTC_USDC", direction: "LONG", opened_at: iso(9995), entry_price: 90000 });
  const mine = st(100, [], { paper: true, symbol: "PERP_BTC_USDC", direction: "LONG", opened_at: iso(9996), entry_price: 90009 });
  const g = executionGap({ read: "oi_div_reversal", config: readPaperConfig("oi_div_reversal"), state: mine, refWallet: "0xref", refState: ref, now: NOW });
  assert.equal(g.matched, 1);
  assert.deepEqual([g.pairs[0].refR, g.pairs[0].myR, g.pairs[0].exitBps, g.pairs[0].myExit], [null, null, null, "OPEN"]);
  assert.equal(g.missed.length, 0, "the ETH trade was before your run started");
  const fresh = executionGap({ read: "oi_div_reversal", config: readPaperConfig("oi_div_reversal"), state: st(100, []), refWallet: "0xref", refState: ref, now: T0 + (9995 + PAIR_WINDOW_MIN - 1) * 60000 });
  assert.equal(fresh.missed.length, 0, "inside the pairing window it can still be matched next tick");
  assert.equal(fresh.refCount, 0);
});

test("config diff: a tweak that changes entries is named; sizing alone isn't a different run; LEVEL_RECLAIM mode = the read", () => {
  const base = readPaperConfig("level_reclaim");
  assert.deepEqual(configDiff("level_reclaim", { ...base, signalMode: "LEVEL_RECLAIM", read: undefined }), { entries: [], sizing: [] });
  assert.deepEqual(configDiff("level_reclaim", { ...base, capitalPerTrade: 200 }), { entries: [], sizing: ["capitalPerTrade"] });
  const d = configDiff("level_reclaim", { ...base, symbols: ["BTC", "ETH"], maxTradesPerDay: 2 });
  assert.deepEqual(d.entries, ["symbols", "maxTradesPerDay"]);
  assert.deepEqual(configDiff("level_reclaim", { ...base, symbols: [...base.symbols].reverse() }).entries, [], "order of coins doesn't matter");
  const g = executionGap({ read: "level_reclaim", config: { ...base, maxTradesPerDay: 2 }, state: st(0, []), refWallet: "0xref", refState: st(0, [row("ETH", "LONG", 10, 20, 3000, 3010, "TP")]), now: NOW });
  assert.match(gapLine(g), /differs in maxTradesPerDay: that changes which trades are taken, so it is a different run\./);
});

test("unread stays unread; nothing yet says so; the words never claim slippage, an edge or a total", () => {
  assert.match(gapLine(executionGap({ read: "x", config: {}, state: null, refWallet: "0x", refState: st(0, []) })), /couldn’t be read/);
  assert.match(gapLine(executionGap({ read: "oi_div_reversal", config: readPaperConfig("oi_div_reversal"), state: st(0, []), refWallet: "0x", refState: st(0, []), now: NOW })), /No trades on either run/);
  assert.match(GAP_LINE_PAPER, /not slippage/);
  const src = readFileSync(new URL("./executionGap.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ""), /\bedge\b|proven|total R|sumR|reduce\(\(s, ?p\) => s \+ p\.(my|ref)R/);
});

test("medians from 5 paired trades; each run counted n of 30 from its own record start", () => {
  const refRows = [], myRows = [];
  for (let k = 0; k < GAP_MIN_MATCHED; k++) {
    refRows.push(row("ETH", "LONG", 100 + k * 500, 300 + k * 500, 3000, 3030, "TP"));
    myRows.push(row("ETH", "LONG", 100 + k * 500 + (k % 2 ? 2 : 1), 300 + k * 500, 3000 * (1 + (k + 1) / 10_000), 3030, "TP"));
  }
  const g = executionGap({ read: "oi_div_reversal", config: readPaperConfig("oi_div_reversal"), state: { ...st(0, myRows), paper_agg: { trades: 12 } }, refWallet: "0xref", refState: st(0, refRows), now: NOW });
  assert.equal(g.matched, 5);
  assert.equal(g.medianEntryBps, 3);
  assert.equal(g.medianLagMin, 1);
  assert.equal(gapLine(g), "Paired 5 of the read’s own 5 trades · missed 0 · extra 0. Median entry gap +3 bps · median lag +1 min.");
  assert.deepEqual(g.runs, { mine: { count: 12, target: 30 }, ref: { count: 5, target: 30 } }, "paper_agg is the lifetime count");
  assert.equal(lifetimeCount(st(400, refRows)), 4, "a trade opened before the record start doesn't count");
});

test("numbers only: no comparative words, no mean R, and the no-stage line is said", () => {
  const src = readFileSync(new URL("./executionGap.mjs", import.meta.url), "utf8");
  const strings = [...src.matchAll(/["`]([^"`]*)["`]/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(strings, /\b(worse|better|beat|beats|outperform|ahead|behind|edge|proven|stronger|weaker)\b/i);
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /meanR|mean R|average R/i, "code, not comments");
  assert.match(NO_STAGE_LINE, /never moves this read’s stage/);
  assert.match(GAP_SIGN_LINE, /\+ bps = your fill paid more/);
});

test("the card: on the Agent tab, the read's Shelf card and its paper page; only for that read; ink only; numbers only", () => {
  const card = readFileSync(new URL("../pages/lab/ExecutionGapCard.tsx", import.meta.url), "utf8");
  assert.match(card, /gap\.read !== read\)\) return null/, "only the wallet's own read");
  assert.match(card, /gap\.self/, "never on the read's own wallet");
  assert.doesNotMatch(card.replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""), /C\.pos|C\.neg|\bworse\b|\bbetter\b|\bbeat\b|meanR|later|earlier/, "code and copy, not comments");
  assert.match(card, /NO_STAGE_LINE/);
  const agent = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.match(agent, /<ExecutionGapCard wallet=\{walletAddress\} read=/);
  assert.match(agent, /<StrategyShelf mine=\{\{ wallet: walletAddress/);
  const shelf = readFileSync(new URL("../pages/lab/StrategyShelf.tsx", import.meta.url), "utf8");
  assert.match(shelf, /mine\.read === r\.id && \(\s*<ExecutionGapCard[^>]*compact/);
  const page = readFileSync(new URL("../pages/proof/PaperRun.tsx", import.meta.url), "utf8");
  assert.match(page, /<ExecutionGapCard wallet=\{wallet\} read=\{axis\} \/>/);
});
