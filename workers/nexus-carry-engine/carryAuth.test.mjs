import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carryAdminOk, CARRY_TOKEN_MIN } from "./carryAuth.mjs";

const TOKEN = "s3cret-carry-admin-token-42";

test("no secret configured = nobody gets in (it used to be everybody)", () => {
  for (const tok of [undefined, null, "", "short"]) {
    assert.equal(carryAdminOk(TOKEN, tok), false, String(tok));
    assert.equal(carryAdminOk("", tok), false, `empty header vs ${tok}`);
    assert.equal(carryAdminOk(undefined, tok), false);
  }
  assert.equal(CARRY_TOKEN_MIN, 16);
});

test("the exact token gets in; anything else doesn't", () => {
  assert.equal(carryAdminOk(TOKEN, TOKEN), true);
  for (const h of [null, undefined, "", TOKEN.slice(0, -1), TOKEN + "x", TOKEN.toUpperCase(), " " + TOKEN, "x".repeat(TOKEN.length)]) {
    assert.equal(carryAdminOk(h, TOKEN), false, String(h));
  }
});

test("every POST ops route checks it, before doing anything", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /const authed = \(req, env\) => carryAdminOk\(req\.headers\.get\("x-carry-token"\), env\.CARRY_ADMIN_TOKEN\);/);
  assert.doesNotMatch(src, /!need \|\|/, "the fail-open rule is gone");
  const routes = ["/carry/tick", "/carry/live/tick", "/carry/kill", "/carry/unkill", "/carry/reset"];
  for (const r of routes) {
    const i = src.indexOf(`url.pathname === "${r}" && req.method === "POST"`);
    assert.ok(i > 0, r);
    const body = src.slice(i, src.indexOf("\n      }", i));
    assert.match(body, /if \(!authed\(req, env\)\) return json\(\{ error: "unauthorized" \}, 401\);/, r);
  }
  // every POST route in the file is one of those
  const posts = [...src.matchAll(/url\.pathname === "([^"]+)" && req\.method === "POST"/g)].map((m) => m[1]);
  assert.deepEqual(posts.sort(), [...routes].sort());
});
