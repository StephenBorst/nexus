// public/_redirects must 200-rewrite every route the router in app/main.tsx serves; anything else
// gets public/404.html with a real 404 (Search Console Soft 404, 2026-10-19). A route the router
// has but _redirects lacks would still render (404.html is the app) but answer 404 to crawlers.
// Run: node --test app/lib/appRoutes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// The router's paths, flattened: top-level `path: 'x'` with nested `{ path: 'y' }` children.
function routerPaths() {
  const src = read("../main.tsx");
  const start = src.indexOf("createBrowserRouter(");
  assert.ok(start > 0, "main.tsx: createBrowserRouter not found");
  const body = src.slice(start);
  const out = new Set();
  // Walk the text tracking the current top-level parent: a `path:` on a line indented 8 spaces is
  // a parent under "/", 10+ is a child of the last parent. '/mini' sits at the top level.
  let parent = "";
  for (const line of body.split("\n")) {
    const m = line.match(/^(\s*)(?:\{\s*)?path:\s*'([^']*)'/);
    if (!m) continue;
    const indent = m[1].length, p = m[2];
    if (p === "*" || p === "/") continue;
    if (p.startsWith("/")) { out.add(p); parent = p; continue; }
    if (indent <= 8) { parent = `/${p}`; out.add(parent); }
    else out.add(`${parent}/${p}`);
  }
  return out;
}

function redirectRules() {
  return read("../../public/_redirects").split("\n").filter((l) => l.startsWith("/")).map((l) => l.trim().split(/\s+/));
}

test("every router path has a 200 rewrite to / (and a trailing-slash twin)", () => {
  const rules = redirectRules();
  const sources = new Set(rules.map((r) => r[0]));
  const paths = routerPaths();
  assert.ok(paths.size >= 25, `parsed only ${paths.size} router paths — parser broke?`);
  for (const p of paths) {
    const src = p.replace(/:(\w+)/g, ":$1");
    assert.ok(sources.has(src), `router path ${p} has no rule in public/_redirects`);
    assert.ok(sources.has(`${src}/`), `router path ${p} has no trailing-slash rule`);
  }
  for (const s of sources) {
    const bare = s.replace(/\/$/, "");
    assert.ok(paths.has(bare), `_redirects rule ${s} matches no router path (stale?)`);
  }
});

test("every rule rewrites to \"/\" with 200 (\"/index.html\" would 308 to the home page)", () => {
  for (const [src, to, code] of redirectRules()) {
    assert.equal(to, "/", `${src} → ${to}`);
    assert.equal(code, "200", `${src} status ${code}`);
  }
});

test("the build writes 404.html from index.html", () => {
  const vite = read("../../vite.config.ts");
  assert.match(vite, /function notFoundPage\(\)/);
  assert.match(vite, /notFoundPage\(\),/);
});
