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

test("record card: people and engines as columns, the cleared read's paper count; unreadable = honest card", async () => {
  const { recordCard, recordCardVersion, recordShareLink } = await import("./recordShare.mjs");
  const p = { ok: true, open: 0, gradedWeek: 0, last: { at: NOW - 63 * 24 * H }, engines: { open: 1, gradedWeek: 10, last: null },
    headline: { cleared: true }, signals: [{ axis: "level_reclaim", trades: 48, paper: { trades: 1, target: 30 } }] };
  const c = recordCard(p, NOW);
  assert.equal(c.stamp, "Nov 5, 2026");
  assert.deepEqual(c.cols, [
    { label: "PEOPLE", value: "0 open", sub: "last graded 63d ago" },
    { label: "OUR ENGINES", value: "1 open", sub: "10 graded this week" },
  ]);
  assert.deepEqual(c.signal, { title: "level_reclaim cleared the bar · 48 graded trades", sub: "On paper: 1 of 30. Nothing armed." });
  assert.deepEqual(recordCard({ ok: false }, NOW), { ok: false, stamp: "Nov 5, 2026", cols: [], signal: null, noneCleared: false });
  assert.equal(recordCard({ ...p, headline: { cleared: false }, signals: [] }, NOW).noneCleared, true);
  assert.equal(recordCard({ ...p, headline: null, signals: [] }, NOW).noneCleared, false, "an unread board claims nothing");
  // the version moves with the numbers and the day, not with the clock inside a day
  const v = recordCardVersion(p, NOW);
  assert.equal(recordCardVersion(p, NOW + 60000), v);
  assert.notEqual(recordCardVersion({ ...p, open: 1 }, NOW), v);
  assert.notEqual(recordCardVersion(p, NOW + 24 * H), v);
  assert.ok(recordShareLink(p, NOW).startsWith("https://og.nexustradinglabs.com/share/record?v=2026-11-05-"));
});
