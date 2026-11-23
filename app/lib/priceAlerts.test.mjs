// Price alerts (priceAlerts.mjs). Run: node --test app/lib/priceAlerts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { newAlert, normChannels, crossedIn, mergeFired, isArmed, alertMessage, alertShareUrl, alertShareText, parseShare, verifyCross, MIN } from "./priceAlerts.mjs";

const T0 = Date.parse("2026-11-21T04:30:20Z");

test("a new alert: direction from the level vs the mark; refuses too close, too far, bad input", () => {
  const up = newAlert({ coin: "btc", level: 60000, mark: 58000, now: T0, id: "a1" }).alert;
  assert.deepEqual({ coin: up.coin, dir: up.dir, level: up.level, setAt: up.setAt }, { coin: "BTC", dir: "above", level: 60000, setAt: T0 });
  assert.deepEqual(up.channels, { phone: true, telegram: true });
  assert.equal(newAlert({ coin: "BTC", level: "55500", mark: 58000 }).alert.dir, "below");
  assert.equal(newAlert({ coin: "BTC", level: 58010, mark: 58000 }).error, "too_close");
  assert.equal(newAlert({ coin: "BTC", level: 200000, mark: 58000 }).error, "too_far");
  assert.equal(newAlert({ coin: "", level: 1, mark: 1 }).error, "bad_coin");
  assert.equal(newAlert({ coin: "BTC", level: -1, mark: 1 }).error, "bad_level");
  assert.equal(newAlert({ coin: "BTC", level: 60000, mark: null }).error, "no_mark");
  assert.deepEqual(normChannels({ phone: false }), { phone: false, telegram: true });
});

test("a wick inside 5 minutes counts; the minute it was set doesn't; first crossing wins", () => {
  const a = newAlert({ coin: "BTC", level: 55500, mark: 58000, now: T0, id: "x" }).alert; // below
  const setMinute = Math.floor(T0 / MIN) * MIN;
  const bars = [
    { t: setMinute, h: 58100, l: 55000 },              // the set minute: ignored (its low came before the alert)
    { t: setMinute + 3 * MIN, h: 56000, l: 55400 },    // the wick
    { t: setMinute + 4 * MIN, h: 56500, l: 55300 },
  ];
  assert.deepEqual(crossedIn(a, bars), { at: setMinute + 3 * MIN, px: 55400 });
  assert.equal(crossedIn(a, bars.slice(0, 1)), null);
  const up = newAlert({ coin: "BTC", level: 60000, mark: 58000, now: T0, id: "y" }).alert;
  assert.deepEqual(crossedIn(up, [{ t: setMinute + 9 * MIN, h: 60130, l: 59000 }]), { at: setMinute + 9 * MIN, px: 60130 });
  assert.equal(crossedIn({ ...up, firedAt: 1 }, [{ t: setMinute + 9 * MIN, h: 61000, l: 59000 }]), null, "fires once");
});

test("fired stamps live apart from the list and merge in", () => {
  const list = [{ id: "a", coin: "BTC" }, { id: "b", coin: "ETH" }];
  const m = mergeFired(list, { b: { at: 5, px: 7 } });
  assert.equal(isArmed(m[0]), true);
  assert.deepEqual([m[1].firedAt, m[1].firedPx], [5, 7]);
});

test("the message and the share link say what traded, in words", () => {
  const a = { coin: "BTC", level: 60000, dir: "above", firedAt: Date.parse("2026-11-21T06:42:00Z"), firedPx: 60130 };
  assert.equal(alertMessage(a), "BTC traded above $60,000 at 06:42 UTC (high $60,130).");
  assert.equal(alertShareUrl(a), "https://og.nexustradinglabs.com/share/alert?c=BTC&l=60000&d=above&t=1795243320000");
  assert.match(alertShareText(a), /^BTC traded above \$60,000 at 06:42 UTC\. Checked against Orderly’s public 1-minute bars\.$/);
});

test("the card checks the link against bars it read itself", () => {
  const s = parseShare({ c: "btc", l: "60000", d: "above", t: "1795243330000" });
  assert.deepEqual(s, { coin: "BTC", level: 60000, dir: "above", t: 1795243320000 });
  assert.equal(parseShare({ c: "BTC", l: "60000", d: "sideways", t: "1795243320000" }), null);
  assert.equal(parseShare({ c: "BTC", l: "x", d: "above", t: "1" }), null);
  const bars = [{ t: s.t - MIN, h: 59900, l: 59800 }, { t: s.t, h: 60130, l: 59950 }];
  assert.deepEqual(verifyCross(s, bars), { ok: true, px: 60130 });
  assert.deepEqual(verifyCross({ ...s, level: 61000 }, bars), { ok: false, why: "not_traded" }, "a faked level never draws as a cross");
  assert.deepEqual(verifyCross(s, []), { ok: false, why: "unread" });
  assert.deepEqual(verifyCross(null, bars), { ok: false, why: "bad_link" });
});

test("the coin panel: private list, no signature prompt on open, Share only on a fired alert, a switch per channel", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/PriceAlertsBox.tsx", import.meta.url), "utf8");
  assert.match(src, /sendSigned\(/, "every read and write carries the Lab signature");
  assert.match(src, /!cachedLabAuth\(wallet\)\) return/, "opening a coin never pops a signature prompt");
  assert.match(src, /!isArmed\(a\) && <button[^>]*onClick=\{\(\) => shareX\(a\)\}/, "Share only on a fired alert, by a tap");
  assert.match(src, /toggle\(phone, setPhone, "Phone"\)/);
  assert.match(src, /toggle\(telegram, setTelegram, "Telegram/);
  assert.doesNotMatch(src, /C\.pos|C\.neg/, "a level is not money: no green/red");
  const drawer = readFileSync(new URL("../components/MarketDrawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /<PriceAlertsBox coin=\{coin\}/);
});
