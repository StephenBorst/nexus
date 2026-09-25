// Run: node --test workers/nexus-lab-api/keyProxy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { keyProxyOriginOk, makeRateLimiter } from "./keyProxy.mjs";

test("origin gate: our app origins pass; others, missing, look-alikes and http previews fail", () => {
  assert.equal(keyProxyOriginOk("https://trade.nexustradinglabs.com"), true);
  assert.equal(keyProxyOriginOk("https://nexus-trading-lab.pages.dev"), true);
  assert.equal(keyProxyOriginOk("https://abc123.nexus-trading-lab.pages.dev"), true);
  assert.equal(keyProxyOriginOk("http://localhost:5173"), true);
  for (const bad of ["", null, "https://evil.com", "https://evilnexus-trading-lab.pages.dev", "https://nexus-trading-lab.pages.dev.evil.com", "http://abc.nexus-trading-lab.pages.dev", "not a url"]) {
    assert.equal(keyProxyOriginOk(bad), false, String(bad));
  }
});

test("rate limiter: allows `limit` per window per key, then blocks, then resets", () => {
  const over = makeRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([over("a", 0), over("a", 1), over("a", 2), over("a", 3)], [false, false, false, true]);
  assert.equal(over("b", 3), false, "keys are independent");
  assert.equal(over("a", 1000), false, "new window");
});
