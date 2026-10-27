// Run: node --test app/lib/tradingSession.test.mjs
// The v2 trading session: a real wallet signature proves the address for at most 24 hours, and every
// way to stretch, forge or replay it is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  tradingSessionMessage, newTradingSession, verifyTradingSession,
  TRADING_SESSION_MAX_MS, TRADING_SESSION_SKEW_MS,
} from "./tradingSession.mjs";

const owner = privateKeyToAccount("0x" + "55".repeat(32));
const other = privateKeyToAccount("0x" + "66".repeat(32));
const T0 = 1_792_000_000_000;
const H = 3600e3;

// verifyTradingSession is sync; recover via a precomputed map so the test stays sync like the worker's.
async function signed(acct, over = {}) {
  const s = { ...newTradingSession({ address: acct.address, now: T0, randomBytes: (n) => new Uint8Array(n).fill(7) }), ...over };
  const message = tradingSessionMessage({ address: acct.address, session: s.session, issued: s.issued, expires: s.expires });
  const sig = await acct.signMessage({ message });
  const recovered = (await recoverMessageAddress({ message, signature: sig })).toLowerCase();
  return { auth: { session: s.session, issued: s.issued, expires: s.expires, sig }, message, recovered };
}
const recoverFrom = (map) => (message, sig) => map.get(message + "|" + sig) ?? null;
const check = (s, p = {}) => verifyTradingSession({
  address: owner.address, auth: s.auth, now: T0 + H, recover: recoverFrom(new Map([[s.message + "|" + s.auth.sig, s.recovered]])), ...p,
});

test("the message is pinned word for word: the client and the worker build the same bytes", () => {
  assert.equal(tradingSessionMessage({ address: "0xABCDEF0123456789abcdef0123456789ABCDEF01", session: "0".repeat(32), issued: 1, expires: 2 }),
    "Nexus trading: sign in with this wallet\n"
    + "Lets Nexus use this wallet's Nexus trading key for orders, positions and your agent.\n"
    + "It can't withdraw.\n"
    + "Address: 0xabcdef0123456789abcdef0123456789abcdef01\n"
    + "Session: 00000000000000000000000000000000\n"
    + "Issued: 1\nExpires: 2\nDomain: og.nexustradinglabs.com");
  assert.ok(/^[\x00-\x7f]*$/.test(tradingSessionMessage({ address: owner.address, session: "a".repeat(32), issued: 1, expires: 2 })), "ASCII only");
});

test("a fresh session for 24h from the owner's wallet is accepted", async () => {
  const s = await signed(owner);
  assert.equal(s.auth.expires - s.auth.issued, TRADING_SESSION_MAX_MS);
  assert.match(s.auth.session, /^[0-9a-f]{32}$/);
  const v = check(s);
  assert.deepEqual([v.ok, v.wallet], [true, owner.address.toLowerCase()]);
  assert.equal(newTradingSession({ address: owner.address, now: T0, ttlMs: 48 * H }).expires - T0, TRADING_SESSION_MAX_MS, "ttl is capped at 24h");
});

test("expired, too long, back-to-front, or issued in the future: refused", async () => {
  assert.equal(check(await signed(owner), { now: T0 + 25 * H }).reason, "expired");
  assert.equal(check(await signed(owner, { expires: T0 + 25 * H })).reason, "bad_lifetime");
  assert.equal(check(await signed(owner, { expires: T0 })).reason, "bad_lifetime");
  const ahead = await signed(owner, { issued: T0 + H + TRADING_SESSION_SKEW_MS + 1000, expires: T0 + 3 * H });
  assert.equal(check(ahead).reason, "future");
  assert.equal(check(await signed(owner, { issued: T0 + H + 60_000, expires: T0 + 3 * H })).ok, true, "a minute of clock skew is fine");
});

test("another wallet's signature, or a field changed after signing: refused", async () => {
  assert.equal(check(await signed(other)).reason, "wrong_signer", "signed by a different wallet");
  const s = await signed(owner);
  const moved = { ...s, auth: { ...s.auth, expires: s.auth.expires - 1 } };
  assert.equal(check(moved).reason, "wrong_signer", "the signature covers expires");
  const stretched = { ...s, auth: { ...s.auth, expires: s.auth.expires + 1 } };
  assert.equal(check(stretched).reason, "bad_lifetime", "and it can never pass 24h");
  const swapped = { ...s, auth: { ...s.auth, session: "f".repeat(32) } };
  assert.equal(check(swapped).reason, "wrong_signer", "the signature covers the session id");
  assert.equal(verifyTradingSession({ address: other.address, auth: s.auth, now: T0 + H, recover: () => s.recovered }).reason, "wrong_signer", "another address");
});

test("the end-all switch refuses sessions issued before it, keeps later ones", async () => {
  const s = await signed(owner);
  assert.equal(check(s, { sessionsAfter: T0 + 1 }).reason, "ended");
  assert.equal(check(s, { sessionsAfter: T0 }).ok, true, "issued exactly at the stamp survives");
  assert.equal(check(s, { sessionsAfter: 0 }).ok, true);
});

test("malformed input never throws and never passes", async () => {
  const s = await signed(owner);
  for (const auth of [null, "x", {}, { ...s.auth, session: "ABC" }, { ...s.auth, issued: "soon" }, { ...s.auth, sig: "not-hex" }]) {
    assert.equal(verifyTradingSession({ address: owner.address, auth, now: T0 + H, recover: () => owner.address }).ok, false, JSON.stringify(auth));
  }
  assert.equal(verifyTradingSession({ address: "nope", auth: s.auth, recover: () => null }).reason, "bad_address");
  assert.equal(verifyTradingSession({ address: owner.address, auth: s.auth, now: T0 + H, recover: () => { throw new Error("x"); } }).reason, "wrong_signer");
});
