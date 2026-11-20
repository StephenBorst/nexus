// House paper runs: one keyless paper record per registered read (app/lib/housePaper.mjs). The ids are hashes no one
// holds a key for, every registered read is covered or skipped with a reason, and the config is paper only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  HOUSE_PAPER_IDS, HOUSE_PAPER_SKIP, HOUSE_PAPER_TAG, isHousePaper, housePaperRead, housePaperConfig, housePaperPlan,
} from "./housePaper.mjs";
import { REGISTERED_READS } from "./readPipeline.mjs";
import { RETIRED_UNDER_OLD_RULE } from "./proofCopy.mjs";
import { LEVEL_RECLAIM_MAIN_SYMBOLS, LEVEL_RECLAIM_PAPER_CONFIG } from "./levelReclaim.mjs";
import { gradedExitRefusal } from "./gradedExit.mjs";
import { BRAIN_READS, registeredReadRefusal } from "../../workers/nexus-lab-api/registeredReadLive.mjs";

test("each id is the hash of its read's name: no one holds a key for it", () => {
  for (const [read, id] of Object.entries(HOUSE_PAPER_IDS)) {
    assert.equal(id, "0x" + createHash("sha256").update(HOUSE_PAPER_TAG + read).digest("hex").slice(0, 40), read);
  }
  assert.equal(new Set(Object.values(HOUSE_PAPER_IDS)).size, Object.keys(HOUSE_PAPER_IDS).length, "unique");
});

test("every registered read has a house run or a stated reason, never both", () => {
  for (const r of REGISTERED_READS) {
    const has = r.axis in HOUSE_PAPER_IDS, skip = r.axis in HOUSE_PAPER_SKIP;
    assert.ok(has !== skip, `${r.axis}: a house run or a reason (exactly one)`);
    if (skip && /own paper wallet/.test(HOUSE_PAPER_SKIP[r.axis])) assert.ok(r.paperWallet, `${r.axis} has no own paper wallet`);
    if (skip && /old rule/.test(HOUSE_PAPER_SKIP[r.axis])) assert.ok(RETIRED_UNDER_OLD_RULE[r.axis], `${r.axis} wasn't retired under the old rule`);
    if (skip) assert.match(HOUSE_PAPER_SKIP[r.axis], /own paper wallet|old rule/, `${r.axis}: no other reason to skip a read`);
    if (has) assert.ok(!r.paperWallet, `${r.axis} already has its own paper wallet`);
  }
  for (const k of [...Object.keys(HOUSE_PAPER_IDS), ...Object.keys(HOUSE_PAPER_SKIP)]) {
    assert.ok(REGISTERED_READS.some((r) => r.axis === k), `${k} is not registered`);
  }
  // a house id is never a read's own paper wallet
  for (const r of REGISTERED_READS) if (r.paperWallet) assert.equal(isHousePaper(r.paperWallet), false);
});

test("the config: paper only, the read by name, the same run as the hand-made paper wallets", () => {
  for (const read of Object.keys(HOUSE_PAPER_IDS)) {
    const c = housePaperConfig(read);
    assert.equal(c.mode, "PAPER");
    assert.equal(c.signalMode, "REGISTERED_READ");
    assert.equal(c.read, read);
    assert.ok(BRAIN_READS.includes(read), `${read}: the brain runs it`);
    assert.equal(registeredReadRefusal(c), null);
    assert.equal(gradedExitRefusal(c, true), null);
    assert.ok(gradedExitRefusal(c, false), "a live copy of it would be refused");
    assert.deepEqual(c.symbols, [...LEVEL_RECLAIM_MAIN_SYMBOLS]);
    const { signalMode: _a, read: _r, ...rest } = c;
    const { signalMode: _b, ...hand } = LEVEL_RECLAIM_PAPER_CONFIG;
    assert.deepEqual(rest, { ...hand, symbols: [...hand.symbols] }, "same exit, coins and caps as level_reclaim's paper wallet");
  }
  assert.throws(() => housePaperConfig("level_reclaim"), /no house paper run/);
});

test("ids are read only, case-insensitively, and map back to their read", () => {
  const id = HOUSE_PAPER_IDS.session_fade;
  assert.equal(isHousePaper(id), true);
  assert.equal(isHousePaper(id.toUpperCase().replace("0X", "0x")), true);
  assert.equal(housePaperRead(id), "session_fade");
  assert.equal(isHousePaper("0x95e26E980e300C34360933b849457F42c6Bd7622"), false);
  assert.equal(isHousePaper(null), false);
});

test("the setup plan: create once, keep a match (key order aside), report a difference, never rewrite it", () => {
  const want = housePaperConfig("spot_absorb");
  assert.deepEqual(housePaperPlan("spot_absorb", null), { action: "create", config: want });
  const reordered = Object.fromEntries(Object.entries(want).reverse());
  assert.deepEqual(housePaperPlan("spot_absorb", reordered), { action: "keep" });
  const changed = housePaperPlan("spot_absorb", { ...want, mode: "AUTONOMOUS" });
  assert.equal(changed.action, "mismatch");
  assert.equal(changed.config, undefined, "nothing to write");
});
