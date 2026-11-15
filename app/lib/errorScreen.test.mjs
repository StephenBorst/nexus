import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The screen a person sees when a page throws (app/components/ErrorBoundary.tsx, the routes'
// errorElement). It was the template's developer dump: a red "Unexpected Application Error!",
// the stack, a "Developer Information" box and the full URL unbroken (the page scrolled sideways
// on a phone). Now: plain words, nothing moved, Reload / Go home / Copy error details, the
// details folded, every line wrapping.
const src = readFileSync(new URL("../components/ErrorBoundary.tsx", import.meta.url), "utf8");

test("the error screen speaks to a person, not a developer", () => {
  assert.doesNotMatch(src, /Unexpected Application Error!/);
  assert.doesNotMatch(src, /Developer Information/);
  assert.doesNotMatch(src, /URL: \{window\.location\.href\}/, "the full URL (query and all) is not printed raw");
  assert.match(src, /This page hit an error\./);
  assert.match(src, /A screen error moves no money/);
  for (const b of [">Reload<", ">Go home<", ">Copy error details<"]) assert.ok(src.includes(b), b);
});

test("everything on it wraps at phone width", () => {
  assert.match(src, /overflowWrap: 'anywhere' \}\}>\s*<div aria-hidden/);
  assert.match(src, /whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'/);
  assert.match(src, /<details style=\{\{ marginTop: 18 \}\}>/, "the stack is folded");
});

test("the stale-chunk self-heal is kept", () => {
  assert.match(src, /const canSelfHeal = isModuleImportError/);
  assert.match(src, /Updating Nexus to the latest version/);
});
