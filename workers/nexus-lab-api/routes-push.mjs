// ── /push/* — phone alerts (push.mjs has the rules, webpush.mjs the crypto) ──
//   GET  /push/config       { enabled, publicKey }   the browser's applicationServerKey
//   POST /push/subscribe    { wallet, subscription, topics, labAuth }   wallet-signed (labAuth)
//   POST /push/topics       same body: change a device's switches (subscribe is idempotent)
//   POST /push/unsubscribe  { endpoint }   holding the endpoint is the proof
//   POST /push/test         { endpoint }   one test alert to that device, ≤1 per minute
//   POST /push/status       { endpoint }   does the server know this device? { subscribed }
//
// Why subscribe needs the wallet's signature: a device list is capped per wallet, so anyone able
// to add devices to YOUR wallet could push your real phone off the list. The signature is the same
// Lab signature the app already holds for a day (labAuth.mjs), so most people never see a prompt.
import { json, checkLabAuth } from "./shared.mjs";
import { parseVapidJwk, vapidPublicKey } from "./webpush.mjs";
import {
  pushEnabled, validSubscription, normTopics, saveSubscription, deleteSubscription,
  getSubscription, pushToDevice, pushEndpointOk, subId,
} from "./push.mjs";

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

export async function handlePush(parts, request, env) {
  if (parts[0] !== "push") return null;
  const route = parts[1] || "";

  if (route === "config" && request.method === "GET") {
    const jwk = parseVapidJwk(env.VAPID_PRIVATE_JWK);
    return json({ enabled: !!jwk, publicKey: jwk ? vapidPublicKey(jwk) : null }, request);
  }
  if (request.method !== "POST") return null;
  if (!pushEnabled(env)) return json({ error: "push_off" }, request, 404);
  const b = await body(request);
  if (!b || typeof b !== "object") return json({ error: "invalid json" }, request, 400);

  if (route === "subscribe" || route === "topics") {
    const wallet = String(b.wallet || "").trim().toLowerCase();
    if (!wallet) return json({ error: "wallet required" }, request, 400);
    if (!validSubscription(b.subscription)) return json({ error: "bad_subscription" }, request, 400);
    const auth = checkLabAuth(wallet, b.labAuth);
    if (!auth.ok) return json({ error: "sign_to_enable", reason: auth.reason }, request, 401);
    const r = await saveSubscription(env, wallet, b.subscription, normTopics(b.topics));
    return json({ ok: true, topics: r.topics }, request);
  }

  const endpoint = String(b.endpoint || "");
  if (!pushEndpointOk(endpoint)) return json({ error: "bad_endpoint" }, request, 400);

  if (route === "unsubscribe") {
    const r = await deleteSubscription(env, endpoint);
    return json({ ok: true, removed: r.removed }, request);
  }

  // The app asks this on open: a device can hold a subscription the server has no record of (the
  // record was dropped after the push service said the device was gone, or the save never landed),
  // and then it would read "On" while nothing could reach it.
  if (route === "status") {
    const rec = await getSubscription(env, endpoint);
    return json({ subscribed: !!rec }, request);
  }

  if (route === "test") {
    const rec = await getSubscription(env, endpoint);
    if (!rec) return json({ error: "not_subscribed" }, request, 404);
    const gate = `push:testat:${await subId(endpoint)}`;
    if (await env.LAB_STORE.get(gate)) return json({ error: "rate_limited", retryAfterSec: 60 }, request, 429);
    await env.LAB_STORE.put(gate, "1", { expirationTtl: 60 });
    const r = await pushToDevice(env, rec, {
      title: "Nexus",
      body: "Alerts are on for this device.",
      url: "/",
      tag: "nexus-test",
    });
    return json({ ok: r.ok, status: r.status, gone: !!r.gone }, request, r.ok ? 200 : 502);
  }
  return null;
}
