// The manifest that ships is the generator's output, so the committed file, the generator and the
// icon files must agree. A hand edit of public/manifest.json fails here instead of being silently
// overwritten on the next deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MANIFEST, manifestJson } from "./manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p));

/** Width/height from a PNG's IHDR chunk, or null if the bytes aren't a PNG. */
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b) || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("public/manifest.json is exactly what the generator writes", () => {
  assert.equal(read("public/manifest.json").toString("utf8"), manifestJson(),
    "public/manifest.json was edited by hand: change tools/manifest/manifest.mjs, then run `yarn tsx scripts/generate-manifest.ts`");
});

test("the generator reads this module and holds no manifest of its own", () => {
  const src = read("scripts/generate-manifest.ts").toString("utf8");
  assert.match(src, /from "\.\.\/tools\/manifest\/manifest\.mjs"/);
  assert.doesNotMatch(src, /background_color|theme_color|icons:/);
});

test("a stable id, and colours = the page's canvas (theme.ts C.canvas, index.html theme-color)", () => {
  assert.equal(MANIFEST.id, "/");
  const theme = read("app/config/theme.ts").toString("utf8");
  const canvas = theme.match(/canvas:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
  assert.ok(canvas, "theme.ts has no canvas token");
  assert.equal(MANIFEST.background_color, canvas);
  assert.equal(MANIFEST.theme_color, canvas);
  const metaTheme = read("index.html").toString("utf8").match(/name="theme-color" content="(#[0-9a-fA-F]{6})"/)?.[1];
  assert.equal(metaTheme, canvas);
});

test("every icon is a real PNG of the size it claims", () => {
  const all = [...MANIFEST.icons, ...MANIFEST.shortcuts.flatMap((s) => s.icons)];
  for (const ic of all) {
    const p = join("public", ic.src);
    assert.ok(existsSync(join(ROOT, p)), `${ic.src} is missing from public/`);
    const size = pngSize(read(p));
    assert.ok(size, `${ic.src} is not a PNG`);
    assert.equal(`${size.w}x${size.h}`, ic.sizes, `${ic.src} is ${size.w}x${size.h}, the manifest says ${ic.sizes}`);
  }
});

test("the maskable icon is its own artwork, not the plain icon reused", () => {
  const maskable = MANIFEST.icons.filter((i) => i.purpose === "maskable");
  assert.equal(maskable.length, 1);
  const plain = new Set(MANIFEST.icons.filter((i) => i.purpose !== "maskable").map((i) => i.src));
  assert.ok(!plain.has(maskable[0].src), "a plain icon used as maskable gets its edges cropped by the launcher");
});
