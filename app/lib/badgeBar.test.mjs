// The CLEARED bar v2 (docs/research/badge-bar-v2.md), signed by borst in session 2026-11-20 at 90%: the text above
// Results is pinned. A change is a new dated page, never an edit to this one. The bar itself is built in its own PR.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BADGE_BAR_V2_SHA256 = "2e1cd891abfa61654e1e1a4d1419ff65cb62ddf3da23ac9b8fcc2b61e753c269";

test("the signed badge-bar v2 page is pinned above Results, at 90%", () => {
  const doc = readFileSync(new URL("../../docs/research/badge-bar-v2.md", import.meta.url), "utf8");
  const above = doc.slice(0, doc.indexOf("## Results"));
  assert.equal(createHash("sha256").update(above).digest("hex"), BADGE_BAR_V2_SHA256);
  assert.match(above, /beats at least \*\*90%\*\* of the replay means/);
  assert.match(above, /- Signed: borst, in session, Nov 20, 2026/);
});
