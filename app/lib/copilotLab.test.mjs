import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { venuesForCopilot, calendarForCopilot, riskForCopilot } from "./copilotLab.mjs";
import { venueRows, venueLine } from "./crossFunding.mjs";
import { riskDesk, riskLine } from "./riskDesk.mjs";

// The copilot reads the Lab's venues / calendar / risk panels through the panels' own rules (2026-11-15).

test("venues: the board's widest gaps, the panel's line, unread venues named", () => {
  const rows = venueRows({ orderly: { ETH: 11, BTC: 9, ZZZ: 4 }, hyperliquid: { ETH: 8.8, BTC: 9.1 }, okx: { ETH: 9.6 } });
  const out = venuesForCopilot({ rows, unread: ["okx"] });
  assert.deepEqual(out.widest_gaps.map((r) => r.coin), ["ETH", "BTC"], "sorted by gap; a coin no other venue lists has no gap");
  assert.equal(out.widest_gaps[0].line, venueLine(rows[0]));
  assert.deepEqual(out.unread, ["okx"]);
  assert.match(out.note, /not a free trade/);
  assert.equal(out.coins_listed, 3);
});

test("venues: one coin, from the coin route's row or the board", () => {
  const rows = venueRows({ orderly: { ETH: 11 }, hyperliquid: { ETH: 8.8 } });
  assert.equal(venuesForCopilot({ row: rows[0], unread: [] }, { coin: "ETH" }).gap_pts_yr, rows[0].gap);
  assert.equal(venuesForCopilot({ rows }, { coin: "perp_eth_usdc" }).coin, "ETH");
  assert.equal(venuesForCopilot({ row: null, unread: [] }, { coin: "XYZ" }).listed, false);
  assert.ok(venuesForCopilot(null).error, "a failed read says unavailable, never an empty board");
  assert.ok(venuesForCopilot({ rows: [], unread: ["orderly"] }).error);
});

test("calendar: inside the window, coin filter keeps macro, UTC times, unread named", () => {
  const now = Date.parse("2026-11-15T12:00:00Z"), H = 3_600_000;
  const events = [
    { kind: "MACRO", at: now + 2 * H, title: "CPI m/m", impact: "High", forecast: "0.3%", previous: "0.2%" },
    { kind: "MARKET", at: now + 3 * 24 * H, title: "ETH ETF staking?", yesPct: 40, coins: ["ETH"] },
    { kind: "MARKET", at: now + 4 * 24 * H, title: "SOL thing", yesPct: 10, coins: ["SOL"] },
    { kind: "MACRO", at: now + 10 * 24 * H, title: "FOMC", impact: "High" },
  ];
  const out = calendarForCopilot({ events, unread: ["markets"] }, { now, days: 7, coin: "ETH" });
  assert.deepEqual(out.events.map((e) => e.title), ["CPI m/m", "ETH ETF staking?"]);
  assert.equal(out.events[0].at_utc, "2026-11-15T14:00:00Z");
  assert.equal(out.events[0].when, "in 2h");
  assert.match(out.events[0].detail, /High impact · forecast 0\.3%/);
  assert.deepEqual(out.unread, ["markets"]);
  assert.match(out.note, /^Times in UTC\./);
  assert.equal(calendarForCopilot({ events }, { now, days: 30 }).events.length, 4);
  assert.ok(calendarForCopilot({ unread: ["macro", "markets"] }).error, "no events array = unavailable, never 'nothing scheduled'");
});

test("risk: the risk desk's own numbers and flags", () => {
  const rows = [
    { symbol: "PERP_ETH_USDC", position_qty: 2, mark_price: 3000, est_liq_price: 2880, full_tp_sl: { sl_trigger_price: 2850 } },
    { symbol: "PERP_BTC_USDC", position_qty: 0.1, mark_price: 90000, est_liq_price: 70000 },
  ];
  const desk = riskDesk(rows, { equity: 5000, funding: { PERP_ETH_USDC: 0.0001 }, periods: { PERP_ETH_USDC: 8 } });
  const out = riskForCopilot(desk);
  const eth = out.positions.find((p) => p.coin === "ETH");
  assert.equal(eth.stop, "past liquidation (never fires)");
  assert.equal(eth.liquidation_pct_away, 4);
  assert.equal(eth.line, riskLine(desk.positions.find((p) => p.coin === "ETH")));
  assert.equal(out.positions.find((p) => p.coin === "BTC").stop, "none");
  assert.deepEqual(out.book.unstopped, desk.unstopped);
  assert.ok(out.flags.some((f) => f.startsWith("WARN: Your ETH stop sits past liquidation")));
  assert.equal(riskForCopilot(riskDesk([], {})).open_positions, 0);
  assert.ok(riskForCopilot(null).error, "an unread account is not 'no positions'");
});

test("wiring: the copilot reads these through the shared rules, and the risk desk from the browser", () => {
  const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
  assert.match(tools, /from "@\/lib\/copilotLab\.mjs"/);
  for (const n of ["get_funding_venues", "get_calendar"]) assert.ok(tools.includes(`name: "${n}"`), n);
  assert.match(tools, /\/intel\/funding-venues/);
  assert.match(tools, /\/intel\/calendar`/, "the calendar route, not the older /intel/events");
  const book = tools.slice(tools.indexOf('name: "get_book_risk"'), tools.indexOf('name: "get_call_advice"'));
  assert.match(book, /riskForCopilot\(ctx\.riskDesk\)/);
  assert.doesNotMatch(book, /fetch\(/, "the book never leaves the browser");
  const panel = readFileSync(new URL("../components/NexusAssistant.tsx", import.meta.url), "utf8");
  assert.match(panel, /const \{ desk: riskDeskRead \} = useRiskDesk\(\);/);
  assert.match(panel, /riskDesk: riskDeskRead,/);
  const prompt = readFileSync(new URL("../config/assistant.ts", import.meta.url), "utf8");
  for (const n of ["get_funding_venues", "get_calendar", "get_book_risk"]) assert.ok(prompt.includes(n), `prompt names ${n}`);
});

test("watchlist: the panel's rows (watchRow), since the last look, read only", async () => {
  const { watchlistForCopilot } = await import("./copilotLab.mjs");
  const { watchRow } = await import("./watchlist.mjs");
  assert.match(watchlistForCopilot({ coins: [], seen: {} }, null).note, /☆ Watch/);
  const watch = {
    coins: ["ETH", "SOL", "XYZ"],
    seen: { ETH: { snap: { stretched: false, smartSide: "NONE" }, price: 3000, at: Date.parse("2026-11-15T10:00:00Z") } },
  };
  const reply = { coins: [
    { coin: "ETH", price: 3150, change24hPct: 2.1, snap: { stretched: true, fundAnnual: 40, smartSide: "LONG", smartL: 6, smartS: 2 } },
    { coin: "SOL", price: 150, change24hPct: -1, snap: {} },
  ] };
  const out = watchlistForCopilot(watch, reply);
  const eth = out.rows[0];
  assert.equal(eth.since_last_look_pct, 5);
  assert.equal(eth.last_look, "2026-11-15T10:00:00Z");
  assert.deepEqual(eth.changed_since, watchRow("ETH", reply.coins[0], watch.seen.ETH).changes);
  assert.ok(eth.changed_since.length >= 2, "funding stretched + consensus formed");
  assert.equal(out.rows[1].changed_since, "first look: watching from now");
  assert.deepEqual(out.rows[2], { coin: "XYZ", unread: true });
  assert.ok(watchlistForCopilot(watch, null).error, "unread prices are said, never shown as flat");
  assert.deepEqual(watch.seen.SOL, undefined, "reading in chat never marks a coin seen");
  const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
  const tool = tools.slice(tools.indexOf('name: "get_watchlist"'), tools.indexOf('name: "get_calendar"'));
  assert.match(tool, /readWatch\(\)/);
  assert.doesNotMatch(tool, /writeWatch|markSeen/);
  assert.match(tool, /\/intel\/markets\?coins=/);
});

test("calls: the grader's state in words, live distance in R, never a grade from a mark", async () => {
  const { callsForCopilot, CALL_STATE_WORDS } = await import("./copilotLab.mjs");
  const { callStatusRow } = await import("../../workers/nexus-lab-api/callStatus.mjs");
  const live = callStatusRow({ id: "a", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 100, stopLoss: 90, takeProfit1: 120, createdAt: Date.parse("2026-11-16T10:00:00Z"), fillState: "OPEN", filledAt: Date.parse("2026-11-16T10:00:00Z"), isPublic: true }, 105);
  const waiting = callStatusRow({ id: "b", symbol: "PERP_ETH_USDC", direction: "SHORT", entryPrice: 3000, stopLoss: 3100, takeProfit1: 2800, createdAt: 1, fillState: "WORKING", publishMark: { px: 2950 }, isPublic: true }, 2990);
  const out = callsForCopilot({ calls: [live, waiting], recent: [], counts: { open: 1, working: 1 }, marksAvailable: true });
  const btc = out.open_calls[0], eth = out.open_calls[1];
  assert.equal(btc.coin, "BTC");
  if (live.state === "OPEN") { assert.equal(btc.state, CALL_STATE_WORDS.OPEN); assert.equal(btc.move_r, 0.5); }
  assert.equal(btc.stop_away_r, live.live.levels.stop.r);
  assert.equal(eth.coin, "ETH");
  assert.equal(eth.state, CALL_STATE_WORDS[waiting.state] || waiting.state);
  assert.match(out.note, /not a grade/);
  assert.equal(callsForCopilot({ calls: [], marksAvailable: false }).marks, "unread right now: no live distances");
  assert.ok(callsForCopilot(null).error);
  const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
  const tool = tools.slice(tools.indexOf('name: "get_my_calls"'), tools.indexOf('name: "get_watchlist"'));
  assert.match(tool, /\/theses\/status\/\$\{w\}/);
  assert.match(tool, /callsForCopilot\(/);
});

test("scoreboard: the tide, each registered read's sides against random on new data, old data kept apart", async () => {
  const { scoreboardForCopilot } = await import("./copilotLab.mjs");
  const sc = {
    asOf: "2026-11-16T18:53:49Z", config: { coins: ["BTC", "ETH"], minSamples: 20 },
    tide: { from: "2026-08-07T16:00:00Z", to: "2026-11-16T07:00:00Z", LONG: { n: 1, meanR: -0.18 }, SHORT: { n: 1, meanR: 0.2 } },
    axes: [{ name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", verdict: "PREDICTIVE", best: null,
      random: { bySide: { LONG: { verdict: "BEATS_RANDOM", n: 107, pctBeaten: 98.3, realMeanR: 0.04, randomMedianR: -0.2 } } },
      oos: { sides: { LONG: { events: 48, r: { meanR: -0.04 } }, SHORT: { events: 42, r: { meanR: 0.52 } } },
        random: { bySide: { LONG: { verdict: "BEATS_RANDOM", n: 48, pctBeaten: 100, randomMedianR: -0.51 }, SHORT: { verdict: "NOT_DISTINGUISHABLE", n: 42, pctBeaten: 23.7, randomMedianR: 0.68 } } } } }],
    pipeline: { reads: [{ axis: "oi_div_reversal_4h", side: "BOTH", stage: "REGISTERED", next: "mean R > 0 with both halves agreeing", registeredAt: "2026-10-28T00:00:00Z", numbers: { events: 90, meanR: 0.22 } }] },
  };
  const out = scoreboardForCopilot(sc);
  assert.deepEqual(out.tide, { random_long_mean_r: -0.18, random_short_mean_r: 0.2, from: sc.tide.from, to: sc.tide.to });
  const r = out.registered_reads[0];
  assert.equal(r.stage, "REGISTERED");
  assert.deepEqual(r.short, { events: 42, read_mean_r: 0.52, random_entry_mean_r: 0.68, beat_pct_of_random: 23.7, verdict: "NOT_DISTINGUISHABLE" });
  assert.equal(r.long.random_entry_mean_r, -0.51);
  assert.equal(out.axes[0].vs_random.long.read_mean_r, 0.04, "old data stays in axes, labelled in the note");
  assert.match(out.note, /never against zero/);
  assert.ok(scoreboardForCopilot(null).error);
  assert.equal(scoreboardForCopilot({ ...sc, tide: { LONG: { meanR: null }, SHORT: { meanR: 0.2 } } }).tide, null, "an unread tide is null, never 0");
  const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
  const tool = tools.slice(tools.indexOf('name: "get_signal_scoreboard"'), tools.indexOf('name: "open_conviction"'));
  assert.match(tool, /scoreboardForCopilot\(sc\)/);
  const prompt = readFileSync(new URL("../config/assistant.ts", import.meta.url), "utf8");
  assert.match(prompt, /THE TIDE: judge every side against a random entry on that side/);
});

test("get_wire: the Wire's own rows, your calls merged by its rules, sources and grade lines kept, baseline read only", async () => {
  const { wireForCopilot } = await import("./copilotLab.mjs");
  const NOW = Date.parse("2026-11-21T12:00:00Z"), M = 60_000;
  const wire = {
    builtAt: NOW - 20_000, unread: ["news: Fed"],
    rows: [
      { id: "n1", kind: "NEWS", t: NOW - 2 * M, coin: "BTC", title: "Bitcoin slips", source: "CoinDesk", graded: "A headline, not a read.", link: "https://x.test" },
      { id: "call-a", kind: "CALL", t: NOW - 5 * M, coin: "ETH", title: "ETH short by you graded WIN", source: "Caller", graded: "Graded from public price, first touch.", path: "/feed/thesis/0xabc0000000000000000000000000000000000001/d" },
      { id: "f1", kind: "FUNDING", t: NOW - 60 * M, coin: "ETH", title: "ETH funding stretched", source: "Nexus", graded: "Nearest graded relative: NOISE." },
    ],
    upcoming: [{ id: "s", kind: "MACRO", t: NOW + 60 * M, title: "CPI", impact: "High" }, { id: "p", kind: "MARKET", t: NOW + 90 * M, title: "SOL ETF?", coins: ["SOL"] }],
  };
  const mine = [{ id: "mine-d-graded", kind: "MINE", t: NOW - 4 * M, coin: "ETH", title: "Your ETH short graded WIN +1.00R", source: "Your call", graded: "Graded from public price, first touch.", path: "/feed/thesis/0xabc0000000000000000000000000000000000001/d" }];
  const out = wireForCopilot(wire, mine, { now: NOW, lastLook: NOW - 3 * M });
  assert.deepEqual(out.rows.map((r) => r.what), ["Bitcoin slips", "Your ETH short graded WIN +1.00R", "ETH funding stretched"], "your own graded call replaces its public twin");
  assert.equal(out.rows[0].grade_line, "A headline, not a read.");
  assert.equal(out.rows[1].kind, "Your call");
  assert.equal(out.new_since_last_look, 1);
  assert.deepEqual(out.unread, ["news: Fed"]);
  const eth = wireForCopilot(wire, mine, { now: NOW, coin: "eth", filter: "mine" });
  assert.deepEqual(eth.rows.map((r) => r.what), ["Your ETH short graded WIN +1.00R"]);
  assert.deepEqual(eth.coming_up_12h.map((e) => e.what), ["CPI"], "a coin keeps macro, drops other coins' markets");
  assert.equal(wireForCopilot(wire, null, { now: NOW }).new_since_last_look, undefined, "no baseline = no count");
  assert.deepEqual(wireForCopilot(wire, null, { now: NOW, walletUnread: true }).unread, ["news: Fed", "your calls"]);
  assert.ok(wireForCopilot(null, null).error);
  // the tool only READS the Wire's baseline
  const tools = readFileSync(new URL("../config/assistantTools.ts", import.meta.url), "utf8");
  const tool = tools.slice(tools.indexOf('name: "get_wire"'), tools.indexOf('name: "get_watchlist"'));
  assert.match(tool, /\/intel\/wire/);
  assert.match(tool, /myCallRows\(/);
  assert.doesNotMatch(tool, /localStorage\.setItem/);
});
