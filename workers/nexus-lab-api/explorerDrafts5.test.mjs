// Batch-5 explorer DRAFTS (docs/research/scanner-reads-prereg.md). Settled 2026-11-16: both reads signed and moved to
// explorerReads.mjs (their behaviour tests moved to explorerReads.test.mjs). A new draft here stays off the scoreboard. Run: node --test workers/nexus-lab-api/explorerDrafts5.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRAFT_GENS_5, DRAFT_READS_5 } from "./explorerDrafts5.mjs";
import { AXES } from "./axisbt.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";


test("drafts are not graded: off the scoreboard, unregistered, and nothing else imports them", () => {
  const graded = new Set(AXES.map((a) => a.name)), registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const n of Object.keys(DRAFT_GENS_5)) {
    assert.ok(!graded.has(n), `${n} is on the scoreboard before it is registered`);
    assert.ok(!registered.has(n), `${n} is registered: move it out of the drafts file in the registration PR`);
  }
  for (const f of ["./axisbt.mjs", "./index.js", "./explorerReads.mjs", "../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /explorerDrafts5/, `${f} must not import the drafts`);
  }
  assert.deepEqual(DRAFT_READS_5.map((r) => r.name), []); // batch 5 settled 2026-11-16: both signed, moved to explorerReads.mjs
});

