// A read that lands after the page moved on must not write onto the new page (2026-11-21). The call page and the
// trader profile both re-read when the route's wallet / id changes; tapping from one to the next before the first
// read landed used to put the first one's data on the second's page. Each guards its writes with `live`.
// Run: node --test app/lib/staleReads.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const effect = (src, head, deps) => {
  const a = src.indexOf(head);
  assert.ok(a >= 0, `effect not found: ${head}`);
  return src.slice(a, src.indexOf(deps, a) + deps.length);
};

test("call page: the first read of a call can't land on another call", () => {
  const e = effect(read("../pages/thesis/index.tsx"), "if (!wallet || !id) return;\n    // Moving", "}, [wallet, id]);");
  assert.match(e, /let live = true/);
  assert.match(e, /return \(\) => \{ live = false; \}/);
  assert.match(e, /if \(!live\) return null;\n\s+if \(r\.status === 404\)/, "the 404 branch sits behind the guard");
  assert.match(e, /\.then\(\(data\) => \{ if \(!live\) return;/);
  assert.match(e, /\.catch\(\(\) => \{ if \(live\) setNotFound\(true\); \}\)/);
  assert.match(e, /\.finally\(\(\) => \{ if \(live\) setLoading\(false\); \}\)/);
});

test("trader profile: one trader's record can't land on another's page", () => {
  const e = effect(read("../pages/trader/index.tsx"), "if (!wallet) return;\n    // Tapping", "}, [wallet]);");
  assert.match(e, /let live = true/);
  assert.match(e, /return \(\) => \{ live = false; \}/);
  assert.match(e, /if \(live\) setTheses/);
  assert.match(e, /live && setAgentRec/);
  assert.match(e, /live && setPubStrats/);
  assert.match(e, /if \(!live\) return;\n\s+setMerit/);
});

test("sim status poll: a read that lands after the run was replaced writes nothing", () => {
  const src = read("../pages/lab/Simulate.tsx");
  assert.match(src, /wargame\/status[^\n]+\n\s+if \(stop\) return;/);
});
