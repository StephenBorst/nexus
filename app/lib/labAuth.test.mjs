// Run: node --test app/lib/labAuth.test.mjs
// The pure half of Lab record auth: the message both sides build, every refusal reason, and what the
// public view may show. Real signatures (secp256k1 + ed25519) are exercised end to end in
// workers/nexus-lab-api/routes-lab.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  labSaveMessage, verifyLabAuth, publicLabView, isEvmAddress, isSolAddress,
  LAB_AUTH_MAX_AGE_MS, LAB_AUTH_REUSE_MS, LAB_AUTH_SKEW_MS,
} from "./labAuth.mjs";

const EVM = "0xAbCdEf0000000000000000000000000000000001";
const SOL = "82MmCJt8NqXsXtJfKpmJcBirTYeJaG4w15PY5sDhfXo5";
const T0 = 1_790_000_000_000;
const SIG = "0x" + "11".repeat(65);
// Fake crypto: "recovers" whoever the test says signed; verifySol accepts only the named signer.
const recoverAs = (who) => () => who;
const solOk = (who) => (_m, _s, signer) => signer === who;
const never = () => { throw new Error("crypto must not run"); };

test("message: EVM address lowercased, Solana kept exactly (base58 is case-sensitive), ASCII only", () => {
  const m = labSaveMessage(EVM, T0);
  assert.match(m, /Address: 0xabcdef0{33}1\n/);
  assert.match(m, new RegExp(`Timestamp: ${T0}\\n`));
  assert.ok(labSaveMessage(SOL, T0).includes(`Address: ${SOL}\n`));
  assert.ok(/^[\x20-\x7e\n]+$/.test(m), "every wallet renders ASCII the same way");
  assert.match(m, /No funds move/);
});

test("address shapes", () => {
  assert.ok(isEvmAddress(EVM) && !isSolAddress(EVM));
  assert.ok(isSolAddress(SOL) && !isEvmAddress(SOL));
  for (const bad of ["", "0x12", null, 7, "0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O"]) assert.ok(!isEvmAddress(bad) && !isSolAddress(bad), String(bad));
});

test("EVM: the owner's fresh signature passes", () => {
  const v = verifyLabAuth({ address: EVM.toLowerCase(), auth: { ts: T0, sig: SIG }, now: T0 + 60_000, recoverEvm: recoverAs(EVM), verifySol: never });
  assert.deepEqual(v, { ok: true, signer: EVM.toLowerCase() });
});

test("EVM: someone else's signature is refused", () => {
  const v = verifyLabAuth({ address: EVM.toLowerCase(), auth: { ts: T0, sig: SIG }, now: T0, recoverEvm: recoverAs("0x" + "22".repeat(20)), verifySol: never });
  assert.deepEqual(v, { ok: false, reason: "wrong_signer" });
});

test("EVM: an unrecoverable or throwing signature is refused, never a crash", () => {
  assert.equal(verifyLabAuth({ address: EVM, auth: { ts: T0, sig: SIG }, now: T0, recoverEvm: () => null, verifySol: never }).reason, "wrong_signer");
  assert.equal(verifyLabAuth({ address: EVM, auth: { ts: T0, sig: SIG }, now: T0, recoverEvm: never, verifySol: never }).reason, "wrong_signer");
});

test("missing or malformed auth is refused before any crypto runs", () => {
  const base = { address: EVM, now: T0, recoverEvm: never, verifySol: never };
  assert.equal(verifyLabAuth({ ...base, auth: undefined }).reason, "missing");
  assert.equal(verifyLabAuth({ ...base, auth: "0xdead" }).reason, "missing");
  for (const auth of [{ ts: "soon", sig: SIG }, { ts: T0 + 0.5, sig: SIG }, { ts: T0, sig: 12 }, { ts: T0, sig: "zz" }, { ts: T0 }]) {
    assert.equal(verifyLabAuth({ ...base, auth }).reason, "malformed", JSON.stringify(auth));
  }
});

test("a day-old signature expires; one from the future is refused beyond the clock slack", () => {
  const base = { address: EVM, auth: { ts: T0, sig: SIG }, recoverEvm: recoverAs(EVM), verifySol: never };
  assert.equal(verifyLabAuth({ ...base, now: T0 + LAB_AUTH_MAX_AGE_MS }).ok, true, "exactly 24h still counts");
  assert.equal(verifyLabAuth({ ...base, now: T0 + LAB_AUTH_MAX_AGE_MS + 1 }).reason, "expired");
  assert.equal(verifyLabAuth({ ...base, now: T0 - LAB_AUTH_SKEW_MS }).ok, true, "a slow server clock is tolerated");
  assert.equal(verifyLabAuth({ ...base, now: T0 - LAB_AUTH_SKEW_MS - 1 }).reason, "future");
  assert.ok(LAB_AUTH_REUSE_MS < LAB_AUTH_MAX_AGE_MS, "the browser re-signs before the worker would refuse");
});

test("Solana: the signer must be this record's key (case aside) and must have signed", () => {
  const address = SOL.toLowerCase(); // how the Lab keys records
  const auth = { ts: T0, sig: "0x" + "33".repeat(64), signer: SOL };
  assert.deepEqual(verifyLabAuth({ address, auth, now: T0, recoverEvm: never, verifySol: solOk(SOL) }), { ok: true, signer: SOL });
  // A different Solana key, even one that signed correctly, doesn't own this record.
  const other = "2E91L9BsgTN6wAk1EQ38ZUXvHBkjmh8EDopQQYYqRneY";
  assert.equal(verifyLabAuth({ address, auth: { ...auth, signer: other }, now: T0, recoverEvm: never, verifySol: solOk(other) }).reason, "wrong_signer");
  // The right key that did NOT sign.
  assert.equal(verifyLabAuth({ address, auth, now: T0, recoverEvm: never, verifySol: () => false }).reason, "wrong_signer");
  // No signer → can't know the key's real case → refused.
  assert.equal(verifyLabAuth({ address, auth: { ts: T0, sig: auth.sig }, now: T0, recoverEvm: never, verifySol: solOk(SOL) }).reason, "wrong_signer");
  assert.equal(verifyLabAuth({ address, auth, now: T0, recoverEvm: never, verifySol: never }).reason, "wrong_signer", "a throwing verifier is a refusal");
});

test("public view: only public, non-holders calls; never notes", () => {
  const record = {
    theses: [
      { id: "a", isPublic: true },
      { id: "b", isPublic: false },
      { id: "c" },
      { id: "d", isPublic: true, holdersOnly: true },
      { id: "e", isPublic: "true" }, // not a boolean → the feed wouldn't show it, neither do we
      null,
    ],
    notes: { "2026-09-27": "my private journal" },
    anythingElse: "private",
  };
  assert.deepEqual(publicLabView(record), { theses: [{ id: "a", isPublic: true }], notes: {} });
  assert.deepEqual(publicLabView(null), { theses: [], notes: {} });
  assert.deepEqual(publicLabView({ theses: "nope" }), { theses: [], notes: {} });
});
