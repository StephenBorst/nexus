// Lint ratchet — same idea as check-palette.mjs. Runs eslint on the repo and compares the
// error count PER RULE with tools/lint-baseline.json (the legacy debt, ~325 style/a11y errors
// at add-time). A PR fails only if it ADDS errors to a rule, or reintroduces a ZERO rule.
// Fixing old ones is always allowed; `--update` rewrites the baseline, and only downward.
//
//   node tools/check-lint.mjs            # CI (pr-checks.yml)
//   node tools/check-lint.mjs --update   # after a cleanup, lock the lower counts in
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Rules that catch crash-class bugs (undefined names, hooks after an early return). No baseline:
// any occurrence fails. Both were cleaned to 0 on 2026-09-25.
const ZERO_RULES = ["no-undef", "react-hooks/rules-of-hooks"];
const BASELINE = "tools/lint-baseline.json";

const run = spawnSync(process.execPath, ["node_modules/eslint/bin/eslint.js", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
let report;
try { report = JSON.parse(run.stdout); } catch {
  console.error("check-lint: eslint did not return JSON\n" + (run.stderr || "").slice(0, 2000));
  process.exit(1);
}

const counts = {};
const where = {};
for (const file of report) {
  for (const m of file.messages) {
    if (m.severity !== 2) continue;
    const rule = m.ruleId || "(parse error)";
    counts[rule] = (counts[rule] || 0) + 1;
    (where[rule] ||= []).push(`${file.filePath.replace(process.cwd() + "/", "")}:${m.line}`);
  }
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const failures = [];
for (const rule of ZERO_RULES) {
  if (counts[rule]) failures.push(`${rule}: ${counts[rule]} (must be 0)\n    ${where[rule].slice(0, 10).join("\n    ")}`);
}
for (const [rule, n] of Object.entries(counts)) {
  if (ZERO_RULES.includes(rule)) continue;
  const allowed = baseline[rule] ?? 0;
  if (n > allowed) failures.push(`${rule}: ${n} (baseline ${allowed}) — new errors, see eslint output for the file`);
}

if (process.argv.includes("--update")) {
  const next = {};
  for (const [rule, allowed] of Object.entries(baseline)) {
    const n = Math.min(counts[rule] || 0, allowed);
    if (n > 0) next[rule] = n;
  }
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
  console.log(`check-lint: baseline updated (${Object.values(next).reduce((a, b) => a + b, 0)} legacy errors)`);
}

if (failures.length) {
  console.error("✗ lint ratchet failed:\n  " + failures.join("\n  "));
  process.exit(1);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`✓ no new lint errors (${total} legacy, baseline ${base}${total < base ? " — run --update to lock the drop" : ""})`);
