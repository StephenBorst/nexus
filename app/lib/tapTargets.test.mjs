// Small touch rules from borst's phone (2026-11-21): a trader's avatar or name opens their profile wherever a call or a
// rank row shows them, and a scrolling chip row keeps room between its chips and its scrollbar on a phone.
// Run: node --test app/lib/tapTargets.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("feed card + ranks row: avatar and name open the profile, without expanding the row", () => {
  const f = src("../pages/feed/index.tsx");
  const link = f.slice(f.indexOf("function ProfileLink"), f.indexOf("function Avatar"));
  assert.match(link, /\/feed\/trader\/\$\{wallet\}/);
  assert.match(link, /e\.stopPropagation\(\)/, "a tap on the name never also toggles the rank row");
  assert.match(link, /<a href=\{to\}/, "a real link: long-press and new tab work");
  assert.ok((f.match(/<ProfileLink wallet=\{thesis\.wallet\}/g) || []).length === 2, "feed card: avatar + name");
  assert.ok((f.match(/<ProfileLink wallet=\{trader\.wallet\}/g) || []).length === 2, "ranks row: avatar + name");
  assert.match(f, /thesis\.agent\s*\?\s*<Avatar/, "an agent row has no profile to open");
  const t = src("../pages/thesis/index.tsx");
  assert.match(t, /aria-label=\{`Open \$\{traderName\}’s profile`\}[\s\S]{0,300}<Avatar/, "the call page's avatar opens the profile too");
});

test("scrolling chip rows keep a gap above their scrollbar on a phone", () => {
  const theme = src("../config/theme.ts");
  assert.match(theme, /export const CHIP_SCROLL_GAP = (\d+);/);
  assert.ok(Number(theme.match(/CHIP_SCROLL_GAP = (\d+)/)[1]) >= 8);
  for (const p of ["../pages/lab/TheWire.tsx", "../pages/lab/NewsWire.tsx"]) {
    assert.match(src(p), /paddingBottom: isMobile \? CHIP_SCROLL_GAP : 2/, p);
  }
});
