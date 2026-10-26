// AES-256-GCM for stored secrets (the agent keys' format). Seed removal is tested in routes-account.test.mjs. Run: node --test workers/nexus-lab-api/seedVault.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, randomBytes } from "node:crypto";
import { aesGcmEncrypt, aesGcmDecrypt, isSealed } from "./seedVault.mjs";

const SECRET = randomBytes(32).toString("base64");
const SEED = "a".repeat(32) + "0123456789abcdef".repeat(2);

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

test("decrypt round-trips; a wrong secret fails; isSealed reads the prefix", async () => {
  const sealed = await aesGcmEncrypt("hello", SECRET);
  assert.equal(await aesGcmDecrypt(sealed, SECRET), "hello");
  await assert.rejects(aesGcmDecrypt(sealed, randomBytes(32).toString("base64")));
  assert.equal(isSealed(sealed), true);
  assert.equal(isSealed("cd".repeat(32)), false);
});
