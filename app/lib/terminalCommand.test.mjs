// ⌘K command line (app/lib/terminalCommand.mjs). Run: node --test app/lib/terminalCommand.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { terminalCommands, tradePath } from "./terminalCommand.mjs";

test("a known coin leads: its drawer, then a trade", () => {
  for (const q of ["eth", "ETH", "$eth", " Eth "]) {
    const { lead, tail } = terminalCommands(q);
    assert.deepEqual(lead.map((c) => c.intent), [{ kind: "market", coin: "ETH" }, { kind: "trade", coin: "ETH" }], q);
    assert.deepEqual(tail, []);
  }
  assert.deepEqual(terminalCommands("spx500").lead[0].intent, { kind: "market", coin: "SPX500" });
});

test("an unknown ticker-shaped word is offered after the menu's own matches", () => {
  const { lead, tail } = terminalCommands("agent");
  assert.deepEqual(lead, []);
  assert.deepEqual(tail.map((c) => c.id), ["market:AGENT", "trade:AGENT"]);
});

test("an address opens its X-Ray, nothing else", () => {
  const a = "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00";
  const { lead, tail } = terminalCommands(a);
  assert.deepEqual(lead.map((c) => c.intent), [{ kind: "xray", address: a }]);
  assert.equal(lead[0].label, "X-Ray 0xecb6…2b00");
  assert.deepEqual(tail, []);
});

test("news and wire are words, not coins first", () => {
  assert.equal(terminalCommands("news").lead[0].intent.kind, "news");
  assert.equal(terminalCommands("wire").lead[0].intent.kind, "wire");
});

test("nothing for empty, odd or too-long input", () => {
  for (const q of ["", "   ", "e", "eth usd", "x".repeat(11), "1inch", "0x12"]) {
    const { lead, tail } = terminalCommands(q);
    assert.equal(lead.length + tail.length, 0, q);
  }
});

test("trade path; the palette runs every intent", () => {
  assert.equal(tradePath("eth"), "/perp/PERP_ETH_USDC");
  const src = readFileSync(new URL("../pages/lab/CommandPalette.tsx", import.meta.url), "utf8");
  for (const k of ["market", "trade", "xray", "news", "wire"]) assert.ok(src.includes(`"${k}"`), k);
  assert.match(src, /terminalCommands\(query\)/);
});

test("an ENS name opens its X-Ray by name; the page resolves it", () => {
  const { lead } = terminalCommands("Vitalik.eth");
  assert.deepEqual(lead.map((c) => c.intent), [{ kind: "xray", name: "vitalik.eth" }]);
  assert.deepEqual(terminalCommands("eth").lead.map((c) => c.intent.kind), ["market", "trade"], "a bare ticker stays a coin");
});
