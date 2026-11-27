// Every lab:* reader pages past KV's 1000-key list() page (kvList.mjs, 2026-11-27).
// Run: node --test workers/nexus-lab-api/kvList.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { listAllKeys } from "./kvList.mjs";

test("no lab-api file reads lab:* with a single list() call (record #1001 would never be graded)", () => {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.(mjs|js)$/.test(f) && !f.endsWith(".test.mjs"));
  const bad = files.filter((f) => /\.list\(\{\s*prefix:\s*"lab:"\s*\}\)/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(bad, []);
});

test("listAllKeys follows the cursor to the end and stops on a store that doesn't page", async () => {
  const keys = Array.from({ length: 2500 }, (_, i) => ({ name: `lab:${i}` }));
  const paged = { async list({ cursor }) { const from = Number(cursor || 0); const page = keys.slice(from, from + 1000); const done = from + 1000 >= keys.length; return { keys: page, list_complete: done, cursor: done ? undefined : String(from + 1000) }; } };
  assert.equal((await listAllKeys(paged, "lab:")).length, 2500);
  const plain = { async list() { return { keys: keys.slice(0, 3) }; } }; // test fakes return no list_complete
  assert.equal((await listAllKeys(plain, "lab:")).length, 3);
});
