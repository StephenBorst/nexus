import test from "node:test";
import assert from "node:assert/strict";
import { recordShareText, recordShareHref } from "./recordShare.mjs";

const NOW = Date.parse("2026-11-05T20:00:00Z");
const H = 3600e3;

test("people and engines on their own lines; a quiet week shows the last grade's age", () => {
  const t = recordShareText({ ok: true, open: 0, gradedWeek: 0, last: { at: NOW - 63 * 24 * H }, engines: { open: 2, gradedWeek: 10, last: null } }, NOW);
  assert.equal(t, "The record · Nov 5.\n\nPeople: 0 open · last graded 63d ago.\nOur engines: 2 open · 10 graded this week.\n\nEvery call graded from public price. Losses stay up.");
});

test("a cleared read prints its paper COUNT only; no money number leaves", () => {
  const t = recordShareText({
    ok: true, open: 1, gradedWeek: 2, last: null, engines: { open: 0, gradedWeek: 0, last: null },
    headline: { cleared: true }, signals: [{ axis: "level_reclaim", trades: 42, netBps: 25.2, paper: { trades: 3, target: 30 } }],
  }, NOW);
  assert.match(t, /level_reclaim cleared the bar \(42 graded trades\)\. On paper: 3 of 30\. Nothing armed\./);
  assert.ok(!/25\.2|bps|\$|proven/i.test(t));
});

test("unread paper count: the read line without a count; no headline claim = no read line", () => {
  const base = { ok: true, open: 0, gradedWeek: 0, last: null, signals: [{ axis: "level_reclaim", trades: 42, paper: { trades: null, target: 30 } }] };
  assert.match(recordShareText({ ...base, headline: { cleared: true } }, NOW), /cleared the bar \(42 graded trades\)\.\n/);
  assert.ok(!/cleared/.test(recordShareText({ ...base, headline: null }, NOW)));
});

test("an unreadable pulse makes no post", () => {
  assert.equal(recordShareText(null), null);
  assert.equal(recordShareText({ ok: false }), null);
  assert.equal(recordShareText({ ok: true }), null);
});

test("the X link carries the text and the /proof url", () => {
  const href = recordShareHref("a b");
  assert.ok(href.startsWith("https://twitter.com/intent/tweet?text=a%20b&url="));
  assert.ok(href.includes(encodeURIComponent("https://trade.nexustradinglabs.com/proof")));
});
