// Run: node --test app/lib/lastCopy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readLastCopy, writeLastCopy, LAST_COPY_MAX_AGE_MS } from "./lastCopy.mjs";

const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const NOW = 1_800_000_000_000;

test("a kept board comes back with its own builtAt (the screen prints that age); too old, future-dated or invalid = none", () => {
  const s = mem();
  assert.equal(writeLastCopy("w", { builtAt: NOW - 600_000, rows: [1] }, { storage: s, valid: (b) => Array.isArray(b.rows) }), true);
  assert.deepEqual(readLastCopy("w", { now: NOW, storage: s }), { builtAt: NOW - 600_000, rows: [1] });
  assert.equal(readLastCopy("w", { now: NOW + LAST_COPY_MAX_AGE_MS, storage: s }), null, "older than 6h is not drawn");
  s.setItem("f", JSON.stringify({ builtAt: NOW + 3600_000, rows: [] }));
  assert.equal(readLastCopy("f", { now: NOW, storage: s }), null);
  assert.equal(readLastCopy("w", { now: NOW, storage: s, valid: (b) => b.rows.length > 5 }), null);
  assert.equal(writeLastCopy("e", { error: "x" }, { storage: s }), false, "an error reply is never kept");
  assert.equal(writeLastCopy("e", { builtAt: NOW, rows: [] }, { storage: s, valid: (b) => b.rows.length > 0 }), false);
});

test("broken storage = no copy, never a throw", () => {
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(readLastCopy("w", { storage: bad }), null);
  assert.equal(writeLastCopy("w", { builtAt: NOW }, { storage: bad }), false);
  const s = mem(); s.setItem("w", "{not json");
  assert.equal(readLastCopy("w", { storage: s }), null);
});

test("the Wire and the market table draw their last copy on mount and keep each good read", () => {
  for (const f of ["../pages/lab/TheWire.tsx", "../pages/lab/MarketTable.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /readLastCopy\(/, f);
    assert.match(src, /writeLastCopy\(/, f);
  }
});
