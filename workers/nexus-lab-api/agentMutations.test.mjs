// CLAUDE.md: "A new mutation without requireOwner is a bug." Every POST/PUT/DELETE/PATCH route in the
// /agent/:address block must call requireOwner (walletSig or a trading session, agentAuth.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("every /agent/:address mutation checks the owner", () => {
  const start = src.indexOf('if (parts[0] === "agent" && parts[1]) {');
  const end = src.indexOf("// ── /agents/leaderboard", start);
  assert.ok(start > 0 && end > start, "agent block found");
  const blk = src.slice(start, end);
  const re = /if \(request\.method === "(POST|PUT|DELETE|PATCH)"[^\n]*/g;
  const routes = [...blk.matchAll(re)];
  assert.ok(routes.length >= 15, `found ${routes.length} mutation routes`);
  const missing = routes.filter((m, i) => {
    const body = blk.slice(m.index, routes[i + 1]?.index ?? blk.length);
    return !/await requireOwner\(\w+\)/.test(body);
  }).map((m) => m[0].slice(0, 100));
  assert.deepEqual(missing, []);
});
