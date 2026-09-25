// Runs every *.test.mjs in the repo (app/lib, tools, workers) with node's built-in runner.
// Used by CI (pr-checks.yml + deploy.yml) and locally: `yarn test` / `node tools/run-tests.mjs`.
// Worker tests import their worker's deps (@noble/*, bs58, viem) — run `npm ci` in
// workers/nexus-lab-api, workers/nexus-agent-exec and workers/nexus-carry-engine first.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SKIP = new Set(["node_modules", ".git", "build", "dist", ".cache"]);
const ROOTS = ["app", "tools", "workers"];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r, [])).sort();
if (!files.length) {
  console.error("run-tests: no *.test.mjs files found");
  process.exit(1);
}
console.log(`run-tests: ${files.length} test files`);
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
