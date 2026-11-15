// app/lib/eventsCalendar.mjs. Run: node --test app/lib/eventsCalendar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { macroEvents, marketEvents, calendar, untilWords, eventDetail, dayLabel, nextHighImpact, CALENDAR_NOTE } from "./eventsCalendar.mjs";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const FF = [
  { title: "CPI m/m", country: "USD", date: "2026-11-18T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
  { title: "CPI m/m", country: "USD", date: "2026-11-18T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
  { title: "Retail Sales m/m", country: "USD", date: "2026-11-15T09:00:00-05:00", impact: "Medium", forecast: "", previous: "0.2%" },
  { title: "Bank Holiday", country: "USD", date: "2026-11-16T00:00:00-05:00", impact: "Holiday" },
  { title: "German ZEW", country: "EUR", date: "2026-11-17T05:00:00-05:00", impact: "High" },
  { title: "Old print", country: "USD", date: "2026-11-14T08:30:00-05:00", impact: "High" },
  { title: "Bad date", country: "USD", date: "soon", impact: "High" },
  { title: "Far away", country: "USD", date: "2026-12-30T08:30:00-05:00", impact: "High" },
];

test("macro: USD high/medium inside the window, de-duplicated; a non-array reply is unread (null)", () => {
  const m = macroEvents(FF, { now: NOW });
  assert.deepEqual(m.map((e) => e.title), ["Retail Sales m/m", "CPI m/m"]);
  assert.equal(m[1].at, Date.parse("2026-11-18T13:30:00Z"), "the feed's offset is honoured");
  assert.equal(m[0].forecast, null, "an empty forecast is absent, never \"\"");
  assert.equal(macroEvents({ error: "rate limited" }), null);
  assert.equal(macroEvents("<html>"), null);
  assert.deepEqual(macroEvents([], { now: NOW }), []);
});

test("markets: dated Catalysts rows with the crowd's odds and the coins named; a missing board is unread", () => {
  const board = { catalysts: [
    { question: "Will the Fed hike 25 bps in December?", category: "RATES", yesProbPct: 86.54, endDate: "2026-12-09T23:59:00Z", impacts: [{ coin: "BTC" }, { coin: "ETH" }, { coin: "BTC" }] },
    { question: "Closed already", endDate: "2026-11-01T00:00:00Z" },
    { question: "Next year", endDate: "2027-06-01T00:00:00Z" },
  ] };
  const m = marketEvents(board, { now: NOW });
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].coins, ["BTC", "ETH"]);
  assert.equal(m[0].yesPct, 86.5);
  assert.equal(eventDetail(m[0]), "86.5% yes on Polymarket · market closes then · touches BTC, ETH");
  assert.equal(marketEvents(null), null);
});

test("calendar: time order; words for when and what", () => {
  const rows = calendar({ macro: macroEvents(FF, { now: NOW }), markets: [{ kind: "MARKET", at: Date.parse("2026-11-18T13:30:00Z"), title: "x" }] });
  assert.deepEqual(rows.map((r) => r.kind), ["MACRO", "MACRO", "MARKET"], "macro first on a tie");
  assert.equal(untilWords(NOW + 2 * 3.6e6 + 10 * 60e3, NOW), "in 2h 10m");
  assert.equal(untilWords(NOW + 3 * 3.6e6, NOW), "in 3h");
  assert.equal(untilWords(NOW + 4 * 3.6e6 + 59.8 * 60e3, NOW), "in 5h", "never \"4h 60m\"");
  assert.equal(untilWords(NOW - 40 * 60e3, NOW), "out 40m ago");
  assert.equal(untilWords(NOW + 3 * 86.4e6, NOW), "in 3d");
  assert.equal(eventDetail(rows[1]), "High impact · forecast 0.3% · previous 0.4%");
  assert.equal(dayLabel(NOW + 3.6e6, NOW, "UTC"), "Today");
  assert.equal(dayLabel(NOW + 86.4e6, NOW, "UTC"), "Tomorrow");
  assert.equal(dayLabel(Date.parse("2026-11-18T13:30:00Z"), NOW, "UTC"), "Wed 18 Nov");
  assert.equal(nextHighImpact(rows, NOW).title, "CPI m/m");
});

test("no direction, no call, no grade in the words", () => {
  const all = [CALENDAR_NOTE, ...calendar({ macro: macroEvents(FF, { now: NOW }) }).map(eventDetail)].join(" ");
  assert.doesNotMatch(all, /\b(long|short|buy|sell|bullish|bearish|edge|graded|proven)\b/i);
});

test("wired: a Calendar lens on Lab home reading /intel/events", async () => {
  const { readFileSync } = await import("node:fs");
  const { lensFromQuery } = await import("./intelLenses.mjs");
  assert.equal(lensFromQuery("calendar"), "calendar");
  assert.match(readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8"), /if \(id === "calendar"\) return <EventsCalendar \/>;/);
  assert.match(readFileSync(new URL("../pages/lab/EventsCalendar.tsx", import.meta.url), "utf8"), /\/intel\/events/);
});
