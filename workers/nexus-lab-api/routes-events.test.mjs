// GET /intel/calendar (routes-events.mjs). Run: node --test workers/nexus-lab-api/routes-events.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleEvents, composeEvents, EVENTS_CACHE_KEY, MACRO_CACHE_KEY, FF_URLS } from "./routes-events.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const req = (p) => new Request(`https://og.nexustradinglabs.com${p}`);
const ok = (b) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: 200 });
const NOW = Date.parse("2026-11-15T12:00:00Z");
const THIS = [{ title: "CPI m/m", country: "USD", date: "2026-11-18T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.4%" }];
const NEXT = [{ title: "FOMC Statement", country: "USD", date: "2026-11-25T14:00:00-05:00", impact: "High" }];
const BOARD = { catalysts: [{ question: "Fed hike in December?", yesProbPct: 86.5, endDate: "2026-12-09T23:59:00Z", impacts: [{ coin: "BTC" }] }] };
const dispatch = async (p) => (p === "/intel/catalysts-board" ? ok(BOARD) : new Response("x", { status: 404 }));
const ff = (thisWeek, nextWeek) => async (u) => (u === FF_URLS[0] ? thisWeek() : u === FF_URLS[1] ? nextWeek() : new Response("x", { status: 404 }));

test("both weeks of macro + the Catalysts markets, in time order", async () => {
  const env = { LAB_STORE: kv() };
  const b = await composeEvents(env, { dispatch, fetchImpl: ff(() => ok(THIS), () => ok(NEXT)), now: NOW });
  assert.deepEqual(b.events.map((e) => e.title), ["CPI m/m", "FOMC Statement", "Fed hike in December?"]);
  assert.deepEqual(b.unread, []);
  assert.ok(env.LAB_STORE.m.has(MACRO_CACHE_KEY));
});

test("the feed is read at most once an hour; a refusal serves the last good copy marked stale, then unread after 24h", async () => {
  const env = { LAB_STORE: kv() };
  let calls = 0;
  const counting = ff(() => { calls++; return ok(THIS); }, () => ok([]));
  await composeEvents(env, { dispatch, fetchImpl: counting, now: NOW });
  await composeEvents(env, { dispatch, fetchImpl: counting, now: NOW + 30 * 60e3 });
  assert.equal(calls, 1, "served from the hour cache");
  const refused = ff(() => ok("<html>Request Denied</html>"), () => ok("<html>"));
  const stale = await composeEvents(env, { dispatch, fetchImpl: refused, now: NOW + 2 * 3.6e6 });
  assert.equal(stale.macroStale, true);
  assert.equal(stale.events[0].title, "CPI m/m");
  const gone = await composeEvents(env, { dispatch, fetchImpl: refused, now: NOW + 25 * 3.6e6 });
  assert.deepEqual(gone.unread, ["macro"], "never an empty week passed off as quiet");
  assert.equal(gone.macroError, "not json", "the reply names why the feed failed");
  const denied = await composeEvents({ LAB_STORE: kv() }, { dispatch, fetchImpl: async () => new Response("x", { status: 403 }), now: NOW });
  assert.equal(denied.macroError, "http 403");
  const noNext = await composeEvents({ LAB_STORE: kv() }, { dispatch, fetchImpl: ff(() => ok(THIS), () => new Response("x", { status: 404 })), now: NOW });
  assert.deepEqual(noNext.unread, [], "next week's file missing (it posts late in the week) is not a failure");
});

test("route: cached 5 min; nothing cached when both sources fail; other paths pass", async () => {
  const env = { LAB_STORE: kv() };
  const r = await handleEvents(["intel", "calendar"], req("/intel/calendar"), env, { dispatch, fetchImpl: ff(() => ok(THIS), () => ok(NEXT)), now: NOW });
  assert.equal((await r.json()).events.length, 3);
  assert.ok(env.LAB_STORE.m.has(EVENTS_CACHE_KEY));
  const dead = { LAB_STORE: kv() };
  const d = await handleEvents(["intel", "calendar"], req("/intel/calendar"), dead, { dispatch: async () => new Response("x", { status: 500 }), fetchImpl: async () => new Response("x", { status: 500 }), now: NOW });
  assert.deepEqual((await d.json()).unread, ["macro", "markets"]);
  assert.ok(!dead.LAB_STORE.m.has(EVENTS_CACHE_KEY));
  assert.equal(await handleEvents(["intel", "market"], req("/intel/market"), env, {}), null);
  assert.equal(await handleEvents(["intel", "events"], req("/intel/events"), env, {}), null, "the older Polymarket events corner keeps its path");
  assert.equal(await handleEvents(["intel", "events", "history"], req("/intel/events/history"), env, {}), null);
});

test("index.js routes it through the worker's own handler", () => {
  assert.match(readFileSync(new URL("./index.js", import.meta.url), "utf8"), /handleEvents\(parts, request, env, \{\s*dispatch: \(path\) => worker\.fetch\(/);
});
