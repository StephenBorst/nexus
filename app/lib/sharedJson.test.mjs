// sharedJson (app/lib/sharedJson.mjs). Run: node --test app/lib/sharedJson.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sharedJson, _clearSharedJson, SHARED_TTL_MS } from "./sharedJson.mjs";

const counter = (body = { ok: 1 }, status = 200) => {
  let n = 0;
  const f = async () => { n++; return new Response(JSON.stringify(body), { status }); };
  return { f, count: () => n };
};

test("two callers at once share one request and get the same JSON", async () => {
  _clearSharedJson();
  const c = counter({ signals: [1] });
  const [a, b] = await Promise.all([sharedJson("u1", { fetchImpl: c.f, now: 0 }), sharedJson("u1", { fetchImpl: c.f, now: 5 })]);
  assert.deepEqual(a, { signals: [1] });
  assert.equal(a, b);
  assert.equal(c.count(), 1);
});

test("the result is reused inside the window and re-read after it", async () => {
  _clearSharedJson();
  const c = counter();
  await sharedJson("u2", { fetchImpl: c.f, now: 0 });
  await sharedJson("u2", { fetchImpl: c.f, now: SHARED_TTL_MS - 1 });
  assert.equal(c.count(), 1);
  await sharedJson("u2", { fetchImpl: c.f, now: SHARED_TTL_MS + 1 });
  assert.equal(c.count(), 2);
});

test("a failure resolves null and isn't cached", async () => {
  _clearSharedJson();
  const bad = counter({}, 503);
  assert.equal(await sharedJson("u3", { fetchImpl: bad.f, now: 0 }), null);
  const good = counter({ x: 1 });
  assert.deepEqual(await sharedJson("u3", { fetchImpl: good.f, now: 1 }), { x: 1 });
  assert.equal(await sharedJson("u4", { fetchImpl: async () => { throw new Error("net"); }, now: 0 }), null);
});

test("Lab home's duplicate reads go through it", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  for (const [f, url] of [
    ["../pages/lab/NexusBriefing.tsx", "/theses/consensus"], ["../pages/lab/NexusBriefing.tsx", "/signals"], ["../pages/lab/NexusBriefing.tsx", "/agents/live"],
    ["../pages/lab/DecisionBoard.tsx", "/theses/consensus"], ["../components/SignalsNavButton.tsx", "/signals"], ["../components/SignalsNavButton.tsx", "/theses/consensus"],
    ["../components/LiveAlerts.tsx", "/agents/live"],
  ]) assert.match(read(f), new RegExp(`sharedJson\\(\`\\$\\{[A-Z_]+\\}${url.replace(/\//g, "\\/")}\``), `${f} ${url}`);
});
