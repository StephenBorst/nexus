#!/usr/bin/env node
// ── Button-style ratchet ──────────────────────────────────────────────────────
// Buttons speak in the UI face, sentence case (docs/brand.md). Mono caps are for labels.
// The app grew hundreds of hand-typed `<button style={{ fontFamily: MONO, … }}>` because
// every surface styled its own; the shared pieces in app/components/ui (Button, Pill, Tabs)
// and the global .nx-btn class are the fix. This guard stops new ones creeping back in.
//
// It scans app/**/*.tsx for <button …>, <a …> and <Link …> opening tags whose inline style sets a
// MONO font, counts them per file, and compares with tools/ui-baseline.json:
//   - a file whose count GROWS fails the check (a new file starts at 0);
//   - legacy counts are grandfathered — shrink them as pages move to the shared pieces.
// Heuristic by design: a style object defined elsewhere (style={btn}) isn't seen. It exists
// to catch the common copy-paste, not to be a parser.
//
//   node tools/check-ui.mjs                   # check (exit 1 on growth)
//   node tools/check-ui.mjs --update-baseline # record current counts (only ever lower them)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "app");
const BASELINE = join(ROOT, "tools/ui-baseline.json");

// Every way the mono face is named in app/ (MONO, MF, mono, FONT.mono, the raw var).
const MONO_FONT = /fontFamily:\s*(?:(?:MONO|MF|mono|FONT\.mono)\b|["'`]var\(--nx-font-mono)/;

// The opening tag starting at `i` (at "<"), up to its closing ">" outside any { }.
export function openingTag(src, i) {
  let depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === '"') { const k = src.indexOf('"', j + 1); if (k < 0) return null; j = k; }
    else if (depth === 0 && ch === ">") return src.slice(i, j + 1);
  }
  return null;
}

// Count <button>/<a> tags in a source string whose inline style uses the mono face.
export function countMonoButtons(src) {
  let n = 0;
  const re = /<(button|a|Link)(?=[\s>])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = openingTag(src, m.index);
    if (tag && MONO_FONT.test(tag)) n++;
  }
  return n;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, out); }
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function scan() {
  const counts = {};
  for (const f of walk(SCAN_DIR)) {
    const n = countMonoButtons(readFileSync(f, "utf8"));
    if (n > 0) counts[relative(ROOT, f)] = n;
  }
  return counts;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const counts = scan();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes("--update-baseline")) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`✓ ui baseline written: ${total} mono-styled buttons across ${Object.keys(counts).length} files`);
    process.exit(0);
  }
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const grew = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0));
  if (grew.length) {
    console.log("✗ new mono-styled buttons (buttons use the UI face, sentence case — docs/brand.md):\n");
    for (const [f, n] of grew) console.log(`  ${f}: ${n} (baseline ${base[f] ?? 0})`);
    console.log("\nUse <Button>/<Pill>/<Tabs> from app/components/ui or className=\"nx-btn\" instead.");
    process.exit(1);
  }
  const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
  const shrunk = baseTotal - total;
  console.log(`✓ no new mono-styled buttons (${total} legacy${shrunk > 0 ? `, ${shrunk} below baseline — run with --update-baseline to lock that in` : ""})`);
}
