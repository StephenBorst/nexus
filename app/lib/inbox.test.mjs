// The bell's "Yours" tab (inbox.mjs). Run: node --test app/lib/inbox.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inboxRows, inboxHref, inboxShare, unreadCount, isUnread, ago, INBOX_LABELS, INBOX_MAX } from "./inbox.mjs";

const W = "0x" + "ab".repeat(20);
const fired = { id: "price_x", type: "price_alert", message: "BTC traded above $60,000 at 06:42 UTC (high $60,130).", url: "/lab?tab=intel&market=BTC",
  coin: "BTC", level: 60000, dir: "above", firedAt: Date.parse("2026-11-21T06:42:00Z"), createdAt: 300, read: false };

test("rows: newest first, the phone's words as labels, malformed rows dropped", () => {
  const rows = inboxRows([
    { id: "a", type: "call_resolved", message: "BTC LONG hit target · +1.5R", thesisId: "t9", createdAt: 100, readAt: 5 },
    fired,
    { id: "b", type: "mystery", message: "  ", createdAt: 200 },
    { id: "c", type: "follow", message: "kai followed you", createdAt: 0 },
    null,
  ], W);
  assert.deepEqual(rows.map((r) => r.id), ["price_x", "a"]);
  assert.equal(rows[0].label, "Price alert");
  assert.equal(rows[1].label, "Call graded");
  assert.equal(rows[1].href, `/feed/thesis/${W}/t9`);
  assert.equal(unreadCount(rows), 1);
  assert.equal(inboxRows(Array.from({ length: 60 }, (_, i) => ({ id: String(i), type: "follow", message: "m", createdAt: i + 1 })), W).length, INBOX_MAX);
});

test("a tap stays in the app; a followed caller's call opens under the AUTHOR's wallet", () => {
  assert.equal(inboxHref({ url: "/lab?tab=agent" }, W), "/lab?tab=agent");
  assert.equal(inboxHref({ url: "//evil.example/x" }, W), null);
  assert.equal(inboxHref({ url: "https://evil.example" }, W), null);
  const author = "0x" + "cd".repeat(20);
  assert.equal(inboxHref({ thesisId: "t1", thesisWallet: author }, W), `/feed/thesis/${author}/t1`);
  assert.equal(inboxHref({ thesisId: "../../x" }, W), null);
});

test("read state, and Share only on a fired price alert with its own numbers", () => {
  assert.equal(isUnread({ read: false }), true);
  assert.equal(isUnread({ readAt: 1 }), false);
  assert.equal(isUnread({ read: true }), false);
  const s = inboxShare(fired);
  assert.match(s.url, /^https:\/\/og\.nexustradinglabs\.com\/share\/alert\?c=BTC&l=60000&d=above&t=\d+$/);
  assert.match(s.text, /^BTC traded above \$60,000/);
  assert.equal(inboxShare({ ...fired, dir: "sideways" }), null);
  assert.equal(inboxShare({ type: "call_resolved" }), null);
  assert.equal(ago(1000, 1000 + 5 * 60_000), "5m");
  assert.equal(ago(0, 3 * 86400_000), "3d");
  assert.equal(INBOX_LABELS.price_alert, "Price alert");
});

test("the labels match the phone's (push.mjs TITLES), so one alert reads the same everywhere", () => {
  const push = readFileSync(new URL("../../workers/nexus-lab-api/push.mjs", import.meta.url), "utf8");
  for (const [type, label] of Object.entries(INBOX_LABELS)) assert.ok(push.includes(`${type}: "${label}"`), `${type}: "${label}" not in push.mjs TITLES`);
});

test("the bell: a Yours tab, no signature prompt on its own, read marked only on opening the tab", () => {
  const src = readFileSync(new URL("../components/SignalsNavButton.tsx", import.meta.url), "utf8");
  assert.match(src, /cachedLabAuth\(walletAddress\)/, "the list loads by itself only with a signature already held");
  assert.match(src, /\/notifications\/\$\{/);
  assert.match(src, /\/read`/);
  assert.match(src, /inboxRows\(/);
  assert.match(src, /Share on 𝕏/);
});
