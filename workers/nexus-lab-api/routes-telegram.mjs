// ── Telegram: link a chat to a wallet, and the bot's webhook ─────────────────────────────────
// Moved out of index.js (2026-10-16) when the link got an owner check. The app used to open the
// bot as t.me/<bot>?start=<wallet>, and the bot linked whatever address it was sent: anyone could
// message it "/start 0xSOMEONE" and that wallet's agent alerts and notifications went to THEIR chat
// (the owner's chat stopped getting them, silently). Now:
//   • the app asks for a one-time code with the wallet's Lab signature (POST /tg/link), and the deep
//     link carries the code, never the address. A code lasts 10 minutes and links once;
//   • "/start <address>" links nothing and says where links come from now;
//   • the webhook checks Telegram's secret header once the worker has registered it (the hourly cron
//     does that itself, see secureTelegramWebhook), so a forged update is refused too.
//
//   POST /tg/link     body { wallet, labAuth }  → { code, url, command, expiresInSec }
//   GET  /tg/status                             → { secured, securedAt, lastCheck } (no secrets)
//   POST /tg/webhook                            → Telegram's updates (200 "ok")
import { json } from "./shared.mjs";
import { provenWallet, unsignedSocial } from "./socialAuth.mjs";

export const TG_BOT = "nexustradinglabs_bot";
export const TG_WEBHOOK_URL = "https://og.nexustradinglabs.com/tg/webhook";
export const LINK_CODE_TTL_SEC = 600;
export const LINK_CODE_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url (Telegram allows ≤64 of these)
const STATE_KEY = "tg:webhook:state";

const agentKv = (env) => env.NEXUS_AGENT || env.LAB_STORE;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function newLinkCode() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token. Derived from the bot token,
 * so there is no second secret to set or keep in sync; a new bot token gives a new one, and the cron
 * registers it. null without a token.
 */
export async function webhookSecret(env) {
  return env.TELEGRAM_TOKEN ? sha256Hex(`nexus-tg-webhook-v1:${env.TELEGRAM_TOKEN}`) : null;
}
const fingerprint = async (secret) => (await sha256Hex(`fp:${secret}`)).slice(0, 16);

function sameString(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readState(env) {
  try { return JSON.parse((await agentKv(env).get(STATE_KEY)) || "null"); } catch { return null; }
}

/**
 * Is this webhook request from Telegram? Before the worker has registered its secret with Telegram
 * (state.fp missing, or made with an older bot token) every request passes, as before. After, the
 * header must match. { ok, enforced }.
 */
export async function checkWebhook(request, env) {
  const secret = await webhookSecret(env);
  if (!secret) return { ok: true, enforced: false };
  const state = await readState(env);
  if (!state?.fp || state.fp !== (await fingerprint(secret))) return { ok: true, enforced: false };
  return { ok: sameString(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", secret), enforced: true };
}

/**
 * Register the webhook secret with Telegram (hourly cron; a no-op once done). Only re-registers the
 * webhook Telegram ALREADY has, and only if it points at TG_WEBHOOK_URL: a webhook set somewhere
 * else is left alone and reported. Keeps the webhook's own allowed_updates / max_connections.
 * Enforcement starts (state.fp written) only after Telegram answers ok.
 */
export async function secureTelegramWebhook(env, { fetch: f = fetch, now = Date.now } = {}) {
  const secret = await webhookSecret(env);
  if (!secret) return { result: "no_token" };
  const kv = agentKv(env);
  const state = (await readState(env)) || {};
  const fp = await fingerprint(secret);
  if (state.fp === fp) return { result: "already_secured" };
  const api = (m) => `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${m}`;
  const record = async (result, extra = {}) => {
    await kv.put(STATE_KEY, JSON.stringify({ ...state, ...extra, lastCheck: { at: now(), result } }));
    return { result };
  };
  let info;
  try { info = await (await f(api("getWebhookInfo"))).json(); } catch { return record("info_unreadable"); }
  const hook = info?.result;
  if (!info?.ok || !hook) return record("info_unreadable");
  if (hook.url !== TG_WEBHOOK_URL) {
    console.error(`[tg] webhook points at ${hook.url || "(none)"}, not ${TG_WEBHOOK_URL}: secret not registered`);
    return record("url_mismatch");
  }
  const params = { url: TG_WEBHOOK_URL, secret_token: secret };
  if (Array.isArray(hook.allowed_updates)) params.allowed_updates = hook.allowed_updates;
  if (Number.isInteger(hook.max_connections)) params.max_connections = hook.max_connections;
  let set;
  try {
    set = await (await f(api("setWebhook"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    })).json();
  } catch { return record("set_failed"); }
  if (set?.ok !== true) return record("set_failed");
  return record("secured", { fp, securedAt: now() });
}

const short = (w) => (w.startsWith("0x") ? `${w.slice(0, 6)}…${w.slice(-4)}` : `${w.slice(0, 4)}…${w.slice(-4)}`);
const looksLikeWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

async function bodyOrNull(request) {
  try { return await request.json(); } catch { return null; }
}

export async function handleTelegram(parts, request, env, { now = Date.now, fetch: f = fetch } = {}) {
  if (parts[0] !== "tg") return null;
  const kv = agentKv(env);

  // POST /tg/link — a one-time code for the deep link (owner only).
  if (parts[1] === "link" && parts.length === 2 && request.method === "POST") {
    const body = await bodyOrNull(request);
    const who = provenWallet(body?.wallet, body?.labAuth, now());
    if (!who.ok) return unsignedSocial(request, who);
    const code = newLinkCode();
    await kv.put(`tg:linkcode:${code}`, JSON.stringify({ wallet: who.wallet, at: now() }), { expirationTtl: LINK_CODE_TTL_SEC });
    return json({
      ok: true, code, url: `https://t.me/${TG_BOT}?start=${code}`, command: `/start ${code}`, expiresInSec: LINK_CODE_TTL_SEC,
    }, request);
  }

  // GET /tg/status — is the webhook checking Telegram's secret yet? No secrets, no URL.
  if (parts[1] === "status" && parts.length === 2 && request.method === "GET") {
    const secret = await webhookSecret(env);
    const state = await readState(env);
    const secured = !!(secret && state?.fp && state.fp === (await fingerprint(secret)));
    return json({ secured, securedAt: secured ? state.securedAt ?? null : null, lastCheck: state?.lastCheck ?? null }, request);
  }

  if (parts[1] === "webhook" && parts.length === 2 && request.method === "POST") {
    const gate = await checkWebhook(request, env);
    if (!gate.ok) return new Response("forbidden", { status: 401 });
    const upd = await bodyOrNull(request);
    const msg = upd?.message || upd?.edited_message;
    const chatId = msg?.chat?.id;
    const text = String(msg?.text || "").trim();
    const reply = async (t) => {
      if (!env.TELEGRAM_TOKEN || !chatId) return;
      try {
        await f(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: "HTML", disable_web_page_preview: true }),
        });
      } catch { /* fail-soft */ }
    };

    if (chatId && text.startsWith("/signals")) {
      // Opt in/out of the highest-conviction market signal push (separate from agent trade
      // alerts). Keyed by chatId: it only ever messages the chat that asked.
      const onoff = (text.split(/\s+/)[1] || "on").toLowerCase();
      if (onoff === "off" || onoff === "stop") {
        await kv.delete(`signals:sub:${chatId}`);
        await reply("🔕 Signals off. Send /signals on to get the top Nexus market signal again.");
      } else {
        await kv.put(`signals:sub:${chatId}`, "1");
        await reply("◆ Signals on. You'll get the single highest-conviction Nexus signal when it fires — funding + the graded caller crowd aligned, or a sharp disagreement. At most once every few hours. Send /signals off to stop.");
      }
    } else if (chatId && text.startsWith("/start")) {
      const arg = text.split(/\s+/)[1] || "";
      if (LINK_CODE_RE.test(arg)) {
        let link = null;
        try { link = JSON.parse((await kv.get(`tg:linkcode:${arg}`)) || "null"); } catch { link = null; }
        if (link && typeof link.wallet === "string") {
          await kv.delete(`tg:linkcode:${arg}`); // one use
          await kv.put(`tg:chat:${link.wallet}`, String(chatId));
          await kv.put(`tg:wallet:${chatId}`, link.wallet);
          await reply(`Linked to <code>${short(link.wallet)}</code>. You'll get a message when your Nexus agent opens or closes a trade, and your Nexus notifications. Send /stop to unlink. Market signals too: send /signals on.`);
        } else {
          await reply("That link wasn't found. A link lasts 10 minutes and works once. If you just made it, send it again in a few seconds. Otherwise make a new one: Nexus Trading Labs → Lab → Agent → Link Telegram.");
        }
      } else if (looksLikeWallet(arg)) {
        // The old deep link. A wallet address alone proves nothing, so it links nothing.
        await reply("Links come from the app now: Nexus Trading Labs → Lab → Agent → Link Telegram. The app makes a one-time link after your wallet signs. A wallet address alone can't link a chat.");
      } else {
        await reply("To get Nexus agent trade alerts: Nexus Trading Labs → Lab → Agent → Link Telegram. For market signals, send /signals on.");
      }
    } else if (chatId && text.startsWith("/stop")) {
      const stopArg = text.split(/\s+/)[1] || "";
      const stopAddr = looksLikeWallet(stopArg) ? stopArg.toLowerCase() : null;
      if (stopAddr) {
        // Unlink the named wallet, but only if it's linked to THIS chat.
        const linkedChat = await kv.get(`tg:chat:${stopAddr}`);
        if (String(linkedChat) === String(chatId)) {
          await kv.delete(`tg:chat:${stopAddr}`);
          const cur = await kv.get(`tg:wallet:${chatId}`);
          if (cur === stopAddr) await kv.delete(`tg:wallet:${chatId}`);
          await reply(`Unlinked <code>${short(stopAddr)}</code>. Link again from the Agent tab.`);
        } else {
          await reply("That wallet isn't linked to this chat.");
        }
      } else {
        // No arg: unlink the most recently linked wallet for this chat, if it still points here.
        const addr = await kv.get(`tg:wallet:${chatId}`);
        if (addr && String(await kv.get(`tg:chat:${addr}`)) === String(chatId)) await kv.delete(`tg:chat:${addr}`);
        await kv.delete(`tg:wallet:${chatId}`);
        await reply("Unlinked. Link again from the Agent tab.");
      }
    }
    return new Response("ok"); // Telegram only needs a 200
  }
  return null;
}
