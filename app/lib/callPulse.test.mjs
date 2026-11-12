import test from "node:test";
import assert from "node:assert/strict";
import { callPulse, parsePersonFrom, pulseLine, agoShort, PULSE_WINDOW_MS, PULSE_LIST_MAX } from "./callPulse.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const H = 3600000, D = 86400000;
const base = { isPublic: true, symbol: "PERP_ETH_USDC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110 };

test("counts OPEN calls and this week's graded calls; resting orders and invalid calls count nowhere", () => {
  const p = callPulse([{ wallet: "0xA", theses: [
    { ...base, id: "1", fillState: "OPEN" },
    { ...base, id: "2", fillState: "WORKING" },                                   // never filled: not a position
    { ...base, id: "3", stopLoss: 120, fillState: "OPEN" },                        // wrong-side stop: INVALID
    { ...base, id: "4", gradedOutcome: "WIN", gradedR: 2, exitedAt: NOW - 2 * D },
    { ...base, id: "5", gradedOutcome: "LOSS", gradedR: -1, exitedAt: NOW - 8 * D }, // last week
  ] }], NOW);
  assert.equal(p.open, 1);
  assert.equal(p.gradedWeek, 1);
  assert.equal(p.last.outcome, "WIN");
  assert.equal(p.last.symbol, "ETH");
  assert.equal(p.last.path, "/feed/thesis/0xA/4");
});

test("human, public calls only: private, holders-only, copies and the house wallet are left out", () => {
  const graded = { ...base, gradedOutcome: "WIN", gradedR: 1, exitedAt: NOW - H };
  const p = callPulse([
    { wallet: "0xA", theses: [{ ...graded, id: "a", isPublic: false }, { ...graded, id: "b", holdersOnly: true }, { ...graded, id: "c", duplicateOf: "x" }] },
    { wallet: "0xHOUSE", theses: [{ ...graded, id: "h" }, { ...base, id: "h2", fillState: "OPEN" }] },
  ], NOW, { exclude: ["0xhouse"] });
  assert.deepEqual(p, { ...{ open: 0, gradedWeek: 0, last: null, openCalls: [], recentGraded: [] }, engines: { open: 0, gradedWeek: 0, last: null, openCalls: [], recentGraded: [] }, engineRecords: [] });
});

test("people and engines are counted apart; both house wallets are out of both; comma lists split", () => {
  const graded = (id, h = 1) => ({ ...base, id, gradedOutcome: "LOSS", gradedR: -1, exitedAt: NOW - h * H });
  const p = callPulse([
    { wallet: "0xPerson", theses: [{ ...base, id: "p1", fillState: "OPEN", filledAt: NOW - 2 * H }, graded("p2", 30 * 24)] },
    { wallet: "0xEMBER", theses: [graded("e1", 1), graded("e2", 2), { ...base, id: "e3", fillState: "OPEN" }] },
    { wallet: "0xVariant", theses: [graded("v1", 3)] },
    { wallet: "0xHouse", theses: [graded("h1", 1)] },
    { wallet: "0xCatalyst", theses: [{ ...base, id: "c1", fillState: "OPEN" }] },
  ], NOW, { exclude: ["0xhouse", "0xCATALYST", undefined], engines: ["0xember,0xvariant", undefined] });
  // people: the person's own numbers only, quiet week → last grade 30d ago
  assert.equal(p.open, 1);
  assert.equal(p.gradedWeek, 0);
  assert.equal(p.last.wallet, "0xPerson");
  assert.equal(p.openCalls[0].engine, false);
  // engines: their own block, every row tagged
  assert.equal(p.engines.open, 1);
  assert.equal(p.engines.gradedWeek, 3);
  assert.ok([...p.engines.openCalls, ...p.engines.recentGraded].every((r) => r.engine));
  assert.deepEqual(p.engines.recentGraded.map((r) => r.path.split("/").pop()), ["e1", "e2", "v1"]);
  // houses nowhere
  const all = [p, p.engines].flatMap((b) => [...b.openCalls, ...b.recentGraded]);
  assert.equal(all.some((r) => /house|catalyst/i.test(r.wallet)), false);
});

test("a stale grader stamp counts nowhere; resolution falls back to gradedAt; the window edge is inclusive", () => {
  const p = callPulse([{ wallet: "0xA", theses: [
    { ...base, id: "old", gradedOutcome: "WIN", gradeV: 1, exitedAt: NOW - H },
    { ...base, id: "edge", gradedOutcome: "LOSS", gradeV: 2, gradedAt: NOW - PULSE_WINDOW_MS },
  ] }], NOW, { isCurrent: (t) => t.gradeV === 2 });
  assert.equal(p.gradedWeek, 1);
  assert.equal(p.last.path, "/feed/thesis/0xA/edge");
  assert.equal(p.last.r, null);
});

test("the strip line: People and Our engines as labelled segments; quiet week = last grade's age; unread = no claim", () => {
  const eng = { open: 0, gradedWeek: 11, last: { at: NOW - H } };
  const l = pulseLine({ open: 2, gradedWeek: 0, last: { at: NOW - 21 * D }, engines: eng }, NOW);
  assert.deepEqual(l.segments.map((x) => x.label), ["People", "Our engines"]);
  assert.equal(l.segments[0].text, "2 open · last graded 21d ago");
  assert.equal(l.segments[1].text, "0 open · 11 graded this week");
  assert.equal(l.segments[1].short, "11 graded/wk");
  assert.equal(pulseLine({ open: 3, gradedWeek: 2, last: null }, NOW).segments[0].text, "3 open · 2 graded this week");
  // engines with no record at all: no engine segment
  assert.equal(pulseLine({ open: 0, gradedWeek: 0, last: null, engines: { open: 0, gradedWeek: 0, last: null } }, NOW).segments.length, 1);
  assert.equal(pulseLine(null, NOW).segments, null);
  assert.equal(pulseLine({ open: NaN, gradedWeek: 1 }, NOW).segments, null);
});

test("agoShort is coarse", () => {
  assert.equal(agoShort(NOW - 5 * 60000, NOW), "5m");
  assert.equal(agoShort(NOW - 30 * H, NOW), "30h");
  assert.equal(agoShort(NOW - 3 * D, NOW), "3d");
});

test("the Calls panel lists: newest first, capped, open by fill time, graded across all time", () => {
  const theses = [];
  for (let i = 0; i < 5; i++) theses.push({ ...base, id: `o${i}`, fillState: "OPEN", filledAt: NOW - i * H, createdAt: NOW - 99 * H });
  for (let i = 0; i < 5; i++) theses.push({ ...base, id: `g${i}`, gradedOutcome: i % 2 ? "LOSS" : "WIN", gradedR: i % 2 ? -1 : 1.5, exitedAt: NOW - (i * 3) * D - H });
  const p = callPulse([{ wallet: "0xA", theses }], NOW);
  assert.equal(p.open, 5);
  assert.equal(p.openCalls.length, PULSE_LIST_MAX);
  assert.deepEqual(p.openCalls.map((c) => c.path.split("/").pop()), ["o0", "o1", "o2"]);
  assert.deepEqual(p.recentGraded.map((c) => c.path.split("/").pop()), ["g0", "g1", "g2"]);
  assert.equal(p.recentGraded[2].at, NOW - 6 * D - H); // older than the week still listed; the count says the week
  assert.equal(p.gradedWeek, 3);
  assert.deepEqual(p.last, p.recentGraded[0]);
  assert.deepEqual(Object.keys(p.openCalls[0]).sort(), ["at", "direction", "engine", "path", "symbol", "wallet"]);
});

test("engineRecords: each engine's all-time graded record from the grader's own R; people never appear", () => {
  const g = (id, outcome, r, h) => ({ ...base, id, gradedOutcome: outcome, gradedR: r, exitedAt: NOW - h * H });
  const p = callPulse([
    { wallet: "0xEmber", theses: [g("a", "LOSS", -1, 1), g("b", "WIN", 1.5, 50 * 24), g("c", "LOSS", -1, 2), { ...base, id: "o", fillState: "OPEN" }] },
    { wallet: "0xVariant", theses: [g("d", "LOSS", -1, 3)] },
    { wallet: "0xPerson", theses: [g("p", "WIN", 2, 1)] },
  ], NOW, { engines: ["0xember", "0xvariant"] });
  assert.deepEqual(p.engineRecords.map((x) => [x.wallet, x.graded, x.wins, x.netR]), [["0xEmber", 3, 1, -0.5], ["0xVariant", 1, 0, -1]]);
  assert.equal(p.engineRecords[0].lastAt, NOW - H);
});

test("personFrom: an ex-engine wallet counts as a person only for calls published on/after its date; older calls count nowhere", () => {
  const FROM = NOW - 2 * D;
  const g = (id, pub) => ({ ...base, id, gradedOutcome: "WIN", gradedR: 1.5, exitedAt: NOW - H, ...(pub === undefined ? {} : { publishedAt: pub }) });
  const p = callPulse([
    { wallet: "0xApex", theses: [g("old", FROM - 1), g("new", FROM), g("nostamp"), { ...base, id: "o", fillState: "OPEN", publishedAt: FROM + H }] },
  ], NOW, { engines: ["0xapex"], personFrom: [`0xAPEX@${new Date(FROM).toISOString()}`, "junk", "0xbad@notadate"] });
  // people: the one graded call from the date on + the open one; never the old bot call or an unstamped one
  assert.equal(p.gradedWeek, 1);
  assert.deepEqual(p.recentGraded.map((c) => c.path.split("/").pop()), ["new"]);
  assert.equal(p.open, 1);
  assert.ok([...p.openCalls, ...p.recentGraded].every((r) => r.engine === false));
  // personFrom wins over the engine list: nothing lands in the engine block or the engine records
  assert.deepEqual([p.engines.open, p.engines.gradedWeek, p.engineRecords.length], [0, 0, 0]);
});

test("parsePersonFrom: comma list of addr@ISO, lowercased; bad entries dropped", () => {
  const m = parsePersonFrom(["0xA@2026-11-08T00:00:00Z, 0xb@x", undefined, "nope"]);
  assert.deepEqual([...m.entries()], [["0xa", Date.parse("2026-11-08T00:00:00Z")]]);
});
