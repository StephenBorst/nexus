import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runWeekly, handleWeekly, WEEKLY_KEY, WEEKLY_INDEX, WEEKLY_RUN_MINUTE, sha256hex } from "./weeklyScorecard.mjs";

// The weekly scorecard job (borst 2026-11-16): built once per week from stored data, never rewritten, served byte for byte.
function kv(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}
const SC = "axisbt:test:min20";
const board = { asOf: "2026-11-16T18:53:49Z", tide: { from: "2026-08-07T16:00:00Z", LONG: { meanR: -0.18 }, SHORT: { meanR: 0.2 } }, axes: [{ name: "level_reclaim", oos: null }],
  pipeline: { reads: [{ axis: "level_reclaim", stage: "REGISTERED", numbers: { events: 99, meanR: 0.12 }, paperWallet: "0x95e26E980e300C34360933b849457F42c6Bd7622" }] } };
const now = Date.parse("2026-11-16T20:29:00Z");
const noLock = (_k, fn) => fn();

function env() {
  return {
    LAB_STORE: kv({ [SC]: JSON.stringify(board), "lab:0x1111111111111111111111111111111111111111": JSON.stringify({ theses: [{ isPublic: true, gradedOutcome: "WIN", gradedR: 1.5, exitedAt: Date.parse("2026-11-12T00:00:00Z"), gradeV: 999 }] }) }),
    NEXUS_AGENT: kv({ "agent:state:0x95e26e980e300c34360933b849457f42c6bd7622": JSON.stringify({ paper_agg: { trades: 8 }, paper_trades: [{ closed_at: "2026-11-14T00:00:00Z", reason: "SL" }] }) }),
  };
}

test("builds the last complete week once, indexes its sha256, never rewrites it", async () => {
  const e = env();
  const r = await runWeekly(e, { now, scorecardKey: SC, lock: noLock });
  assert.equal(r.week, "2026-11-09");
  assert.equal(r.written, true);
  const text = e.LAB_STORE.m.get(WEEKLY_KEY("2026-11-09"));
  assert.equal(r.sha256, createHash("sha256").update(text).digest("hex"));
  const snap = JSON.parse(text);
  assert.equal(snap.paper[0].closedWeek, 1);
  assert.equal(snap.paper[0].trades, 8);
  assert.deepEqual(JSON.parse(e.LAB_STORE.m.get(WEEKLY_INDEX)).map((x) => x.week), ["2026-11-09"]);
  // A later run the same week, with a different board: the stored week stays byte for byte.
  e.LAB_STORE.m.set(SC, JSON.stringify({ ...board, asOf: "2026-11-17T00:00:00Z" }));
  assert.equal((await runWeekly(e, { now: now + 3_600_000, scorecardKey: SC, lock: noLock })).skipped, "done");
  assert.equal(e.LAB_STORE.m.get(WEEKLY_KEY("2026-11-09")), text);
});

test("no board = no week written (it waits for the next run)", async () => {
  const e = env(); e.LAB_STORE.m.delete(SC);
  assert.equal((await runWeekly(e, { now, scorecardKey: SC, lock: noLock })).skipped, "board_unread");
  assert.equal(e.LAB_STORE.m.get(WEEKLY_KEY("2026-11-09")), undefined);
});

test("the route: the index + latest, and each week's stored bytes with their hash; GET only", async () => {
  const e = env();
  await runWeekly(e, { now, scorecardKey: SC, lock: noLock });
  const req = (path, method = "GET") => new Request(`https://og.example${path}`, { method });
  const list = await handleWeekly(["proof", "weekly"], req("/proof/weekly"), e);
  const body = await list.json();
  assert.equal(body.weeks[0].week, "2026-11-09");
  assert.equal(body.latest.week, "2026-11-09");
  const one = await handleWeekly(["proof", "weekly", "2026-11-09"], req("/proof/weekly/2026-11-09"), e);
  const bytes = await one.text();
  assert.equal(bytes, e.LAB_STORE.m.get(WEEKLY_KEY("2026-11-09")));
  assert.equal(one.headers.get("X-Content-SHA256"), body.weeks[0].sha256);
  assert.equal(await sha256hex(bytes), body.weeks[0].sha256, "anyone can hash the bytes and match the index");
  assert.equal((await handleWeekly(["proof", "weekly", "2026-11-02"], req("/proof/weekly/2026-11-02"), e)).status, 404);
  assert.equal((await handleWeekly(["proof", "weekly", "x"], req("/proof/weekly/x"), e)).status, 400);
  assert.equal((await handleWeekly(["proof", "weekly"], req("/proof/weekly", "POST"), e)).status, 405);
  assert.equal(await handleWeekly(["calls", "pulse"], req("/calls/pulse"), e), null);
});

test("wired: hourly on its own minute, writes only proof:weekly:*, a lock on the write", () => {
  const idx = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(idx, /minute === WEEKLY_RUN_MINUTE/);
  assert.match(idx, /handleWeekly\(parts, request, env\)/);
  assert.ok(![17, 41, 47, 49, 53].includes(WEEKLY_RUN_MINUTE));
  const src = readFileSync(new URL("./weeklyScorecard.mjs", import.meta.url), "utf8");
  const puts = [...src.matchAll(/\.put\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(puts, ["WEEKLY_KEY(week.week)", "WEEKLY_INDEX"]);
  assert.match(src, /LOCK_KEYS\.proofWeekly/);
});
