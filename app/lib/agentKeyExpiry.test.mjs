// The agent's v2 key expiry rule (auth v2 step 3b, docs/auth-v2-spec.md Q3).
// Run: node --test app/lib/agentKeyExpiry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  keyEntryRefusal, keyDaysLeft, keyAlertDue, keyAlertText, KEY_REFUSAL_TEXT,
  KEY_ALERT_DAYS, KEY_EXPIRY_BUFFER_MS, V2_KEY_LINK, isV2Link,
} from "./agentKeyExpiry.mjs";

const T0 = 1_790_000_000_000;
const H = 3600000, DAY = 24 * H;
const key = (daysLeft) => ({ v: 2, expiresAt: T0 + daysLeft * DAY });

test("a v1 key (no expiry on record) is never refused or alerted: unchanged behaviour", () => {
  for (const k of [null, undefined, { v: 1 }, { tradingKey: "x" }]) {
    assert.equal(keyEntryRefusal(k, { holdHours: 9999, now: T0 }), null);
    assert.equal(keyAlertDue(k, { now: T0 }), false);
    assert.equal(keyDaysLeft(k, T0), null);
  }
});

test("no position whose max hold (plus an hour) runs past the key's expiry", () => {
  const k = { v: 2, expiresAt: T0 + 10 * H };
  assert.equal(keyEntryRefusal(k, { holdHours: 8, now: T0 }), null, "8h + 1h buffer fits in 10h");
  assert.equal(keyEntryRefusal(k, { holdHours: 9, now: T0 }), null, "exactly at the edge still fits");
  assert.equal(keyEntryRefusal(k, { holdHours: 9.01, now: T0 }), "hold_runs_past_key");
  assert.equal(keyEntryRefusal(key(30), { holdHours: 168, now: T0 }), null);
  assert.equal(keyEntryRefusal(key(7), { holdHours: 168, now: T0 }), "hold_runs_past_key", "the last week can't open a 168h trade");
  assert.equal(KEY_EXPIRY_BUFFER_MS, H);
});

test("expired, unreadable expiry, or no max hold: refused", () => {
  assert.equal(keyEntryRefusal(key(0), { holdHours: 1, now: T0 }), "key_expired");
  assert.equal(keyEntryRefusal(key(-1), { holdHours: 1, now: T0 }), "key_expired");
  assert.equal(keyEntryRefusal({ v: 2 }, { holdHours: 1, now: T0 }), "key_expiry_unknown");
  for (const h of [undefined, null, 0, -4, NaN, "x"]) assert.equal(keyEntryRefusal(key(30), { holdHours: h, now: T0 }), "no_max_hold", String(h));
  for (const why of ["key_expired", "key_expiry_unknown", "no_max_hold", "hold_runs_past_key"]) assert.ok(KEY_REFUSAL_TEXT[why], why);
});

test("the alert: from 3 days out (expired included), at most once a day", () => {
  assert.equal(KEY_ALERT_DAYS, 3);
  assert.equal(keyAlertDue(key(3.01), { now: T0 }), false);
  assert.equal(keyAlertDue(key(3), { now: T0 }), true);
  assert.equal(keyAlertDue(key(-2), { now: T0 }), true, "expired still nags");
  assert.equal(keyAlertDue(key(2), { now: T0, lastAlertAt: T0 - 23 * H }), false);
  assert.equal(keyAlertDue(key(2), { now: T0, lastAlertAt: T0 - 24 * H }), true);
});

test("alert text: days left, a day, expired; no money words it can't back", () => {
  assert.match(keyAlertText(key(2.5), T0), /expires in 2 days/);
  assert.match(keyAlertText(key(1.2), T0), /expires in 1 day\b/);
  assert.match(keyAlertText(key(0.5), T0), /within a day/);
  assert.match(keyAlertText(key(-1), T0), /has expired/);
  assert.equal(keyDaysLeft(key(2.9), T0), 2);
  assert.equal(keyDaysLeft(key(-3), T0), 0);
});

test("the link an agent / TWAP stores holds no key material", () => {
  const l = V2_KEY_LINK(T0);
  assert.deepEqual(l, { v: 2, source: "v2key", linkedAt: T0 });
  assert.equal(isV2Link(l), true);
  for (const r of [null, { v: 2 }, { v: 1, source: "v2key" }, { tradingKey: "v1:a:b", accountId: "0x" }]) assert.equal(isV2Link(r), false);
});
