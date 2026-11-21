// X-Ray input + recent list + compare table (xrayInput.mjs, xrayCompare.mjs).
// Run: node --test app/lib/xrayInput.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWalletInput, pushRecent, readRecent, walletLabel, RECENT_MAX } from "./xrayInput.mjs";
import { compareRows, compareLine, windowCell, lifetimeCell } from "./xrayCompare.mjs";

const A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const B = "0x802af775033b0b2226c23075d25595b128357d34";

test("the box: addresses, ENS names, and plain-words refusals", () => {
  assert.deepEqual(parseWalletInput(`  ${A} `), { kind: "address", address: A });
  assert.deepEqual(parseWalletInput("Vitalik.eth"), { kind: "name", name: "vitalik.eth" });
  assert.deepEqual(parseWalletInput("@nick.base.eth"), { kind: "name", name: "nick.base.eth" });
  assert.deepEqual(parseWalletInput("brantly.xyz"), { kind: "name", name: "brantly.xyz" });
  assert.equal(parseWalletInput("").kind, "empty");
  assert.equal(parseWalletInput("0x1234").kind, "invalid");
  assert.equal(parseWalletInput("vitalik").kind, "invalid");
  assert.equal(parseWalletInput("a.eth b.eth").kind, "invalid");
  assert.equal(parseWalletInput("eth").kind, "invalid");
  assert.match(parseWalletInput("0x1234").reason, /40 hex/);
});

test("recent: newest first, one per address, capped, keeps an earlier name, drops junk", () => {
  let l = [];
  l = pushRecent(l, { address: A, name: "vitalik.eth", at: 1 });
  l = pushRecent(l, { address: B, at: 2 });
  l = pushRecent(l, { address: A.toLowerCase(), at: 3 });
  assert.deepEqual(l.map((r) => r.at), [3, 2]);
  assert.equal(l[0].name, "vitalik.eth", "a later plain run keeps the name");
  for (let i = 0; i < 20; i++) l = pushRecent(l, { address: "0x" + String(i).padStart(40, "0"), at: 10 + i });
  assert.equal(l.length, RECENT_MAX);
  assert.deepEqual(pushRecent(l, { address: "nope" }), l);
  assert.deepEqual(readRecent("{bad json"), []);
  assert.deepEqual(readRecent(JSON.stringify([{ address: "x" }, { address: A, at: 1 }])).length, 1);
  assert.equal(walletLabel({ address: A, name: "vitalik.eth" }), "vitalik.eth · 0xd8dA…6045");
});

const graded = { key: "30D", status: "GRADED", trades: 40, min: 20, net: 1200, pf: 1.8, winRate: 55 };
const side = (over = {}) => ({ grades: { "7D": { status: "ACCRUING", trades: 3, min: 10 }, "30D": graded, ALL: graded }, track: null, gate: { pass: false, reasons: ["Watched record: 3 graded days, needs 20"] }, hlLifetime: 5000, orderlyRealized: null, openPositions: 2, ...over });

test("compare: each wallet's own numbers, ungraded says how far, unread never 0, no winner", () => {
  assert.equal(windowCell(side(), "7D").text, "3 of 10 trades to grade");
  assert.equal(windowCell(side(), "30D").text, "+$1.2K · PF 1.80 · 55% win · 40 trades");
  assert.equal(windowCell(side(), "30D").tone, "pos");
  assert.equal(windowCell({ unread: true }, "30D").text, "unread");
  assert.equal(lifetimeCell(side({ orderlyRealized: -7000 })).text, "−$2.0K · HL + Orderly");
  const rows = compareRows(side(), side({ unread: true }));
  assert.ok(rows.every((r) => r.b.text === "unread"));
  assert.equal(compareLine(side(), side({ gate: { pass: true, reasons: [] } }), "0xaa…01", "0xbb…02"), "0xbb…02 clears the copy gate; 0xaa…01 doesn’t.");
  assert.equal(compareLine(side(), side()), "Neither clears the copy gate yet.");
  assert.match(compareLine(side(), { unread: true }), /can’t be compared/);
  const src = readFileSync(new URL("./xrayCompare.mjs", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\b(winner|better|beats|proven)\b/i, "no winner words in the table");
});
