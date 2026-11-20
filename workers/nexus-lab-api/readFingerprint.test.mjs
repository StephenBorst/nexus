// Registrations stay frozen by fingerprint (borst 2026-11-20, pipeline-if-then.md "Reads no longer retire"): every
// registered read's events on the fixed tapes hash to its recorded line. Run: node --test workers/nexus-lab-api/readFingerprint.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readFingerprint, tapeSha256, fingerprintTapes } from "./readFingerprint.mjs";
import { READ_FINGERPRINTS, TAPES_SHA256 } from "../../app/lib/readFingerprints.mjs";
import { REGISTERED_READS, ARCHIVED_READS } from "../../app/lib/readPipeline.mjs";

test("the tapes are the recorded tapes", () => {
  assert.equal(tapeSha256(), TAPES_SHA256, "the fingerprint tapes changed: add a second tape set beside them, never edit these");
});

test("every registered read fires on the tapes and matches its recorded fingerprint; no stray entries", () => {
  for (const r of REGISTERED_READS) {
    const rec = READ_FINGERPRINTS[r.axis];
    assert.ok(rec, `${r.axis} has no recorded fingerprint: a new registration records its line in the same PR`);
    const now = readFingerprint(r.axis);
    assert.ok(now.events > 0, `${r.axis} fires nothing on the tapes, so its fingerprint would freeze nothing`);
    assert.equal(now.sha256, rec.sha256, `${r.axis} fires different events than when it was registered: a changed rule is a new read with a new name and date`);
    assert.equal(now.events, rec.events, r.axis);
    assert.match(rec.at, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const k of Object.keys(READ_FINGERPRINTS)) assert.ok(REGISTERED_READS.some((r) => r.axis === k), `${k} is recorded but not registered`);
});

test("the fingerprint sees a rule change: a shifted, a dropped or a flipped event moves the hash", () => {
  // Same machinery on a doctored generator: the hash is over every event's time and side, nothing else.
  const base = readFingerprint("level_reclaim").sha256;
  const t = fingerprintTapes();
  assert.ok(t.length >= 3 && t.every((x) => x.cs.candleHist.length >= 3000), "wide tapes");
  assert.notEqual(readFingerprint("level_reclaim_tight").sha256, base, "a filtered read (a subset of the parent's events) hashes apart");
  assert.notEqual(readFingerprint("session_fade").sha256, readFingerprint("session_momentum").sha256, "the same event traded the other way hashes apart");
});

test("an archive is by hand only: nothing but the record itself names ARCHIVED_READS, and nothing is archived yet", () => {
  assert.deepEqual(Object.keys(ARCHIVED_READS), []);
  const root = new URL("../../", import.meta.url).pathname;
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("ARCHIVED_READS")) hits.push(p.slice(root.length));
    }
  };
  for (const d of ["app", "workers", "tools", "functions"]) walk(join(root, d));
  assert.deepEqual(hits.sort(), [
    "app/lib/proofCopy.mjs", "app/lib/readPipeline.mjs", "app/lib/signalCard.mjs", "app/lib/signalCard.test.mjs", "app/pages/proof/SignalBoard.tsx",
    "workers/nexus-lab-api/readFingerprint.test.mjs",
  ], "a worker, job or the watcher may never write or read the archive list");
});
