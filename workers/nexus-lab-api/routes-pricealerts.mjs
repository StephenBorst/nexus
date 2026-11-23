// ── /alerts/price/:wallet — price alerts you set (rules app/lib/priceAlerts.mjs, runner priceWatch.mjs) ──────────
//   POST /alerts/price/:wallet            { labAuth }                             → { alerts, max }   your list (private)
//   POST /alerts/price/:wallet/add        { labAuth, coin, level, channels? }     → { alert, alerts }
//   POST /alerts/price/:wallet/remove     { labAuth, id }                         → { alerts }
//   POST /alerts/price/:wallet/channels   { labAuth, id, channels }               → { alerts }
// Every route needs the wallet's Lab signature (labAuth.mjs: "…notifications, phone alerts…"): your levels say where
// your positions are, so even the list is private. The list key is written ONLY here (under a NexusLock lease per
// wallet), the fired stamps ONLY by the runner. The mark for a new alert is read by the server, never the browser.
import { json } from "./shared.mjs";
import { provenWallet, unsignedSocial } from "./socialAuth.mjs";
import { newAlert, mergeFired, isArmed, normChannels, PRICE_ALERTS_MAX, PRICE_ALERTS_FIRED_KEEP } from "../../app/lib/priceAlerts.mjs";
import { PRICE_INDEX_KEY, PRICE_WATCH_WALLETS_MAX, priceListKey, priceFiredKey } from "./priceWatch.mjs";
import { readMark } from "./alertBars.mjs";
import { withLock, LockBusy } from "./lock.mjs";

const readJson = async (kv, key, fallback) => {
  try { const r = await kv.get(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
};
async function body(request) {
  try { return await request.json(); } catch { return null; }
}

async function view(kv, w) {
  const [list, fired] = await Promise.all([readJson(kv, priceListKey(w), []), readJson(kv, priceFiredKey(w), {})]);
  return mergeFired(list, fired);
}

/** Keep every armed alert + the newest fired ones; the fired stamps come from the runner's own key. */
function trimmed(merged) {
  const armed = merged.filter(isArmed);
  const fired = merged.filter((a) => !isArmed(a)).sort((a, b) => b.firedAt - a.firedAt).slice(0, PRICE_ALERTS_FIRED_KEEP);
  const keep = new Set([...armed, ...fired].map((a) => a.id));
  return merged.filter((a) => keep.has(a.id)).map(({ firedAt, firedPx, ...rest }) => rest);
}

async function indexWallet(env, w, on) {
  const kv = env.LAB_STORE;
  await withLock(env, "palert:index", async () => {
    const idx = await readJson(kv, PRICE_INDEX_KEY, []);
    const has = idx.includes(w);
    if (on && !has) {
      let base = idx;
      // Full: drop wallets with nothing armed (their alerts all fired), oldest first, before refusing a new one.
      if (base.length >= PRICE_WATCH_WALLETS_MAX) {
        const keep = [];
        for (const x of base) if ((await view(kv, x)).some(isArmed)) keep.push(x);
        base = keep;
      }
      if (base.length < PRICE_WATCH_WALLETS_MAX) await kv.put(PRICE_INDEX_KEY, JSON.stringify([...base, w]));
    }
    if (!on && has) await kv.put(PRICE_INDEX_KEY, JSON.stringify(idx.filter((x) => x !== w)));
  });
}

export async function handlePriceAlerts(parts, request, env, deps = {}) {
  if (parts[0] !== "alerts" || parts[1] !== "price" || !parts[2]) return null;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, request, 405);
  const now = deps.now ?? Date.now();
  const b = await body(request);
  const who = provenWallet(parts[2], b?.labAuth); // the signature's age: always the real clock (deps.now only stamps setAt)
  if (!who.ok) return unsignedSocial(request, who);
  const w = who.wallet, kv = env.LAB_STORE;
  const action = parts[3] || "";

  if (!action) return json({ alerts: await view(kv, w), max: PRICE_ALERTS_MAX }, request);

  try {
    if (action === "add") {
      const mark = await (deps.readMark || readMark)(b?.coin);
      const made = newAlert({ coin: b?.coin, level: b?.level, mark, channels: b?.channels, now });
      if (made.error) return json(made, request, 400);
      let out;
      await withLock(env, `palert:${w}`, async () => {
        const merged = await view(kv, w);
        if (merged.filter(isArmed).length >= PRICE_ALERTS_MAX) { out = { error: "too_many", hint: `You have ${PRICE_ALERTS_MAX} alerts waiting. Remove one first.` }; return; }
        const next = trimmed([...merged, made.alert]);
        await kv.put(priceListKey(w), JSON.stringify(next));
        out = { alert: made.alert };
      });
      if (out.error) return json(out, request, 409);
      await indexWallet(env, w, true);
      return json({ ...out, alerts: await view(kv, w) }, request);
    }

    if (action === "remove" || action === "channels") {
      const id = String(b?.id || "");
      if (!id) return json({ error: "id_required" }, request, 400);
      let left = 0, found = false;
      await withLock(env, `palert:${w}`, async () => {
        const merged = await view(kv, w);
        found = merged.some((a) => a.id === id);
        if (!found) return;
        const next = action === "remove" ? merged.filter((a) => a.id !== id)
          : merged.map((a) => (a.id === id ? { ...a, channels: normChannels(b?.channels) } : a));
        left = next.filter(isArmed).length;
        await kv.put(priceListKey(w), JSON.stringify(trimmed(next)));
      });
      if (!found) return json({ error: "not_found" }, request, 404);
      if (action === "remove" && left === 0) await indexWallet(env, w, false);
      return json({ alerts: await view(kv, w) }, request);
    }
  } catch (e) {
    if (e instanceof LockBusy) return json({ error: "busy", hint: "Another change to your alerts is in flight. Try again." }, request, 409);
    return json({ error: "lock_unavailable", hint: "Couldn’t save right now. Nothing changed. Try again." }, request, 503);
  }
  return json({ error: "unknown_action" }, request, 404);
}
