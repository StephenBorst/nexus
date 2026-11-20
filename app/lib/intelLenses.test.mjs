// Lab home's deep boards (app/lib/intelLenses.mjs): no chip strip; each board opens from the Wire or the market table.
// Run: node --test app/lib/intelLenses.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTEL_LENSES, lensFromQuery, initialBoard, toggleBoard, boardById, boardsAt, boardForColumn } from "./intelLenses.mjs";
import { TABLE_COLUMNS } from "./marketTable.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("nine boards, unique ids (old ?lens= links still land), each with a home", () => {
  assert.deepEqual(INTEL_LENSES.map((l) => l.id), ["news", "funding", "venues", "positioning", "catalysts", "calendar", "forecast", "qsignals", "tape"]);
  for (const l of INTEL_LENSES) assert.ok(["wire", "table"].includes(l.home), l.id);
  assert.deepEqual(boardsAt("wire").map((l) => l.id), ["news", "catalysts", "calendar"]);
});

test("every column-backed board points at a real table column", () => {
  const cols = new Set(TABLE_COLUMNS.map((c) => c.id));
  for (const l of INTEL_LENSES.filter((x) => x.column)) assert.ok(cols.has(l.column), l.id);
  assert.equal(boardForColumn("funding").id, "funding");
  assert.equal(boardForColumn("gap").id, "venues");
  assert.equal(boardForColumn("news"), null);
});

test("a link opens a board; a plain visit opens none (the Wire leads)", () => {
  assert.equal(initialBoard("TAPE"), "tape");
  assert.equal(initialBoard(" Positioning "), "positioning");
  assert.equal(initialBoard(null), null);
  assert.equal(initialBoard("bogus"), null);
  assert.equal(lensFromQuery(undefined), null);
});

test("opening the open board closes it; another replaces it; an unknown id changes nothing", () => {
  assert.equal(toggleBoard(null, "funding"), "funding");
  assert.equal(toggleBoard("funding", "funding"), null);
  assert.equal(toggleBoard("funding", "tape"), "tape");
  assert.equal(toggleBoard("funding", "x"), "funding");
  assert.equal(boardById("venues").label, "Venues");
});

test("no chip strip is left on Lab home; every board renders, and each opener lives at its home", () => {
  const lab = src("../pages/lab/index.tsx");
  assert.ok(!lab.includes("<IntelLenses"), "the strip is gone");
  for (const l of INTEL_LENSES) if (l.id !== "tape") assert.ok(lab.includes(`id === "${l.id}"`), `board ${l.id} rendered`);
  assert.ok(lab.includes("<MarketIntelView />"), "the market tape is the fallback render");
  const wire = src("../pages/lab/TheWire.tsx"), table = src("../pages/lab/MarketTable.tsx");
  assert.match(wire, /boardsAt\("wire"\)\.map/);           // every wire board gets an opener
  assert.match(wire, /onOpenBoard\("calendar"\)/);          // and the week sits beside "Coming up"
  assert.match(table, /boardsAt\("table"\)/);
  assert.match(table, /boardForColumn\(/);
});
