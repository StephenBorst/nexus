// ── Phone alerts: who gets pushed what ────────────────────────────────────────
// The rules (pure, tested) plus the KV store behind them. HTTP routes live in routes-push.mjs;
// the encryption in webpush.mjs. Off until the VAPID_PRIVATE_JWK secret is set: every entry point
// returns early without a KV read, so tests and deploys without the secret see no change.
//
// Two alerts to start (borst, 2026-10-04): "your call was graded" (via appendNotification, which the
// hourly grader already calls) and "your agent opened/closed a trade" (a 5-min watcher that READS
// agent:state — it never writes an engine key, so the Oct-15 measurement is untouched). Social
// alerts (comments, follows, copies…) ride the same path behind a topic that starts OFF.
//
// KV (LAB_STORE):
//   push:sub:{id}        one device's subscription { endpoint, keys, wallet, topics, createdAt }
//   push:wallet:{addr}   that wallet's device ids (newest last, ≤ MAX_DEVICES)
//   push:agentwatch      wallets with ≥1 device that wants agent alerts
//   push:agentseen:{addr} the last agent position the watcher saw

import { parseVapidJwk, sendWebPush } from "./webpush.mjs";

export const MAX_DEVICES = 10;
export const AGENT_WATCH_MAX = 200;
export const VAPID_SUBJECT = "https://nexustradinglabs.com";

// Push services we will POST to. A subscription is a URL the client hands us, so without this
// list the worker could be pointed at any host (SSRF). These are the services browsers use.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Android, the TWA, Brave, Edge on Android
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge on Windows
  /^web\.push\.apple\.com$/,                // Safari
  /^[a-z0-9.-]+\.push\.apple\.com$/,
];

export function pushEndpointOk(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

export function validSubscription(s) {
  const p256dh = s?.keys?.p256dh, auth = s?.keys?.auth;
  return !!s && pushEndpointOk(s.endpoint) && String(s.endpoint).length <= 1024
    && typeof p256dh === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(p256dh)
    && typeof auth === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(auth);
}

export const DEFAULT_TOPICS = Object.freeze({ calls: true, agent: true, social: false });

export function normTopics(t) {
  const o = t && typeof t === "object" ? t : {};
  return {
    calls: typeof o.calls === "boolean" ? o.calls : DEFAULT_TOPICS.calls,
    agent: typeof o.agent === "boolean" ? o.agent : DEFAULT_TOPICS.agent,
    social: typeof o.social === "boolean" ? o.social : DEFAULT_TOPICS.social,
  };
}

/** Which switch an in-app notification type sits behind. null = never pushed. */
export function topicForType(type) {
  if (type === "call_resolved" || type === "thesis_closed" || type === "call_fill" || type === "call_tp1") return "calls";
  if (type === "agent_trade") return "agent";
  if (["comment", "reaction", "follow", "copy", "challenge"].includes(type)) return "social";
  return null;
}

const TITLES = {
  call_resolved: "Call graded",
  thesis_closed: "Call closed",
  call_fill: "Call filled",
  call_tp1: "TP1 reached",
  agent_trade: "Agent",
  comment: "New comment",
  reaction: "New reaction",
  follow: "New follower",
  copy: "Call copied",
  challenge: "Call challenged",
};

/** What the phone shows, and where a tap goes. Same text as the in-app bell. */
export function notifPayload(notif, wallet) {
  const w = String(wallet || "").toLowerCase();
  let url = "/";
  if (notif?.url && typeof notif.url === "string" && notif.url.startsWith("/")) url = notif.url;
  else if (notif?.thesisId) url = `/feed/thesis/${String(notif.thesisWallet || w).toLowerCase()}/${notif.thesisId}`;
  return {
    title: TITLES[notif?.type] || "Nexus",
    body: String(notif?.message || "").slice(0, 240),
    url,
    tag: String(notif?.id || notif?.type || "nexus").slice(0, 64),
  };
}

export async function subId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(endpoint))));
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const pushEnabled = (env) => !!parseVapidJwk(env?.VAPID_PRIVATE_JWK);

const readJson = async (kv, key, fallback) => {
  try { const r = await kv.get(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
};

async function syncAgentWatch(kv, wallet, wants) {
  const list = await readJson(kv, "push:agentwatch", []);
  const has = list.includes(wallet);
  if (wants && !has) await kv.put("push:agentwatch", JSON.stringify([...list, wallet].slice(-AGENT_WATCH_MAX)));
  if (!wants && has) await kv.put("push:agentwatch", JSON.stringify(list.filter((x) => x !== wallet)));
}

async function walletWantsAgent(kv, wallet, ids) {
  for (const id of ids) {
    const s = await readJson(kv, `push:sub:${id}`, null);
    if (s && normTopics(s.topics).agent) return true;
  }
  return false;
}

/** Store (or update) one device for one wallet. Caller has already checked the wallet's signature. */
export async function saveSubscription(env, wallet, sub, topics) {
  const kv = env.LAB_STORE;
  const w = String(wallet).toLowerCase();
  const id = await subId(sub.endpoint);
  // A device moves to the wallet that signed last (one phone, one wallet's alerts).
  const prev = await readJson(kv, `push:sub:${id}`, null);
  if (prev && prev.wallet && prev.wallet !== w) await removeFromWallet(kv, prev.wallet, id);
  const rec = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, wallet: w, topics: normTopics(topics), createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now() };
  await kv.put(`push:sub:${id}`, JSON.stringify(rec));
  let ids = (await readJson(kv, `push:wallet:${w}`, [])).filter((x) => x !== id);
  ids.push(id);
  const dropped = ids.length > MAX_DEVICES ? ids.slice(0, ids.length - MAX_DEVICES) : [];
  ids = ids.slice(-MAX_DEVICES);
  for (const d of dropped) await kv.delete(`push:sub:${d}`);
  await kv.put(`push:wallet:${w}`, JSON.stringify(ids));
  await syncAgentWatch(kv, w, await walletWantsAgent(kv, w, ids));
  return { id, topics: rec.topics };
}

async function removeFromWallet(kv, wallet, id) {
  const ids = (await readJson(kv, `push:wallet:${wallet}`, [])).filter((x) => x !== id);
  if (ids.length) await kv.put(`push:wallet:${wallet}`, JSON.stringify(ids));
  else await kv.delete(`push:wallet:${wallet}`);
  await syncAgentWatch(kv, wallet, ids.length ? await walletWantsAgent(kv, wallet, ids) : false);
}

/** Forget one device. Knowing the endpoint is the proof: only that browser holds it. */
export async function deleteSubscription(env, endpoint) {
  const kv = env.LAB_STORE;
  const id = await subId(endpoint);
  const rec = await readJson(kv, `push:sub:${id}`, null);
  await kv.delete(`push:sub:${id}`);
  if (rec?.wallet) await removeFromWallet(kv, rec.wallet, id);
  return { removed: !!rec };
}

export async function getSubscription(env, endpoint) {
  return readJson(env.LAB_STORE, `push:sub:${await subId(endpoint)}`, null);
}

/** Push one prepared payload to one stored device; deletes it if the push service says it's gone. */
export async function pushToDevice(env, rec, payload, { fetchImpl } = {}) {
  const jwk = parseVapidJwk(env.VAPID_PRIVATE_JWK);
  if (!jwk) return { ok: false, status: 0, off: true };
  const r = await sendWebPush(rec, payload, { jwk, subject: VAPID_SUBJECT, topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32), fetchImpl });
  if (r.gone) await deleteSubscription(env, rec.endpoint);
  return r;
}

/**
 * The push leg of appendNotification: every device of `wallet` whose switch for this type is on.
 * Best-effort, never throws, and does nothing (no KV read) while push is off.
 */
export async function pushNotification(env, wallet, notif, { fetchImpl } = {}) {
  if (!pushEnabled(env)) return { sent: 0, skipped: "off" };
  const topic = topicForType(notif?.type);
  if (!topic) return { sent: 0, skipped: "type" };
  const kv = env.LAB_STORE;
  const w = String(wallet).toLowerCase();
  let sent = 0;
  try {
    const ids = await readJson(kv, `push:wallet:${w}`, []);
    const payload = notifPayload(notif, w);
    for (const id of ids) {
      const rec = await readJson(kv, `push:sub:${id}`, null);
      if (!rec || !normTopics(rec.topics)[topic]) continue;
      const r = await pushToDevice(env, rec, payload, { fetchImpl });
      if (r.ok) sent++;
      else if (!r.gone) console.error(`[push] ${w.slice(0, 10)} send failed: ${r.status} ${r.error || ""}`);
    }
  } catch (e) { console.error("[push] fan-out failed", e?.message || e); }
  return { sent };
}

// ── Agent trades ──────────────────────────────────────────────────────────────
// Read-only: the exec worker owns agent:state. We compare what it holds now with what we saw
// last time and announce the difference. The first look at a wallet only records a baseline, so
// switching alerts on never replays old trades.

const bare = (s) => String(s || "").replace("PERP_", "").replace("_USDC", "");
const fmtUsd = (n) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;
const fmtPx = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Number(v.toPrecision(5)));
};

export function agentSnapshot(state) {
  const p = state?.current_position;
  return {
    pos: p && p.symbol && p.opened_at ? `${p.symbol}|${p.direction}|${p.opened_at}` : null,
    posInfo: p && p.symbol ? { symbol: p.symbol, direction: p.direction, entry: p.entry_price ?? null, paper: !!p.paper } : null,
    lastPaperId: Array.isArray(state?.paper_trades) && state.paper_trades[0]?.id ? state.paper_trades[0].id : null,
  };
}

/**
 * What changed between two looks at one agent. Returns the new snapshot and the events to
 * announce: an OPEN when a new position appears, a CLOSE when one goes away. A paper close carries
 * its P&L and exit (from the new paper_trades rows); a live close doesn't (live P&L lives in the
 * trade log, not in state), so it says where to look instead of guessing a number.
 */
export function agentTransitions(prev, state) {
  const snap = agentSnapshot(state);
  if (!prev) return { snap, events: [] };
  const events = [];
  const rows = Array.isArray(state?.paper_trades) ? state.paper_trades : [];
  // Paper rows written since the last look (newest first). If the old marker is gone (a reset),
  // claim nothing rather than replay the window.
  let fresh = [];
  if (prev.lastPaperId !== snap.lastPaperId) {
    const at = prev.lastPaperId ? rows.findIndex((r) => r?.id === prev.lastPaperId) : rows.length;
    if (at > 0) fresh = rows.slice(0, Math.min(at, 5));
  }
  const fullCloses = fresh.filter((r) => r && r.reason !== "TP_PARTIAL");

  if (prev.pos && prev.pos !== snap.pos) {
    const info = prev.posInfo || {};
    const row = info.paper ? fullCloses.find((r) => r.symbol === info.symbol && r.direction === info.direction) : null;
    events.push({ kind: "close", symbol: info.symbol, direction: info.direction, paper: !!info.paper,
      pnl: row && Number.isFinite(Number(row.pnl)) ? Number(row.pnl) : null, reason: row?.reason || null });
    if (row) fullCloses.splice(fullCloses.indexOf(row), 1);
  }
  // Paper trades that opened AND closed between two looks never showed as a position: announce
  // the close from its row (the open is past news by then).
  for (const r of fullCloses.reverse()) {
    events.push({ kind: "close", symbol: r.symbol, direction: r.direction, paper: true,
      pnl: Number.isFinite(Number(r.pnl)) ? Number(r.pnl) : null, reason: r.reason || null });
  }
  if (snap.pos && snap.pos !== prev.pos) {
    const i = snap.posInfo;
    events.push({ kind: "open", symbol: i.symbol, direction: i.direction, paper: i.paper, entry: i.entry });
  }
  return { snap, events };
}

/** One line, the same on the phone and in the bell. */
export function agentEventMessage(ev) {
  const sym = bare(ev.symbol);
  const dir = String(ev.direction || "").toUpperCase();
  const tag = ev.paper ? " · paper" : "";
  if (ev.kind === "open") {
    const px = fmtPx(ev.entry);
    return `Agent opened ${sym} ${dir}${px ? ` at ${px}` : ""}${tag}`;
  }
  const how = ev.reason ? ` · ${ev.reason}` : "";
  const pnl = ev.pnl != null ? ` · ${fmtUsd(ev.pnl)}` : ev.paper ? "" : " · result in your History tab";
  return `Agent closed ${sym} ${dir}${how}${pnl}${tag}`;
}

/**
 * The 5-minute pass. `notify(wallet, notif)` is appendNotification (in-app bell + push), injected
 * so this file stays free of the route helpers. Reads agent:state from NEXUS_AGENT; writes only
 * push:agentseen:* in LAB_STORE.
 */
export async function runAgentWatch(env, notify) {
  if (!pushEnabled(env)) return { watched: 0, events: 0, skipped: "off" };
  const kv = env.LAB_STORE;
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  const wallets = (await readJson(kv, "push:agentwatch", [])).slice(0, AGENT_WATCH_MAX);
  let events = 0;
  for (const w of wallets) {
    try {
      const state = await readJson(AGENT_KV, `agent:state:${w}`, null);
      if (!state) continue;
      const prev = await readJson(kv, `push:agentseen:${w}`, null);
      const { snap, events: evs } = agentTransitions(prev, state);
      // Save the new baseline FIRST: if a send fails we'd rather miss one alert than repeat it.
      if (!prev || JSON.stringify(prev) !== JSON.stringify(snap)) await kv.put(`push:agentseen:${w}`, JSON.stringify(snap));
      for (const ev of evs) {
        await notify(w, {
          id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: "agent_trade",
          message: agentEventMessage(ev),
          url: "/lab?tab=agent",
          createdAt: Date.now(),
          read: false,
        });
        events++;
      }
    } catch (e) { console.error(`[push] agent watch ${String(w).slice(0, 10)} failed`, e?.message || e); }
  }
  return { watched: wallets.length, events };
}
