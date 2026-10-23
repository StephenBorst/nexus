// The trading-account seed sealed at rest. Run: node --test workers/nexus-lab-api/seedVault.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, randomBytes } from "node:crypto";
import {
  aesGcmEncrypt, aesGcmDecrypt, isSealed, sealSeed, openSeed, storeSealedSeed, sealLegacySeeds,
  SEAL_CURSOR_KEY, SEAL_DONE_KEY,
} from "./seedVault.mjs";

const SECRET = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");
const env = { AGENT_ENC_KEY: SECRET };
const SEED = "a".repeat(32) + "0123456789abcdef".repeat(2);

// A KV that keeps every write, with list() paging like Cloudflare's.
function kvFake(entries = {}) {
  const m = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m, puts: 0,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { this.puts++; m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + limit);
      const next = start + page.length;
      return { keys: page.map((name) => ({ name })), list_complete: next >= names.length, cursor: next >= names.length ? undefined : String(next) };
    },
  };
}
const rec = (kv, addr) => JSON.parse(kv.m.get("user:" + addr));

test("sealed form = the agent keys' format: v1:<iv>:<ct+tag>, opened by an independent AES-GCM", async () => {
  const sealed = await aesGcmEncrypt(SEED, SECRET);
  assert.ok(sealed.startsWith("v1:"));
  const [, ivB64, ctB64] = sealed.split(":");
  const iv = Buffer.from(ivB64, "base64"), ct = Buffer.from(ctB64, "base64");
  assert.equal(iv.length, 12);
  // Web Crypto appends the 16-byte tag; the exec's decryptTradingKey reads the same layout.
  const d = createDecipheriv("aes-256-gcm", Buffer.from(SECRET, "base64"), iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  assert.equal(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(), SEED);
  assert.equal(await aesGcmDecrypt(sealed, SECRET), SEED);
  assert.notEqual(await aesGcmEncrypt(SEED, SECRET), sealed, "fresh IV every time");
  await assert.rejects(aesGcmEncrypt(SEED, undefined), /AGENT_ENC_KEY/);
});

test("sealSeed never returns plaintext: no secret or a non-seed ⇒ null", async () => {
  assert.ok(isSealed(await sealSeed(SEED, env)));
  assert.equal(await sealSeed(SEED, {}), null);
  assert.equal(await sealSeed("not-hex", env), null);
  assert.equal(await sealSeed(SEED.slice(2), env), null, "wrong length");
});

test("openSeed: sealed → hex; legacy plain → hex + reseal; wrong secret / garbage / no secret → nothing", async () => {
  const sealed = await sealSeed(SEED, env);
  assert.deepEqual(await openSeed(sealed, env), { hex: SEED, reseal: false });
  assert.deepEqual(await openSeed(SEED.toUpperCase(), env), { hex: SEED, reseal: true });
  assert.deepEqual(await openSeed(sealed, { AGENT_ENC_KEY: OTHER }), { hex: null, reseal: false });
  assert.deepEqual(await openSeed(sealed, {}), { hex: null, reseal: false });
  assert.deepEqual(await openSeed("v1:garbage", env), { hex: null, reseal: false });
  assert.deepEqual(await openSeed(undefined, env), { hex: null, reseal: false });
});

test("storeSealedSeed seals onto the stored record, keeps its other fields, and skips a sealed one", async () => {
  const kv = kvFake({ "user:0xabc": { accountId: "acc1", orderlyKey: "ed25519:K", registeredAt: 1 } });
  assert.equal(await storeSealedSeed(kv, "0xABC", SEED, env), true);
  const r = rec(kv, "0xabc");
  assert.ok(isSealed(r.seed));
  assert.equal(r.accountId, "acc1");
  assert.equal((await openSeed(r.seed, env)).hex, SEED);
  const puts = kv.puts;
  assert.equal(await storeSealedSeed(kv, "0xabc", SEED, env), false, "already sealed: no write");
  assert.equal(kv.puts, puts);
  // Legacy plain seed: re-sealed.
  const kv2 = kvFake({ "user:0xdef": { accountId: "acc2", seed: SEED } });
  assert.equal(await storeSealedSeed(kv2, "0xdef", SEED, env), true);
  assert.ok(isSealed(rec(kv2, "0xdef").seed));
  // No record: nothing written.
  assert.equal(await storeSealedSeed(kvFake(), "0x123", SEED, env), false);
});

test("without the secret a plain seed is dropped, never kept or written in the clear", async () => {
  const kv = kvFake({ "user:0xdef": { accountId: "acc2", seed: SEED } });
  assert.equal(await storeSealedSeed(kv, "0xdef", SEED, {}), true);
  assert.deepEqual(rec(kv, "0xdef"), { accountId: "acc2" });
  const kv2 = kvFake({ "user:0xabc": { accountId: "acc1" } });
  assert.equal(await storeSealedSeed(kv2, "0xabc", SEED, {}), false);
  assert.deepEqual(rec(kv2, "0xabc"), { accountId: "acc1" });
});

test("sealLegacySeeds walks user: records a page per run, seals only plain seeds, then stops", async () => {
  const sealed = await sealSeed(SEED, env);
  const kv = kvFake({
    "user:0x01": { accountId: "a", seed: SEED },
    "user:0x02": { accountId: "b" },
    "user:0x03": { accountId: "c", seed: sealed },
    "user:0x04": { accountId: "d", seed: SEED.toUpperCase() },
    "user:0x05": "not json",
    "lab:0x01": { seed: SEED }, // another prefix: never touched
  });
  const r1 = await sealLegacySeeds(kv, env, { pageSize: 2 });
  assert.deepEqual(r1, { scanned: 2, sealed: 1, done: false });
  assert.equal(kv.m.get(SEAL_CURSOR_KEY), "2");
  const r2 = await sealLegacySeeds(kv, env, { pageSize: 2 });
  assert.deepEqual(r2, { scanned: 2, sealed: 1, done: false });
  const r3 = await sealLegacySeeds(kv, env, { pageSize: 2 });
  assert.equal(r3.done, true);
  assert.ok(kv.m.get(SEAL_DONE_KEY));
  assert.equal(kv.m.has(SEAL_CURSOR_KEY), false);
  for (const a of ["0x01", "0x04"]) assert.equal((await openSeed(rec(kv, a).seed, env)).hex, SEED, a);
  assert.equal(rec(kv, "0x03").seed, sealed, "an already-sealed seed isn't rewritten");
  assert.deepEqual(JSON.parse(kv.m.get("lab:0x01")), { seed: SEED });
  // Done: later runs read one key and stop.
  assert.deepEqual(await sealLegacySeeds(kv, env), { scanned: 0, sealed: 0, done: true });
  // No secret: does nothing at all.
  const kv2 = kvFake({ "user:0x01": { seed: SEED } });
  assert.equal((await sealLegacySeeds(kv2, {})).skipped, "no_secret");
  assert.equal(rec(kv2, "0x01").seed, SEED);
});
