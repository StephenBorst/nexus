// A `const`/`let` read before its declaration RUNS (same block, no function in between) throws a
// ReferenceError, but only when that line executes. tsc refuses it in .ts/.tsx (TS2448); plain JS has
// no such check. That is how the kill switch broke (2026-11-06: exec's kill branch read `config`
// above `const config`, so every kill with an open position threw). This scans every .js/.mjs the
// workers and app ship and fails on any such read. Reads inside a function declared earlier (called
// later) are fine and not flagged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Linter } from "eslint";

function earlyReads(src, file) {
  const linter = new Linter();
  linter.defineRule("tdz-real", { create(ctx) {
    return { "Program:exit"() {
      const out = new Set();
      const visit = (scope) => {
        for (const v of scope.variables) {
          const def = v.defs[0];
          if (!def || def.type !== "Variable") continue;
          const kind = def.parent?.kind;
          if (kind !== "const" && kind !== "let") continue;
          for (const ref of v.references) {
            if (ref.init || ref.identifier.range[0] >= def.name.range[0]) continue;
            let s = ref.from, deferred = false;
            while (s && s !== v.scope) { if (s.type === "function") { deferred = true; break; } s = s.upper; }
            if (deferred || out.has(ref.identifier.range[0])) continue;
            out.add(ref.identifier.range[0]);
            ctx.report({ node: ref.identifier, message: `'${v.name}' is read before its ${kind} declaration` });
          }
        }
        scope.childScopes.forEach(visit);
      };
      visit(ctx.getScope());
    } };
  } });
  return linter.verify(src, { parserOptions: { ecmaVersion: "latest", sourceType: "module" }, rules: { "tdz-real": "error" } }, file);
}

const ROOTS = ["workers", "app", "functions", "tools"];
function walk(dir, acc) {
  let names = [];
  try { names = readdirSync(dir); } catch { return acc; }
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(m?js)$/.test(n) && !/\.test\.mjs$/.test(n)) acc.push(p);
  }
  return acc;
}

test("the scan catches the kill-switch shape", () => {
  const bad = "async function f(k){ if (k) { g(config); } const config = 1; }\nfunction g(){}\n";
  assert.equal(earlyReads(bad, "bad.js").length, 1);
  const ok = "function f(){ return later(); }\nconst later = () => 1;\nf();\n";
  assert.equal(earlyReads(ok, "ok.js").length, 0, "a read inside an earlier function is fine");
});

test("no shipped .js/.mjs reads a const/let before its declaration", () => {
  const files = ROOTS.flatMap((r) => walk(r, []));
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  const hits = [];
  for (const f of files) {
    const msgs = earlyReads(readFileSync(f, "utf8"), f);
    for (const m of msgs) hits.push(`${f}:${m.line} ${m.message || m.ruleId}`);
  }
  assert.deepEqual(hits, []);
});
