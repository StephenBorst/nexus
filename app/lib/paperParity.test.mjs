// Live-vs-graded parity: paper entries ↔ the scoreboard's graded events.
// Run: node --test app/lib/paperParity.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { paperParity, axisForConfig, entriesFromPaperTrades, unsimulatedFilters, PARITY_SETTLE_MS } from "./paperParity.mjs";

const H = 3600000;
const T0 = Date.parse("2026-09-25T08:00:00Z");
const CFG = { signalMode: "BASIS_FADE", basisConfirm: "CVD", symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"], maxTradesPerDay: 3, maxDailyLossUsdc: 10, maxHoldHours: 12 };
const iso = (t) => new Date(t).toISOString();
const row = (id, sym, side, open, close, pnl = 1, extra = {}) => ({ id, symbol: `PERP_${sym}_USDC`, direction: side, opened_at: iso(open), closed_at: iso(close), pnl, ...extra });
const until = T0 + 72 * H;
const run = (trades, events, cfg = CFG) => paperParity({ trades, events, config: cfg, since: T0, until });

test("axisForConfig maps the exact rule; inverted / non-basis configs trade no axis", () => {
  assert.equal(axisForConfig({ signalMode: "BASIS_FADE" }), "basis_extreme");
  assert.equal(axisForConfig(CFG), "basis_x_cvd");
  assert.equal(axisForConfig({ signalMode: "BASIS_FADE", basisConfirm: "SMART" }), "basis_x_smart");
  assert.equal(axisForConfig({ signalMode: "BASIS_FADE", basisConfirm: "LIQ" }), "basis_x_liqflush");
  assert.equal(axisForConfig({ ...CFG, invertSignal: true }), null);
  assert.equal(axisForConfig({ signalMode: "CONFLUENCE" }), null);
  assert.equal(axisForConfig(null), null);
});

test("scale-out slices collapse to one entry (first open, last close, summed P&L)", () => {
  const e = entriesFromPaperTrades([
    row("a1", "ETH", "LONG", T0, T0 + 3 * H, 1, { parent_id: "P" }),
    row("a2", "ETH", "LONG", T0, T0 + 6 * H, 2, { parent_id: "P" }),
  ]);
  assert.equal(e.length, 1);
  assert.equal(e[0].closedAt, T0 + 6 * H);
  assert.equal(e[0].pnl, 3);
  assert.equal(e[0].coin, "ETH");
});

test("CLEAN: every entry follows a same-market same-side event, every free event was taken", () => {
  const events = [{ coin: "ETH", t: T0 + 1 * H, side: "LONG" }, { coin: "SOL", t: T0 + 20 * H, side: "SHORT" }];
  const trades = [row("1", "ETH", "LONG", T0 + 1 * H + 7 * 60000, T0 + 13 * H), row("2", "SOL", "SHORT", T0 + 20 * H + 4 * 60000, T0 + 25 * H)];
  const p = run(trades, events);
  assert.equal(p.verdict, "CLEAN");
  assert.equal(p.counts.matched, 2);
  assert.equal(p.matched[0].lagMin, 7);
});

test("DRIFT: an entry with no graded event is flagged; the other side is named when that's what was graded", () => {
  const p = run([row("1", "BTC", "LONG", T0 + 5 * H, T0 + 9 * H)], []);
  assert.equal(p.verdict, "DRIFT");
  assert.match(p.unmatchedTrades[0].reason, /no graded event/);
  const q = run([row("1", "BTC", "LONG", T0 + 5 * H, T0 + 9 * H)], [{ coin: "BTC", t: T0 + 5 * H - 20 * 60000, side: "SHORT" }]);
  assert.match(q.unmatchedTrades[0].reason, /OTHER side \(SHORT\)/);
  // the SHORT event is free (agent wasn't in a position before 5h) — also unexplained? No:
  // the agent opened the LONG inside its window, so it was BUSY — explained.
  assert.equal(q.counts.missedUnexplained, 0);
});

test("an entry too long after its event (> 3h) does not match — the brain would not have traded that reading", () => {
  const p = run([row("1", "ETH", "LONG", T0 + 5 * H, T0 + 8 * H)], [{ coin: "ETH", t: T0 + 1 * H, side: "LONG" }]);
  assert.equal(p.counts.matched, 0);
  assert.equal(p.counts.unmatchedTrades, 1);
  assert.equal(p.counts.missedUnexplained, 1);
  assert.equal(p.verdict, "DRIFT");
});

test("misses the agent's own rules explain are listed, not called drift", () => {
  const events = [
    { coin: "ETH", t: T0 + 1 * H, side: "LONG" },   // taken
    { coin: "ETH", t: T0 + 3 * H, side: "LONG" },   // still holding that ETH long → HOLDING
    { coin: "SOL", t: T0 + 4 * H, side: "SHORT" },  // holding ETH → BUSY (one position at a time)
  ];
  const trades = [row("1", "ETH", "LONG", T0 + 1 * H + 60000, T0 + 13 * H)];
  const p = run(trades, events);
  assert.equal(p.verdict, "CLEAN");
  assert.deepEqual(p.missed.explained.map((m) => m.code), ["HOLDING", "BUSY"]);
});

test("daily trade cap and daily loss cap explain a miss (trailing 24h, labelled likely)", () => {
  const trades = [0, 3, 6].map((h, i) => row(String(i), "BTC", "LONG", T0 + h * H + 60000, T0 + (h + 2) * H, -1));
  const events = [0, 3, 6].map((h) => ({ coin: "BTC", t: T0 + h * H, side: "LONG" })).concat([{ coin: "ETH", t: T0 + 10 * H, side: "SHORT" }]);
  const p = run(trades, events);
  assert.equal(p.verdict, "CLEAN");
  assert.equal(p.missed.explained[0].code, "DAILY_TRADES");
  assert.match(p.missed.explained[0].text, /likely/);
  const loss = run([row("1", "BTC", "LONG", T0 + 60000, T0 + 2 * H, -12)], [{ coin: "BTC", t: T0, side: "LONG" }, { coin: "ETH", t: T0 + 5 * H, side: "LONG" }], { ...CFG, maxTradesPerDay: 9 });
  assert.equal(loss.missed.explained[0].code, "DAILY_LOSS");
});

test("cooldown: a window covered by position + cooldown is explained; one that closes early leaves a gap = drift", () => {
  const trades = [row("1", "BTC", "LONG", T0 + 60000, T0 + 2 * H - 50 * 60000)];
  // position to 1h10 + cooldown to 1h25 covers an event at 0h20 (window to 1h20) end to end.
  const inside = run(trades, [{ coin: "BTC", t: T0, side: "LONG" }, { coin: "ETH", t: T0 + 20 * 60000, side: "LONG" }]);
  assert.equal(inside.missed.explained[0].code, "BUSY"); // first blocker in the walk is the open position
  assert.equal(inside.verdict, "CLEAN");
  const after = run(trades, [{ coin: "BTC", t: T0, side: "LONG" }, { coin: "ETH", t: T0 + 3 * H, side: "LONG" }]);
  assert.equal(after.verdict, "DRIFT");
  assert.equal(after.counts.missedUnexplained, 1);
  // a position that closes EARLY in the event's hour leaves the agent free for the rest of it
  const early = run([row("1", "BTC", "LONG", T0 + 60000, T0 + H + 5 * 60000)], [{ coin: "BTC", t: T0, side: "LONG" }, { coin: "ETH", t: T0 + H, side: "LONG" }]);
  assert.equal(early.counts.missedUnexplained, 1, "free from 1h20 to 2h with the reading live → should have entered");
});

test("window: events before `since`, off-watchlist markets, and unsettled recent events are not judged", () => {
  const events = [
    { coin: "ETH", t: T0 - 5 * H, side: "LONG" },               // before since
    { coin: "DOGE", t: T0 + 5 * H, side: "LONG" },              // not in config.symbols
    { coin: "ETH", t: until - PARITY_SETTLE_MS + H, side: "LONG" }, // too recent
  ];
  const p = run([], events);
  assert.equal(p.verdict, "NO_DATA");
  assert.equal(p.counts.events, 0);
});

test("duplicate events in the same hour count once", () => {
  const events = [{ coin: "ETH", t: T0 + H, side: "LONG" }, { coin: "ETH", t: T0 + H + 5 * 60000, side: "LONG" }];
  const p = run([row("1", "ETH", "LONG", T0 + H + 10 * 60000, T0 + 5 * H)], events);
  assert.equal(p.counts.events, 1);
  assert.equal(p.verdict, "CLEAN");
});

test("unsimulated filters make free misses UNVERIFIABLE rather than drift; an unmatched ENTRY is still drift", () => {
  const cfg = { ...CFG, tradeSessions: ["US"] };
  assert.deepEqual(unsimulatedFilters(cfg), ["session"]);
  // inert on BASIS_FADE / latency-only → not a reason to call a miss unverifiable
  assert.deepEqual(unsimulatedFilters({ ...CFG, fundingPercentileMin: 95, maxSignalAgeSec: 180 }), []);
  assert.equal(run([], [{ coin: "ETH", t: T0 + H, side: "LONG" }], cfg).verdict, "UNVERIFIABLE");
  assert.equal(run([row("1", "BTC", "LONG", T0 + 5 * H, T0 + 9 * H)], [], cfg).verdict, "DRIFT");
});

test("a window that starts inside the cooldown and ends inside it is COOLDOWN", () => {
  // BTC closes at 1h → cooldown to 1h15; SOL opens at 1h14 and holds. An ETH event at 1h02 is
  // blocked first by the cooldown, then by the SOL position — no free moment.
  const trades = [row("1", "BTC", "LONG", T0 + 60000, T0 + H), row("2", "SOL", "SHORT", T0 + H + 14 * 60000, T0 + 9 * H)];
  const p = run(trades, [{ coin: "BTC", t: T0, side: "LONG" }, { coin: "SOL", t: T0 + H + 10 * 60000, side: "SHORT" }, { coin: "ETH", t: T0 + H + 2 * 60000, side: "LONG" }]);
  const eth = p.missed.explained.find((m) => m.event.coin === "ETH");
  assert.equal(eth.code, "COOLDOWN");
});

test("another market winning the brain's single signal explains a miss", () => {
  // both fire the same hour; the brain picks one market per wallet
  const p = run([row("1", "ETH", "LONG", T0 + 5 * 60000, T0 + 30 * 60000)], [{ coin: "ETH", t: T0, side: "LONG" }, { coin: "SOL", t: T0, side: "SHORT" }]);
  // ETH won the tick; even with a free gap later in the hour, the brain keeps handing this wallet
  // its best market, so the SOL miss is the brain's one-signal rule, not drift.
  assert.equal(p.missed.explained[0].code, "OTHER_MARKET");
  assert.equal(p.verdict, "CLEAN");
});

// ── The open position (Sept-26 LINK false alarm) ────────────────────────────────────────────
// The ledger only holds CLOSED rows. The trade the agent is in right now must count as an entry,
// or the event it is trading reads as an unexplained miss.
test("the open position matches its graded event — not a miss (the Sept-26 LINK case, real numbers)", () => {
  const cfg = { ...CFG, symbols: ["PERP_AVAX_USDC", "PERP_LINK_USDC"], maxHoldHours: 24 };
  const avaxEv = 1790399862996, linkEv = 1790439445765;
  const trades = [row("paper_1790422596597", "AVAX", "LONG", 1790400095018, 1790422596597, 6.4)];
  const events = [{ coin: "AVAX", t: avaxEv, side: "LONG" }, { coin: "LINK", t: linkEv, side: "LONG" }];
  const openPosition = { symbol: "PERP_LINK_USDC", direction: "LONG", opened_at: 1790439678488, paper: true };
  const args = { trades, events, config: cfg, since: 1790381056000, until: linkEv + 6 * H };

  const before = paperParity(args); // what the route did before: closed rows only
  assert.equal(before.counts.missedUnexplained, 1);
  assert.equal(before.verdict, "DRIFT");

  const r = paperParity({ ...args, openPosition });
  assert.equal(r.verdict, "CLEAN");
  assert.equal(r.counts.matched, 2);
  assert.equal(r.counts.missedUnexplained, 0);
  const link = r.matched.find((m) => m.entry.coin === "LINK");
  assert.equal(link.entry.open, true);
  assert.equal(link.entry.closedAt, null);
  assert.equal(link.lagMin, 4);
});

test("an event while the open position occupies the agent is explained, not drift", () => {
  const openPosition = { symbol: "PERP_ETH_USDC", direction: "LONG", opened_at: T0 + H, paper: true };
  const events = [{ coin: "ETH", t: T0 + H - 60000, side: "LONG" }, { coin: "BTC", t: T0 + 3 * H, side: "SHORT" }];
  const r = paperParity({ trades: [], events, config: CFG, since: T0, until, openPosition });
  assert.equal(r.counts.matched, 1);
  assert.equal(r.counts.missedUnexplained, 0);
  assert.equal(r.missed.explained[0].code, "BUSY");
});

test("paper scale-out: slices WITHOUT parent_id and a final close WITH one collapse to one position", () => {
  // exec's paper TP_PARTIAL rows carry no parent_id; the laddered final close does.
  const e = entriesFromPaperTrades([
    row("paper_1", "SOL", "LONG", T0, T0 + 2 * H, 1, { reason: "TP_PARTIAL" }),
    row("paper_2", "SOL", "LONG", T0, T0 + 5 * H, 2, { parent_id: "agent_abc_1" }),
  ]);
  assert.equal(e.length, 1);
  assert.equal(e[0].pnl, 3);
  assert.equal(e[0].closedAt, T0 + 5 * H);
});

test("an open position with a slice already closed stays OPEN (slices merge into it)", () => {
  const e = entriesFromPaperTrades(
    [row("paper_1", "BTC", "SHORT", T0, T0 + 2 * H, 1.5, { reason: "TP_PARTIAL" })],
    { symbol: "PERP_BTC_USDC", direction: "SHORT", opened_at: T0, paper: true },
  );
  assert.equal(e.length, 1);
  assert.equal(e[0].closedAt, null);
  assert.equal(e[0].open, true);
  assert.equal(e[0].pnl, 1.5);
});

test("no open position (or a malformed one) changes nothing", () => {
  const trades = [row("a", "ETH", "LONG", T0, T0 + H)];
  assert.deepEqual(entriesFromPaperTrades(trades, null), entriesFromPaperTrades(trades));
  assert.deepEqual(entriesFromPaperTrades(trades, { symbol: "PERP_ETH_USDC", direction: "FLAT", opened_at: T0 }), entriesFromPaperTrades(trades));
});
