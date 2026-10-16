#!/usr/bin/env node
// ── Text-contrast guard ───────────────────────────────────────────────────────
// The two border tones (#33333a, #232327) read at ~1.6:1 and ~1.3:1 on the canvas: as TEXT they're
// close to invisible on a phone in daylight. Sixty-odd hints, empty states and timestamps had drifted
// to them. Text uses the ink ladder in app/config/theme.ts instead: bone #f4f4f5 → fog #a1a1aa →
// muted #71717a → faint #52525b (faint for decorative glyphs only).
//
// Scans app/**/*.tsx for `color: "#33333a"` / `color: "#232327"` and `fill="…"` on <text>. Border,
// background and textDecorationColor uses are fine (they aren't text). Zero tolerance outside the
// allowlist. Heuristic: a colour picked in a ternary or a shared style object isn't seen.
//
//   node tools/check-ink.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The mini app is parked (CLAUDE.md "Settled"): left as it is until it's picked up again.
export const ALLOW = new Set(["app/pages/mini/index.tsx"]);

const DIM = "(?:33333a|232327)";
const COLOR_RE = new RegExp(`(?<![A-Za-z])color:\\s*["'\`]#${DIM}["'\`]`, "gi");
const SVG_TEXT_RE = new RegExp(`<text\\b[^>]*\\bfill=["']#${DIM}["']`, "gi");

/** Count dim-text uses in a source string. */
export function countDimInk(src) {
  return (src.match(COLOR_RE) || []).length + (src.match(SVG_TEXT_RE) || []).length;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, out); }
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const root = process.cwd();
  const bad = [];
  for (const f of walk(join(root, "app"))) {
    const rel = relative(root, f).split("\\").join("/");
    if (ALLOW.has(rel)) continue;
    const n = countDimInk(readFileSync(f, "utf8"));
    if (n > 0) bad.push(`${rel}: ${n}`);
  }
  if (bad.length) {
    console.error("Text set to a border tone (#33333a / #232327) — near-invisible on the canvas:");
    for (const b of bad) console.error("  " + b);
    console.error('Use the ink ladder: "#71717a" for hints and empty states, "#52525b" for decorative glyphs.');
    process.exit(1);
  }
  console.log("ink: ok (no text in a border tone)");
}
