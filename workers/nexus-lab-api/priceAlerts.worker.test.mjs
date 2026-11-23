// Price alerts end to end: the signed routes, the */5 runner and the share card (no real network: bars and the mark
// are injected). Run: node --test workers/nexus-lab-api/priceAlerts.worker.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";
import { handlePriceAlerts } from "./routes-pricealerts.mjs";
import { runPriceWatch, PRICE_INDEX_KEY, priceFiredKey } from "./priceWatch.mjs";
import { handleAlertShare, buildAlertCardSvg, alertCard } from "./routes-alertshare.mjs";

const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const auth = async (acct) => { const ts = Date.now(); return { ts, sig: await acct.signMessage({ message: labSaveMessage(acct.address, ts) }) }; };
function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); } };
}
const MIN = 60_000;
const call = (env, path, body, deps) => handlePriceAlerts(path.split("/").filter(Boolean),
  new Request(`https://og.test${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, deps);

test("the list is private, adds read the server's own mark, and the cap holds", async () => {
  const env = { LAB_STORE: kv() };
  const deps = { readMark: async () => 58000 };
  assert.equal((await call(env, `/alerts/price/${A}`, {}, deps)).status, 401, "unsigned = no list");
  assert.equal((await call(env, `/alerts/price/${A}`, { labAuth: await auth(mallory) }, deps)).status, 401, "someone else's signature = no list");
  const r = await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "BTC", level: 60000, channels: { telegram: false } }, deps);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.alert.dir, "above");
  assert.equal(j.alert.setMark, 58000, "the mark comes from the server, not the request");
  assert.deepEqual(j.alert.channels, { phone: true, telegram: false });
  assert.deepEqual(JSON.parse(env.LAB_STORE.m.get(PRICE_INDEX_KEY)), [A]);
  assert.equal((await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "BTC", level: 58010 }, deps)).status, 400, "too close");
  for (let i = 1; i < 20; i++) await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "BTC", level: 60000 + i * 100 }, deps);
  const over = await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "BTC", level: 70000 }, deps);
  assert.equal(over.status, 409);
  assert.equal((await over.json()).error, "too_many");
});

test("the runner fires on a 1-minute wick, once, with the alert's own switches; remove empties the index", async () => {
  const env = { LAB_STORE: kv() };
  const t0 = Date.parse("2026-11-21T04:00:10Z");
  const add = await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "BTC", level: 55500, channels: { phone: false } }, { readMark: async () => 58000, now: t0 });
  const id = (await add.json()).alert.id;
  const sent = [];
  const notify = async (w, n, opts) => { sent.push({ w, n, opts }); };
  const bars = [{ t: Math.floor(t0 / MIN) * MIN + 4 * MIN, h: 56000, l: 55400, c: 55900 }];
  const r1 = await runPriceWatch(env, notify, { now: t0 + 10 * MIN, getBars: async () => bars, mapOpts: { gapMs: 0 } });
  assert.equal(r1.fired, 1);
  assert.equal(sent[0].w, A);
  assert.equal(sent[0].n.type, "price_alert");
  assert.match(sent[0].n.message, /^BTC traded below \$55,500 at 04:04 UTC \(low \$55,400\)\.$/);
  assert.deepEqual(sent[0].opts, { push: false, telegram: true }, "phone off for this alert, Telegram on");
  assert.ok(JSON.parse(env.LAB_STORE.m.get(priceFiredKey(A)))[id], "stamp written");
  const r2 = await runPriceWatch(env, notify, { now: t0 + 15 * MIN, getBars: async () => bars, mapOpts: { gapMs: 0 } });
  assert.equal(r2.fired, 0, "never twice");
  const list = await (await call(env, `/alerts/price/${A}`, { labAuth: await auth(alice) })).json();
  assert.equal(list.alerts[0].firedPx, 55400);
  await call(env, `/alerts/price/${A}/remove`, { labAuth: await auth(alice), id });
  assert.deepEqual(JSON.parse(env.LAB_STORE.m.get(PRICE_INDEX_KEY)), []);
});

test("unread bars keep the alert armed and the cursor where it was", async () => {
  const env = { LAB_STORE: kv() };
  const t0 = Date.parse("2026-11-21T04:00:10Z");
  await call(env, `/alerts/price/${A}/add`, { labAuth: await auth(alice), coin: "ETH", level: 3500, channels: {} }, { readMark: async () => 3200, now: t0 });
  const r = await runPriceWatch(env, async () => {}, { now: t0 + 10 * MIN, getBars: async () => [], mapOpts: { gapMs: 0 } });
  assert.deepEqual(r.unread, ["ETH"]);
  assert.equal(env.LAB_STORE.m.get("palert:cursor:v1"), undefined);
});

test("the share card re-checks the link on Orderly's bars; an edited level isn't drawn as a cross", async () => {
  const env = { LAB_STORE: kv() };
  const t = Date.parse("2026-11-21T06:42:00Z");
  const readBars = async (_c, from, to, res) => (res === 1
    ? [{ t, o: 59990, h: 60130, l: 59950, c: 60100 }]
    : Array.from({ length: 96 }, (_, i) => ({ t: from + i * 15 * MIN, c: 59000 + i * 12 })));
  const get = (q) => handleAlertShare(["share", "alert"], new Request(`https://og.test/share/alert?${q}`), env, { readBars, now: t + 7 * 3600_000 });
  const ok = await (await get(`c=BTC&l=60000&d=above&t=${t}`)).text();
  assert.match(ok, /<title>BTC traded above \$60,000<\/title>/);
  assert.match(ok, /og:image" content="https:\/\/og\.nexustradinglabs\.com\/og\/alert\.png\?c=BTC&amp;l=60000/);
  const faked = await (await get(`c=BTC&l=61000&d=above&t=${t}`)).text();
  assert.match(faked, /didn’t trade above \$61,000 then/);
  const svg = await (await handleAlertShare(["og", "alert"], new Request(`https://og.test/og/alert?c=BTC&l=60000&d=above&t=${t}`), env, { readBars, cache: null })).text();
  assert.match(svg, /ON THE TAPE/);
  assert.doesNotMatch(svg, /#3ecf8e|#f7525f/i, "no money colours on a level");
  assert.match(buildAlertCardSvg(alertCard(null)), /NOT VERIFIED/);
});
