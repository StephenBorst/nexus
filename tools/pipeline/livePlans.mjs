#!/usr/bin/env node
// Writes app/lib/livePlanText.mjs: each live plan's text above "## Sign-off" and its sha256, so lab-api and /ops can
// show and verify the exact page the owner signs (app/lib/livePlanSign.mjs). Run after editing a live plan page:
//   node tools/pipeline/livePlans.mjs --write
// livePlanSign.test.mjs fails if the module and the pages disagree.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LIVE_PLANS, planAboveSignoff } from "../../app/lib/livePlanSign.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function livePlanModule(read = (p) => readFileSync(resolve(ROOT, p), "utf8")) {
  const rows = Object.entries(LIVE_PLANS).sort(([a], [b]) => a.localeCompare(b)).map(([axis, { doc }]) => {
    const text = planAboveSignoff(read(doc));
    if (!text) throw new Error(`${doc} has no "## Sign-off" heading`);
    const sha256 = createHash("sha256").update(text).digest("hex");
    return `  ${axis}: Object.freeze({ doc: ${JSON.stringify(doc)}, sha256: ${JSON.stringify(sha256)}, text: ${JSON.stringify(text)} }),`;
  });
  return "// WRITTEN BY tools/pipeline/livePlans.mjs from each live plan page (its text above \"## Sign-off\"). Do not edit by hand:\n"
    + "// edit the page, then run `node tools/pipeline/livePlans.mjs --write`. livePlanSign.test.mjs pins the two together.\n\n"
    + `export const LIVE_PLAN_TEXT = Object.freeze({\n${rows.join("\n")}\n});\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = livePlanModule();
  const out = resolve(ROOT, "app/lib/livePlanText.mjs");
  if (process.argv.includes("--write")) { writeFileSync(out, src); console.log(`wrote ${out}`); }
  else console.log(src.slice(0, 400));
}
