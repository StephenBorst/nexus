// The registration and the code must say the same thing. Editing the rules in one place and not
// the other is exactly what a pre-registration exists to prevent, so it fails CI.
import test from "node:test";
import assert from "node:assert/strict";
import { PREREG, populationHash } from "./study.mjs";
import { DOC, paramsFromDoc, readRepoFile } from "./run.mjs";
import { STRUCTURE_DEFAULTS } from "../../app/lib/structure.mjs";

const doc = readRepoFile(DOC);
const plain = (x) => JSON.parse(JSON.stringify(x));

test("the registration's parameter block is exactly PREREG", () => {
  assert.deepEqual(paramsFromDoc(doc), plain(PREREG));
});

test("the structure read registered is the one the library runs by default", () => {
  assert.deepEqual(plain(STRUCTURE_DEFAULTS), plain(PREREG.structure));
});

test("the dates in the prose match the parameters", () => {
  assert.equal(PREREG.cutoffMs, Date.UTC(2026, 8, 30));
  assert.match(doc, new RegExp(`\\*\\*Registered ${PREREG.registered}\\.\\*\\*`));
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  assert.equal(iso(PREREG.cutoffMs + PREREG.stage2.windowDays * day), "2026-10-14");
  assert.equal(iso(PREREG.cutoffMs + PREREG.stage2.readNotBeforeDays * day), "2026-10-28");
  assert.match(doc, /2026-09-30 00:00 → 2026-10-14 00:00 UTC/);
  assert.match(doc, /on or after \*\*2026-10-28 00:00 UTC\*\*/);
});

test("the frozen stage-1 population is the registered one", () => {
  const file = JSON.parse(readRepoFile(PREREG.stage1.file));
  assert.equal(file.calls.length, PREREG.stage1.n);
  assert.equal(file.n, PREREG.stage1.n);
  assert.equal(populationHash(file.calls), PREREG.stage1.sha256);
  assert.equal(file.sha256, PREREG.stage1.sha256);
  for (const c of file.calls) {
    assert.ok(c.id.startsWith(PREREG.population.idPrefix), c.id);
    assert.ok(PREREG.population.outcomes.includes(c.gradedOutcome), c.id);
    assert.ok(c.gradeV >= PREREG.population.minGradeV, c.id);
    assert.ok(c.createdAt < PREREG.cutoffMs, c.id);
    assert.ok(c.direction === "LONG" || c.direction === "SHORT", c.id);
    assert.ok(c.entryPrice > 0 && Number.isFinite(c.gradedR), c.id);
  }
  assert.equal(new Set(file.calls.map((c) => c.id)).size, file.calls.length);
});

test("the numbers quoted in the prose match the frozen population", () => {
  const { calls } = JSON.parse(readRepoFile(PREREG.stage1.file));
  const wins = calls.filter((c) => c.gradedOutcome === "WIN").length;
  const meanR = calls.reduce((s, c) => s + c.gradedR, 0) / calls.length;
  assert.match(doc, new RegExp(`Its graded record: ${calls.length} calls, ${wins} wins \\(${Math.round((100 * wins) / calls.length)}%\\), −${Math.abs(meanR).toFixed(2)}R per call`));
  const longs = calls.filter((c) => c.direction === "LONG").length;
  assert.match(doc, new RegExp(`${longs} longs, ${calls.length - longs} shorts`));
});
