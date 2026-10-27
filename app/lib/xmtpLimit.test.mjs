import { test } from "node:test";
import assert from "node:assert/strict";
import { installationLimit, revokePlan, limitMessage, KEEP_NEWEST } from "./xmtpLimit.mjs";

const INBOX = "a1".repeat(32);
// The wording libxmtp ships in @xmtp/wasm-bindings (v7 SDK).
const LIBXMTP = `Cannot register a new installation because the InboxID ${INBOX} has already registered 10/10 installations. Please revoke existing installations first.`;

test("spots the limit error and reads the inbox + counts", () => {
  assert.deepEqual(installationLimit(new Error(LIBXMTP)), { inboxId: INBOX, used: 10, max: 10 });
  assert.deepEqual(installationLimit(LIBXMTP), { inboxId: INBOX, used: 10, max: 10 });
  assert.deepEqual(installationLimit({ message: LIBXMTP }), { inboxId: INBOX, used: 10, max: 10 }); // JSON-ish object
});

test("a reworded message that still says to revoke is caught, without counts", () => {
  assert.deepEqual(installationLimit(new Error("Please revoke existing installations first")), { inboxId: null, used: null, max: null });
});

test("other errors are not the limit", () => {
  for (const e of [new Error("Wrong chain id"), new Error("User rejected the request"), "network", null, undefined]) assert.equal(installationLimit(e), null);
});

const inst = (id, ts) => ({ id, bytes: new Uint8Array([id.charCodeAt(0)]), clientTimestampNs: ts });

test("revokes all but the newest KEEP_NEWEST; missing timestamps count as oldest", () => {
  const list = [inst("a", 100n), inst("b", 500n), inst("c", null), inst("d", 300n), inst("e", 400n), inst("f", 200n)];
  const p = revokePlan(list);
  assert.equal(KEEP_NEWEST, 3);
  assert.deepEqual(p.keep.map((i) => i.id), ["b", "e", "d"]);
  assert.deepEqual(p.revoke.map((i) => i.id).sort(), ["a", "c", "f"]);
});

test("fewer devices than KEEP_NEWEST → nothing to revoke; numbers work as timestamps", () => {
  assert.equal(revokePlan([inst("a", 1), inst("b", 2)]).revoke.length, 0);
  assert.equal(revokePlan([]).revoke.length, 0);
  assert.equal(revokePlan(null).revoke.length, 0);
  assert.deepEqual(revokePlan([inst("a", 1), inst("b", 2)], 1).revoke.map((i) => i.id), ["a"]);
});

test("message names the counts when known", () => {
  assert.match(limitMessage({ used: 10, max: 10 }), /\(10 of 10\)/);
  assert.doesNotMatch(limitMessage({ used: null, max: null }), /\d+ of \d+/);
});
