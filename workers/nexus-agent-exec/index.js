// ═══════════════════════════════════════════════════════════
// nexus-agent-exec — Multi-User Execution Engine
// Cron: every 1 minute
// KV binding: NEXUS_AGENT
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY
//
// Reads agent:users → for each active user:
//   - Checks kill switch
//   - If holding position → monitor TP/SL/timeout
//   - If no position → read signal → execute if conditions met
//   - Logs trades to Supabase
// ═══════════════════════════════════════════════════════════

import { orderlyGet } from "../nexus-lab-api/orderlyGet.mjs";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { accruePaperAgg } from "../../app/lib/paperStats.mjs";
import { nextPaperHead, paperSeqKey, GENESIS_HEAD } from "../../app/lib/paperLedger.mjs";
import { runKill } from "./killSwitch.mjs";
import { backstopWanted, backstopTrigger, backstopOrder, algoOrderIdFrom, cancelPath, backstopHit, sweepStaleBackstops, BACKSTOP_MAX_TRIES, BACKSTOP_MULT } from "./backstop.mjs";
import { resolveKeyRecord, keyHoldRefusal, keyAlertDue, keyAlertText, isKeyPointer } from "./agentKey.mjs";
import { LIVE_HALT_KEY, parseLiveHalt, HALT_READ_FAILED, haltBlocksEntry } from "../../app/lib/liveHalt.mjs";
import { usesGradedExit, gradedExitRefusal, gradedExitLevelsFromHourly, GRADED_EXIT_LOOKBACK_H } from "../../app/lib/gradedExit.mjs";
import { usesRiskSizing, riskSizingRefusal, riskSizedMargin, riskTaken } from "../../app/lib/riskSizing.mjs";
import { snapQty, shouldResetDaily, dailyCapBlocked, computePnl, agentThesisLevels, agentCloseStatus, volScaledLevels, evaluateExit, normTakeProfits, dcaUnitMargin, nextSafetyOrder, blendAvg, breakevenArmed, resolveExitPrice, directiveExpired, directiveShouldFill, directiveLevels, volScaledCapital, realizedVolPct, selectCopySignal, AUTOCOPY_MAX_LEADERS, twapDueSlices, twapProgress, twapSliceFailed, brainSignalKey, alreadyTradedSignal, portfolioDeltaCheck, buildCallbackPayload, exchangePositionQty, exchangePositionRows, fillPriceFrom } from "./logic.mjs";

const ORDERLY_API = "https://api-evm.orderly.org";
const COOLDOWN_MS = 15 * 60 * 1000; // 15 min between trades

// Orderly sits behind Cloudflare bot-management, which intermittently serves an
// HTML 403 challenge to our header-light Worker fetches (breaks position reads /
// mark price → reconcile + adoption fail). Sending realistic browser headers clears
// the challenge; a bounded retry rides out a transient one within a tick.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Public (unauthed) Orderly GET → parsed JSON. One implementation with lab-api (orderlyGet.mjs, tested): a JSON 429 and an HTML challenge are
// retried with backoff + jitter and logged `[orderly] RATE LIMITED`; the final failure THROWS.
// Before, a JSON 429 came back as data: callers crashed on `data.data.…` (tick lost, unlogged) or
// fell back to defaults. Other JSON error bodies still come back as data, as they did.
const orderlyPublicGet = (url) => orderlyGet(url, { httpErrors: "return" });

// ── Agent → public Feed bridge ────────────────────────────────────────────────
// Surfaces the bot's real autonomous trades on the public feed so it has a live
// heartbeat instead of looking abandoned (cold-start fix). Records are written
// per-user to agent:feed:{address} (single-writer: only this user's processUser
// touches its own key, so no cross-user race). lab-api's /feed merges them.
// Re-enabled: the agent's win rate / track record is already public on the agents
// leaderboard, so withholding entries from the feed wasn't actually hiding the
// performance — it just made the agent look abandoned. The OWNER always sees full
// truth on their dash; this surfaces real autonomous entries/closes publicly again.
const PUBLISH_AGENT_FEED = true;
// Keep simulated PAPER trades OUT of the public feed — the feed is the "these are
// real calls" surface and mixing sims (even labeled) dilutes the trust moat.
const PUBLISH_PAPER_TO_FEED = false;
const AGENT_FEED_CAP = 12; // keep the last N agent calls per user

// Build + store a public feed thesis for a fresh agent entry; returns its id so
// the close path can find and resolve it. Shape matches the human-thesis feed
// record so the existing feed UI renders it unchanged.
async function publishAgentEntry(address, env, { config, signal, markPrice, qty }) {
  const now = Date.now();
  const { stopLoss, takeProfit1, riskReward } = agentThesisLevels({
    entryPrice: markPrice, direction: signal.direction,
    tpPercent: config.tpPercent, slPercent: config.slPercent,
  });
  // Style is defined by hold time (mirrors the frontend deriveStyle).
  const style = (config.maxHoldHours ?? 0) <= 8 ? "DAY" : (config.maxHoldHours ?? 0) <= 120 ? "SWING" : "POSITION";
  const strategy = `${style} · ${config.signalMode || "CONFLUENCE"}${config.dcaEnabled ? " · DCA" : ""}`;
  const record = {
    id: `agent_${address.slice(2, 8)}_${now}`,
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: markPrice,
    stopLoss,
    takeProfit1,
    takeProfit2: 0,
    riskReward,
    positionSize: qty * markPrice,
    leverage: config.leverage,
    status: "ACTIVE",
    actualPnl: null,
    createdAt: now,
    strategy,
    notes: `[${strategy}] Autonomous agent entry (confidence ${signal.confidence}%). Plan: TP +${config.tpPercent}% / SL -${config.slPercent}% / ${config.maxHoldHours}h max hold.`,
    isPublic: true,
    agent: true,
  };
  const raw = await env.NEXUS_AGENT.get(`agent:feed:${address}`);
  const list = raw ? JSON.parse(raw) : [];
  list.unshift(record);
  if (list.length > AGENT_FEED_CAP) list.length = AGENT_FEED_CAP;
  await env.NEXUS_AGENT.put(`agent:feed:${address}`, JSON.stringify(list));
  return record.id;
}

// Self-heal stray ACTIVE feed cards. When the agent is flat, NO published entry
// should still read ACTIVE — closePosition/reconcile normally resolve them, but a
// pre-fix orphan (state cleared without resolving the feed) can strand one as a
// zombie the user sees trading on the feed while the agent is idle. Called on the
// flat path: flip any lingering ACTIVE entries to CLOSED. One KV read; writes only
// when something actually changed (the common case is a no-op).
async function reconcileStaleFeed(address, env) {
  const raw = await env.NEXUS_AGENT.get(`agent:feed:${address}`);
  if (!raw) return;
  const list = JSON.parse(raw);
  let changed = false;
  for (const item of list) {
    if (item.status === "ACTIVE") { item.status = "CLOSED"; item.closedAt = Date.now(); changed = true; }
  }
  if (changed) await env.NEXUS_AGENT.put(`agent:feed:${address}`, JSON.stringify(list));
}

// Resolve a published agent thesis when its position closes.
async function publishAgentClose(address, env, feedId, { reason, pnlUsdc, exitPrice }) {
  if (!feedId) return;
  const raw = await env.NEXUS_AGENT.get(`agent:feed:${address}`);
  if (!raw) return;
  const list = JSON.parse(raw);
  const item = list.find((t) => t.id === feedId);
  if (!item) return;
  item.status = agentCloseStatus(reason);
  item.actualPnl = pnlUsdc;
  item.exitPrice = exitPrice;
  item.closedAt = Date.now();
  await env.NEXUS_AGENT.put(`agent:feed:${address}`, JSON.stringify(list));
}

// Fire a Telegram DM to the agent's owner if they've linked a chat (tg:chat:{addr},
// written by lab-api's /tg/webhook). Fire-and-forget + fully fail-soft — a notify
// failure must NEVER touch the trade lifecycle. No-ops unless TELEGRAM_TOKEN is set.
async function notifyTelegram(address, env, text) {
  if (!env.TELEGRAM_TOKEN) return;
  try {
    const chatId = await env.NEXUS_AGENT.get(`tg:chat:${address}`);
    if (!chatId) return;
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { console.error(`[exec] ${address.slice(0, 10)} tg notify failed:`, e.message); }
}

// ── Execution push callbacks (PRO) ───────────────────────────────────────────
// Outbound, HMAC-SHA256-signed POSTs to a user-registered callbackUrl, fired the
// tick an agent event lands (entry fill / DCA add / partial TP / close) so an
// operator never has to poll. Best-effort + bounded (3s/attempt, 1 retry) so a
// slow or dead endpoint can never stall the executor. Gated purely by the user
// having set callbackUrl + webhookSecret (PRO-enforced at config-write in lab-api).
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fireCallback(address, config, env, event, data) {
  const url = config?.callbackUrl, secret = config?.webhookSecret;
  if (!url || !secret) return;
  try {
    const body = JSON.stringify(buildCallbackPayload(event, { address, ...data, ts: Date.now() }));
    const sig = await hmacHex(secret, body);
    const headers = { "Content-Type": "application/json", "X-Nexus-Event": event, "X-Nexus-Signature": `sha256=${sig}` };
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) return;
      } catch { clearTimeout(t); }
      if (attempt === 0) await new Promise((res) => setTimeout(res, 300));
    }
    console.warn(`[exec] ${address.slice(0, 10)} callback ${event} undelivered after retry`);
  } catch (e) { console.error(`[exec] ${address.slice(0, 10)} callback ${event} failed:`, e.message); }
}

// Live open positions on the account as signed-notional legs for the portfolio
// delta cap — the WHOLE account (covers manual / Bankr / concurrent trades), not
// just this agent's tracked position. null = couldn't read (caller fails open).
async function fetchAccountPositions(keyData) {
  try {
    const res = await orderlyRequest(keyData, "GET", "/v1/positions");
    const rows = exchangePositionRows(res);
    if (rows === null) return null; // an error answer is unreadable, never "no positions"
    return rows
      .map((r) => ({ signedQty: Number(r.position_qty), mark: Number(r.mark_price ?? r.index_price ?? r.average_open_price) }))
      .filter((p) => Number.isFinite(p.signedQty) && Number.isFinite(p.mark) && p.signedQty !== 0);
  } catch { return null; }
}

// ── Decrypt the trading key stored at rest (AES-256-GCM, "v1:<iv>:<ct>") ──────
// Legacy plaintext keys (no "v1:" prefix) are passed through for backward compat
// until the user re-activates and the key is re-stored encrypted.
async function decryptTradingKey(stored, env) {
  if (typeof stored !== "string" || !stored.startsWith("v1:")) return stored; // legacy plaintext
  if (!env.AGENT_ENC_KEY) throw new Error("AGENT_ENC_KEY not configured");
  const [, ivB64, ctB64] = stored.split(":");
  const rawKey = Uint8Array.from(atob(env.AGENT_ENC_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// What resolveKeyRecord needs to follow a v2 pointer (agentKey.mjs) and open a sealed key.
const keyIo = (address, env) => ({ address, kv: env.NEXUS_AGENT, decrypt: (sealed) => decryptTradingKey(sealed, env) });

// The price a live market order actually filled at (logic.mjs fillPriceFrom), read right after the
// order: once now, once more ~0.5 s later if Orderly hasn't reported the fill yet. Never throws; an
// unreadable answer books the fallback (the mark) tagged source "mark".
async function readFill(keyData, orderId, fallback) {
  if (!orderId) return { price: fallback, source: "mark" };
  for (let i = 0; i < 2; i++) {
    try {
      const f = fillPriceFrom(await orderlyRequest(keyData, "GET", `/v1/order/${orderId}`), fallback);
      if (f.source === "exchange") return f;
    } catch { /* fall through */ }
    if (i === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return { price: fallback, source: "mark" };
}

// Sign Orderly API request with a user's delegated trading key.
//
// Proven pattern from the original single-user bot (Session Handoff 012):
//   - Orderly secret keys are 44-char base58-encoded 32-byte ed25519 seeds.
//   - Web Crypto (crypto.subtle) CANNOT sign with raw ed25519 seeds — must use
//     @noble/ed25519 signAsync(), which handles seed expansion internally.
//   - Signatures must be base64URL (not standard base64): +→-, /→_, strip =.
//   - The orderly-key header is the PUBLIC key (ed25519: prefix), derived from
//     the private key — NOT a slice of the secret.
async function orderlyRequest(keyData, method, path, body = null) {
  const bodyStr = body ? JSON.stringify(body) : "";
  const secret = keyData.tradingKey.replace(/^ed25519:/, "");
  const privKey = bs58.decode(secret);
  const pubKeyBytes = await ed.getPublicKeyAsync(privKey);
  const orderlyKey = `ed25519:${bs58.encode(pubKeyBytes)}`;

  // Orderly expects application/json for POST/PUT bodies and
  // application/x-www-form-urlencoded for GET (per Handoff 012).
  // DELETE (cancel an algo order, params in the query) is form-encoded too, as the SDK sends it.
  const contentType = method === "GET" || method === "DELETE"
    ? "application/x-www-form-urlencoded"
    : "application/json";

  // Retry the Cloudflare 403 bot-challenge a couple of times, RE-SIGNING each attempt
  // (the signature is bound to a fresh timestamp — a reused stale one is rejected).
  // Browser headers clear the challenge; the retry rides out a transient one.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = Date.now().toString();
    const message = `${timestamp}${method}${path}${bodyStr}`;
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    const signature = btoa(String.fromCharCode(...sig))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch(`${ORDERLY_API}${path}`, {
      method,
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": contentType,
        "orderly-timestamp": timestamp,
        "orderly-account-id": keyData.accountId,
        "orderly-key": orderlyKey,
        "orderly-signature": signature,
      },
      body: body ? bodyStr : undefined,
    });

    // Orderly normally returns JSON; a Cloudflare challenge / outage to the worker
    // IP returns an HTML page, which res.json() would surface as the opaque
    // "Unexpected token '<'". Parse defensively so logs name the real failure.
    const text = await res.text();
    try { return JSON.parse(text); }
    catch {
      lastErr = new Error(`orderly ${method} ${path} non-JSON (HTTP ${res.status}): ${text.slice(0, 80)}`);
      if (res.status === 403 && attempt < 2) { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue; }
      throw lastErr;
    }
  }
  throw lastErr;
}

// Per-invocation mark-price cache. The public futures price is identical for
// every user watching a symbol, so fetch it once per symbol per tick instead of
// once per user. Stores the in-flight promise so concurrent users in a batch
// dedupe onto the same request.
function getMarkPrice(symbol, env, cache) {
  if (!cache.has(symbol)) {
    cache.set(symbol, (async () => {
      const data = await orderlyPublicGet(`${ORDERLY_API}/v1/public/futures/${symbol}`);
      return parseFloat(data.data.mark_price);
    })());
  }
  return cache.get(symbol);
}

const BATCH_SIZE = 10; // bounded concurrency — fast without hammering the APIs

export default {
  // Read-only health/heartbeat endpoint for ops monitoring.
  async fetch(request, env) {
    let users = 0, lastTick = null;
    try {
      const u = await env.NEXUS_AGENT.get("agent:users");
      users = u ? JSON.parse(u).length : 0;
      lastTick = await env.NEXUS_AGENT.get("ops:exec:heartbeat");
    } catch (e) { return new Response("boot error: " + e.message, { status: 500 }); }
    const tickAgeSec = lastTick ? Math.round((Date.now() - Number(lastTick)) / 1000) : null;
    return new Response(JSON.stringify({ ok: true, users, lastTickAgeSec: tickAgeSec }), { headers: { "content-type": "application/json" } });
  },

  async scheduled(event, env) {
    try {
      // Heartbeat so ops can monitor that the 1-min cron is firing (mirrors the
      // brain's ops:brain:heartbeat). Cheap; lets us distinguish "agent idle by
      // design" from "exec cron actually stopped".
      await env.NEXUS_AGENT.put("ops:exec:heartbeat", String(Date.now()));
      const usersRaw = await env.NEXUS_AGENT.get("agent:users");
      if (!usersRaw) return;
      const users = JSON.parse(usersRaw);
      if (users.length === 0) return;

      // One shared price cache for the whole tick.
      const priceCache = new Map();

      // The owner's live-entry pause (app/lib/liveHalt.mjs), read once per tick. Unreadable = live
      // entries wait this tick (fail closed); exits and PAPER never read it.
      let liveHalt;
      try { liveHalt = parseLiveHalt(await env.NEXUS_AGENT.get(LIVE_HALT_KEY)); }
      catch (e) { liveHalt = HALT_READ_FAILED; console.error("[exec] halt flag read failed:", e.message); }

      // Process users in bounded-concurrency batches: O(users/BATCH) wall-clock
      // instead of O(users), while the price cache keeps public fetches at
      // O(unique symbols) regardless of user count.
      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((address) =>
            processUser(address, env, priceCache, liveHalt).catch((e) =>
              console.error(`[exec] ${address.slice(0, 10)} error:`, e.message)
            )
          )
        );
      }

      // ── TWAP pass — fire any due order slices ─────────────────────────────
      // Independent of the agent user set (a wallet can run a TWAP without the
      // agent). Shares the price cache. Each processTwap is fail-isolated.
      try {
        const twapRaw = await env.NEXUS_AGENT.get("twap:users");
        const twapUsers = twapRaw ? JSON.parse(twapRaw) : [];
        for (let i = 0; i < twapUsers.length; i += BATCH_SIZE) {
          const batch = twapUsers.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map((address) =>
              processTwap(address, env, priceCache).catch((e) =>
                console.error(`[twap] ${address.slice(0, 10)} error:`, e.message)
              )
            )
          );
        }
      } catch (e) { console.error("[twap] pass error:", e.message); }
    } catch (e) {
      console.error("[exec] fatal:", e.message);
    }
  },
};

// Remove a wallet from the twap:users index (called when a TWAP reaches a terminal
// state). Best-effort; the per-address state carries the authoritative status.
async function twapRemoveUser(address, env) {
  try {
    const raw = await env.NEXUS_AGENT.get("twap:users");
    const users = raw ? JSON.parse(raw) : [];
    const next = users.filter((a) => String(a).toLowerCase() !== String(address).toLowerCase());
    if (next.length !== users.length) await env.NEXUS_AGENT.put("twap:users", JSON.stringify(next));
  } catch { /* index cleanup is best-effort */ }
}

// Process one wallet's active TWAP: fire every child slice whose offset has elapsed,
// via the SAME order-only signing path the agent uses. SINGLE-WRITER: exec owns
// twap:{addr} once lab-api has created it. Idempotency: each slice is marked done +
// persisted the instant it fires, so a mid-tick failure never double-places it. A
// cancel is a dedicated twap:cancel:{addr} flag (consumed here) so it can't be lost
// to a state-write race — the agent:kill pattern.
async function processTwap(address, env, cache) {
  const raw = await env.NEXUS_AGENT.get(`twap:${address}`);
  if (!raw) { await twapRemoveUser(address, env); return; }
  const state = JSON.parse(raw);

  // Honor a cancel flag (dedicated key so it can't race the state write).
  const cancelled = await env.NEXUS_AGENT.get(`twap:cancel:${address}`);
  if (cancelled) {
    state.status = "CANCELLED";
    state.endedAt = Date.now();
    await env.NEXUS_AGENT.put(`twap:${address}`, JSON.stringify(state));
    await env.NEXUS_AGENT.delete(`twap:cancel:${address}`);
    await twapRemoveUser(address, env);
    console.log(`[twap] ${address.slice(0, 10)} cancelled at ${twapProgress(state).filled}/${state.slices.length}`);
    return;
  }

  const now = Date.now();
  const { due, complete } = twapDueSlices(state, now);
  if (complete) {
    if (state.status !== "COMPLETE") {
      state.status = "COMPLETE";
      state.endedAt = now;
      await env.NEXUS_AGENT.put(`twap:${address}`, JSON.stringify(state));
    }
    await twapRemoveUser(address, env);
    return;
  }
  if (!due.length) return;

  // Decrypt the order-only key once for this tick's fires.
  const keyRaw = await env.NEXUS_AGENT.get(`twap:key:${address}`);
  if (!keyRaw) { console.error(`[twap] no key for ${address.slice(0, 10)}`); return; }
  const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));

  // Set leverage once, before the first fill of the whole schedule.
  if (twapProgress(state).filled === 0 && state.leverage) {
    try { await orderlyRequest(keyData, "POST", "/v1/client/leverage", { symbol: state.symbol, leverage: state.leverage }); }
    catch (e) { console.error(`[twap] ${address.slice(0, 10)} leverage set failed:`, e.message); }
  }

  const mark = await getMarkPrice(state.symbol, env, cache);
  for (const slice of due) {
    const target = state.slices.find((s) => s.seq === slice.seq);
    if (!target || target.done) continue;
    try {
      const order = await orderlyRequest(keyData, "POST", "/v1/order", {
        symbol: state.symbol,
        order_type: "MARKET",
        side: state.side,
        order_quantity: target.qty,
        broker_id: "nexus_trading",
      });
      if (order && order.success === false) {
        Object.assign(target, twapSliceFailed(target, order.message || order.code || "rejected"));
        console.error(`[twap] ${address.slice(0, 10)} slice ${target.seq} rejected (try ${target.attempts}${target.skipped ? ", skipped" : ""}):`, target.error);
        // Retried next tick, up to TWAP_MAX_ATTEMPTS (logic.mjs); then skipped, never sent again, and
        // shown as skipped (not filled) in the status endpoint and the panel. Retrying forever kept the
        // TWAP open and could fill a slice hours late at a very different price.
      } else {
        target.done = true;
        target.firedAt = Date.now();
        target.orderId = order?.data?.order_id ?? null;
        target.filledNotional = mark ? parseFloat((target.qty * mark).toFixed(2)) : target.notionalEst;
        target.error = null;
      }
    } catch (e) {
      Object.assign(target, twapSliceFailed(target, e.message));
      console.error(`[twap] ${address.slice(0, 10)} slice ${target.seq} error (try ${target.attempts}${target.skipped ? ", skipped" : ""}):`, e.message);
    }
    // Persist after EACH slice → a crash can't double-fire an already-placed slice.
    await env.NEXUS_AGENT.put(`twap:${address}`, JSON.stringify(state));
  }

  // Terminal check after this tick's fires.
  if (twapDueSlices(state, Date.now()).complete) {
    state.status = "COMPLETE";
    state.endedAt = Date.now();
    await env.NEXUS_AGENT.put(`twap:${address}`, JSON.stringify(state));
    await twapRemoveUser(address, env);
    console.log(`[twap] ${address.slice(0, 10)} complete — ${state.slices.length} slices`);
  }
}

// Recover an untracked live position (a "ghost"): the agent is flat in KV but a real
// position exists on the exchange — e.g. a reconcile misfire or a rare KV-write miss
// after entry. Because Orderly nets all exposure per symbol into ONE position, any
// live position on a CONFIGURED symbol is the agent's to manage (the product rule is
// that the user stays flat while the agent runs). Re-attach it so the monitor resumes
// TP/SL/timeout instead of letting it sit unmanaged. AUTONOMOUS-only (the only mode
// that places real orders) and rate-limited so flat agents don't poll positions every
// tick. Returns true if a position was adopted (caller manages it next tick).
async function adoptOrphanPosition(address, state, config, env, _cache) {
  const now = Date.now();
  // Probed every flat tick — a ghost is urgent (an unmanaged live position), so we
  // don't defer it. Cost is 1 authed GET per configured symbol until one hits; at
  // scale (hundreds of flat agents) this is the lever to time-shard, not now.
  const keyRaw = await env.NEXUS_AGENT.get(`agent:key:${address}`);
  if (!keyRaw) return false;
  const symbols = config.symbols || [];
  let live = null;
  try {
    const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));
    // Probe each configured symbol with the SAME singular endpoint the reconcile
    // self-heal uses (proven to work with the order-only key) — the plural
    // /v1/positions returned nothing here. Stop at the first live one (the agent
    // manages one position at a time).
    for (const sym of symbols) {
      const res = await orderlyRequest(keyData, "GET", `/v1/position/${sym}`);
      if (exchangePositionQty(res) === null) throw new Error(`position read refused for ${sym}`);
      const p = res?.data;
      if (p && Math.abs(parseFloat(p.position_qty) || 0) > 1e-9) { live = { symbol: sym, ...p }; break; }
    }
  } catch (e) {
    console.error(`[exec] ${address.slice(0, 10)} orphan check failed:`, e.message);
    return false;
  }
  if (!live) return false;

  const signedQty = parseFloat(live.position_qty);
  const qty = Math.abs(signedQty);
  const direction = signedQty > 0 ? "LONG" : "SHORT";
  const entry = parseFloat(live.average_open_price) || parseFloat(live.mark_price) || 0;
  if (!(entry > 0)) return false;

  // Step/min constraints for future reduce-only slices (mirrors enterPosition).
  let baseTick = 0.001, baseMin = baseTick, minNotional = 0, quoteTick = null;
  try {
    const infoData = await orderlyPublicGet(`${ORDERLY_API}/v1/public/info/${live.symbol}`);
    const info = infoData.data || {};
    baseTick = info.base_tick || baseTick; baseMin = info.base_min || baseTick; minNotional = info.min_notional || 0;
    quoteTick = Number(info.quote_tick) > 0 ? Number(info.quote_tick) : null;
  } catch { /* fall back to defaults */ }

  // opened_at = now: we don't have the true open time, so the max-hold clock restarts
  // from adoption (conservative — never force-closes on adoption). TP/SL are computed
  // off the REAL average entry, so profit/loss exits are accurate immediately.
  state.current_position = {
    symbol: live.symbol, direction, entry_price: entry,
    current_price: parseFloat(live.mark_price) || entry, pnl_percent: 0,
    qty, opened_at: now, order_id: null, paper: false,
    tpPercent: config.tpPercent, slPercent: config.slPercent,
    strategy: `${(config.maxHoldHours ?? 0) <= 8 ? "DAY" : (config.maxHoldHours ?? 0) <= 120 ? "SWING" : "POSITION"} · ${config.signalMode || "CONFLUENCE"} · adopted`,
    takeProfits: normTakeProfits({ takeProfits: config.takeProfits, tpPercent: config.tpPercent }, config),
    remaining_qty: qty, tp_hits: [], peak_pnl_pct: 0,
    base_tick: baseTick, base_min: baseMin, min_notional: minNotional, quote_tick: quoteTick,
    adopted: true,
  };
  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  console.log(`[exec] ${address.slice(0, 10)} ADOPTED untracked ${direction} ${live.symbol} qty=${qty} entry=${entry}`);
  const tk = live.symbol.replace("PERP_", "").replace("_USDC", "");
  await notifyTelegram(address, env,
    `♻️ <b>Adopted untracked ${direction} ${tk}</b>\nA live position with no agent record was found on the exchange — resuming management (TP ${config.tpPercent}% / SL ${config.slPercent}%).`);
  return true;
}

async function keyExpiryAlert(address, state, env) {
  const rec = JSON.parse((await env.NEXUS_AGENT.get(`agent:key:${address}`)) || "null");
  if (!isKeyPointer(rec)) return;
  const key = JSON.parse((await env.NEXUS_AGENT.get(`v2key:${address}`)) || "null");
  const a = keyAlertDue({ expiresAt: key?.expiresAt, now: Date.now(), lastAlertDay: state.key_alert_day });
  if (!a.due) return;
  state.key_alert_day = a.day;
  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  await notifyTelegram(address, env, keyAlertText(a));
}

async function processUser(address, env, cache, liveHalt = { on: false }) {
  const [stateRaw, killRaw] = await Promise.all([
    env.NEXUS_AGENT.get(`agent:state:${address}`),
    env.NEXUS_AGENT.get(`agent:kill:${address}`),
  ]);
  if (!stateRaw) return;
  const state = JSON.parse(stateRaw);

  // Kill switch — honored via a DEDICATED agent:kill key (set by lab-api) so an
  // emergency stop can never be lost to a state-write race. Legacy in-flight
  // state.kill_requested is still respected for backward compatibility.
  // Close first (with the key), then stop + delete the key: killSwitch.mjs.
  if (killRaw || state.kill_requested) {
    let killConfig = {};
    try { killConfig = JSON.parse((await env.NEXUS_AGENT.get(`agent:config:${address}`)) || "{}") || {}; } catch { killConfig = {}; }
    const r = await runKill({
      state,
      io: {
        close: () => closePosition(address, state, killConfig, env, "KILLED", cache),
        saveState: (s) => env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(s)),
        clearFlag: () => env.NEXUS_AGENT.delete(`agent:kill:${address}`),
        clearDirective: () => env.NEXUS_AGENT.delete(`agent:directive:${address}`),
        deleteKey: () => env.NEXUS_AGENT.delete(`agent:key:${address}`),
        notify: (text) => notifyTelegram(address, env, text),
      },
    });
    console.log(`[exec] ${address.slice(0, 10)} KILL ${r.outcome} (attempt ${r.attempts})`);
    return;
  }

  if (!state.active) return;

  // Read config
  const configRaw = await env.NEXUS_AGENT.get(`agent:config:${address}`);
  if (!configRaw) return;
  const config = JSON.parse(configRaw);

  // Auth v2: a live agent on the wallet's 30-day key gets one "rotate your key" alert a day from 3
  // days out (agentKey.mjs). Reads the key's public fields only; never blocks the tick.
  if (config.mode !== "PAPER") {
    try { await keyExpiryAlert(address, state, env); } catch (e) { console.error(`[exec] ${address.slice(0, 10)} key alert:`, e.message); }
  }

  // Daily reset check. Persist immediately when it fires — otherwise the reset
  // only mutates the in-memory state and is lost unless the agent happens to
  // trade this tick, leaving the API/UI showing a stale trades_today/daily_pnl.
  const now = Date.now();
  if (shouldResetDaily(state.last_reset, now)) {
    state.daily_pnl = 0;
    state.trades_today = 0;
    state.last_reset = now;
    await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  }


  // ── WEBHOOK INTENT (TradingView / external) ───────────
  // The user's OWN signal, consumed once (delete on read) and given priority over
  // the brain. A CLOSE acts even while holding; an OPEN is dispatched below through
  // the normal mode logic (so it inherits PAPER/ASSISTED/AUTONOMOUS + guardrails).
  let whSignal = null;
  const whRaw = await env.NEXUS_AGENT.get(`agent:webhook_signal:${address}`);
  if (whRaw) {
    await env.NEXUS_AGENT.delete(`agent:webhook_signal:${address}`);
    try {
      const wh = JSON.parse(whRaw);
      if (now - (wh.timestamp || 0) <= 10 * 60 * 1000) { // ignore stale alerts
        if (wh.action === "CLOSE") {
          if (state.current_position) {
            await closePosition(address, state, config, env, "WEBHOOK_CLOSE", cache);
            console.log(`[exec] ${address.slice(0, 10)} WEBHOOK CLOSE`);
          }
          return;
        }
        if (wh.direction === "LONG" || wh.direction === "SHORT") {
          whSignal = { symbol: wh.symbol, direction: wh.direction, confidence: 100, price: 0, funding: 0, timestamp: wh.timestamp, source: "WEBHOOK" };
        }
      }
    } catch { /* ignore malformed intent */ }
  }

  // ── DIRECTIVE INTENT (the user's exact directional trade — one-shot) ────────
  // A directive is honored VERBATIM (direction is the user's, not the brain's).
  // ARMED + flat + fill-gate passes → becomes THIS entry's signal, carrying its own
  // sizing/levels via signal.directive (enterPosition reads them). Priority over the
  // brain, bypasses cooldown, retired on close. Only read when flat + no webhook, so
  // it adds no subrequest for holding users. See docs/directional-agent-spec.md.
  let directiveSignal = null;
  if (!whSignal && !state.current_position) {
    const dirRaw = await env.NEXUS_AGENT.get(`agent:directive:${address}`);
    if (dirRaw) {
      let dir = null;
      try { dir = JSON.parse(dirRaw); } catch { /* ignore malformed */ }
      if (dir && dir.status === "ARMED") {
        if (directiveExpired(dir, now)) {
          dir.status = "DONE"; dir.result = "expired";
          await env.NEXUS_AGENT.put(`agent:directive:${address}`, JSON.stringify(dir), { expirationTtl: 3600 });
          console.log(`[exec] ${address.slice(0, 10)} directive expired unfilled`);
        } else {
          // MARKET fills immediately; LIMIT (Phase 2) only inside the entry band.
          let fillOk = true;
          if ((dir.entryType || "MARKET") !== "MARKET") {
            try { fillOk = directiveShouldFill(dir, await getMarkPrice(dir.symbol, env, cache)); }
            catch { fillOk = false; }
          }
          if (fillOk) {
            directiveSignal = {
              symbol: dir.symbol, direction: dir.direction, confidence: 100,
              price: Number(dir.entryPrice) || 0, funding: 0, source: "DIRECTIVE",
              timestamp: now, directive: dir,
            };
          }
        }
      }
    }
  }

  // ── HOLDING POSITION ──────────────────────────────────
  // (after the webhook CLOSE check above so an external CLOSE can flatten.) An OPEN
  // that arrives while already in a position is dropped — we don't stack entries.
  if (state.current_position) {
    await monitorPosition(address, state, config, env, cache);
    return;
  }

  // Flat: recover any untracked live position (ghost) before doing anything else —
  // if the exchange holds a position the agent lost track of, re-adopt + manage it
  // next tick rather than opening a new one on top. AUTONOMOUS-only.
  if (config.mode === "AUTONOMOUS" && await adoptOrphanPosition(address, state, config, env, cache)) return;

  // Daily limits gate NEW entries only (tested in logic.mjs). They sit below the position monitor and
  // ghost adoption on purpose: until 2026-11-06 this check ran first, so the day's last allowed trade
  // (trades_today is bumped at entry) was never monitored again until the 24h reset: no SL, TP or
  // timeout on a live position.
  const cap = dailyCapBlocked(state, config);
  if (cap.blocked) {
    console.log(`[exec] ${address.slice(0, 10)} ${cap.reason}`);
    return;
  }

  // Flat: make sure no published feed card is still stuck ACTIVE (zombie cleanup).
  if (PUBLISH_AGENT_FEED) await reconcileStaleFeed(address, env);

  // ── AUTOCOPY — mirror a followed leader's OPEN position ───
  // Trustless copy-trading: the follower opted into config.autocopy.leaders (via the
  // owner-authed config path). We adopt a followed leader's real open position as a
  // signal (symbol + direction only) — it then flows through the SAME enterPosition
  // path, inheriting THIS agent's mode (PAPER/AUTONOMOUS), sizing, TP/SL and every
  // guardrail. Only when flat + no webhook/directive; capped subrequests; deduped by
  // state.last_copy_key so we mirror each NEW leader position exactly once.
  let copySignal = null;
  if (!whSignal && !directiveSignal && !state.current_position && config.autocopy?.enabled) {
    const leaderWallets = (config.autocopy.leaders || [])
      .map((w) => String(w).toLowerCase())
      .filter((w) => w !== address)               // can't copy yourself
      .slice(0, AUTOCOPY_MAX_LEADERS);
    const leaders = await Promise.all(leaderWallets.map(async (lw) => {
      let position = null, latestCall = null;
      try {
        const s = await env.NEXUS_AGENT.get(`agent:state:${lw}`);
        position = s ? (JSON.parse(s).current_position || null) : null;
      } catch { /* leader unreadable → treated as flat */ }
      try {
        const c = await env.NEXUS_AGENT.get(`caller:latest:${lw}`);
        latestCall = c ? JSON.parse(c) : null;    // human caller's freshest public call
      } catch { /* no recent call */ }
      return { wallet: lw, position, latestCall };
    }));
    const pick = selectCopySignal(config, leaders, state.last_copy_key, now);
    if (pick) {
      copySignal = { symbol: pick.symbol, direction: pick.direction, confidence: 100, price: 0, funding: 0, timestamp: now, source: "COPY", leader: pick.leader };
      state.last_copy_key = pick.key;             // persisted by enterPosition → mirror once
      console.log(`[exec] ${address.slice(0, 10)} AUTOCOPY ${pick.kind} ${pick.direction} ${pick.symbol} from ${pick.leader.slice(0, 10)}`);
    }
  }

  // ── NO POSITION — CHECK FOR SIGNAL ────────────────────
  // Prefer the user's own intent (webhook, directive, autocopy); otherwise the brain's.
  let signal = whSignal || directiveSignal || copySignal;
  if (!signal) {
    const signalRaw = await env.NEXUS_AGENT.get(`agent:signal:${address}`);
    if (!signalRaw) return;
    signal = JSON.parse(signalRaw);
    if (now - signal.timestamp > 10 * 60 * 1000) return; // hard cap: never act on a >10min-old signal
    // Opt-in tighter freshness for FAST-reverting edges. Backtest finding (hunt6): the
    // regime-gated invert reverts within a bar, so a signal even a few minutes stale is
    // a LATE entry that loses — better to skip and wait for a fresh one. Off by default
    // (existing agents keep the 10min cap); the fast presets set ~180s. House signal only.
    if ((config.maxSignalAgeSec ?? 0) > 0 && now - signal.timestamp > config.maxSignalAgeSec * 1000) return;
    if (signal.direction === "NONE") return;
    if (signal.confidence < 50) return;
  }

  // Cooldown check — user-authored intents (webhook / directive / autocopy) are
  // explicit, so they bypass it; only the brain's own signals are cooldown-gated.
  const userAuthored = signal.source === "WEBHOOK" || signal.source === "DIRECTIVE" || signal.source === "COPY";
  if (!userAuthored && state.last_trade_time && now - state.last_trade_time < COOLDOWN_MS) return;
  // One entry per signal: the brain repeats a read until its next row lands (logic.mjs).
  if (!userAuthored && alreadyTradedSignal(state, signal)) return;

  // Mode check
  if (config.mode === "ASSISTED") {
    // In assisted mode — generate a thesis for review, don't execute.
    const pendingRaw = await env.NEXUS_AGENT.get(`agent:pending:${address}`);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : [];

    // Dedupe: the exec runs every minute and ASSISTED never sets last_trade_time,
    // so without this the same signal floods the queue. Only add a new thesis if
    // the most recent one differs in symbol/direction OR is older than the cooldown.
    const latest = pending[0];
    const isDuplicate = latest
      && latest.symbol === signal.symbol
      && latest.direction === signal.direction
      && (now - latest.generatedAt) < COOLDOWN_MS;
    if (isDuplicate) {
      console.log(`[exec] ${address.slice(0, 10)} ASSISTED signal unchanged, skipping duplicate thesis`);
      return;
    }

    const thesis = {
      id: `agent_${now}`,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.price,
      confidence: signal.confidence,
      funding: signal.funding,
      source: "AGENT",
      generatedAt: now,
      status: "PENDING_REVIEW",
    };
    pending.unshift(thesis);
    if (pending.length > 20) pending.pop(); // keep last 20
    await env.NEXUS_AGENT.put(`agent:pending:${address}`, JSON.stringify(pending));
    console.log(`[exec] ${address.slice(0, 10)} ASSISTED thesis generated: ${signal.direction} ${signal.symbol}`);
    return;
  }

  // ── LIVE-ENTRY PAUSE (owner switch, /ops/halt) ─────────
  // Live agents open nothing while it's on; the signal is skipped, not queued. A directive stays
  // ARMED until it expires; a webhook OPEN was consumed above and is dropped. PAPER never stops.
  if (haltBlocksEntry(liveHalt, config.mode)) {
    console.log(`[exec] ${address.slice(0, 10)} live entries paused (${liveHalt.reason || "owner switch"}) · skipped ${signal.direction} ${signal.symbol}`);
    return;
  }

  // ── AUTONOMOUS MODE — EXECUTE ─────────────────────────
  await enterPosition(address, state, config, signal, env, cache);
}

// ── Backstop stop (backstop.mjs): a reduce-only stop resting on Orderly, wider than exec's own, so a
// stalled worker never leaves a live position with no stop. Placed at entry (retried each tick while
// missing), cancelled on every exit exec makes. Mutates `pos` / `state`; returns true when it changed
// `pos` (the caller must persist it, or the next tick places a second order).
async function ensureBackstop(address, pos, keyData, env) {
  if (!keyData || !backstopWanted(pos) || pos.backstop?.id) return false;
  const tries = Number(pos.backstop_tries) || 0;
  if (tries >= BACKSTOP_MAX_TRIES) return false;
  pos.backstop_tries = tries + 1;
  const trigger = backstopTrigger({ direction: pos.direction, entryPrice: pos.entry_price, slPercent: pos.slPercent, quoteTick: pos.quote_tick });
  if (!trigger) return true;
  let res = null;
  try { res = await orderlyRequest(keyData, "POST", "/v1/algo/order", backstopOrder({ symbol: pos.symbol, direction: pos.direction, triggerPrice: trigger })); }
  catch (e) { res = { success: false, message: e.message }; }
  const id = algoOrderIdFrom(res);
  if (id) {
    pos.backstop = { id, trigger, mult: BACKSTOP_MULT, placedAt: Date.now() };
    console.log(`[exec] ${address.slice(0, 10)} backstop stop placed ${pos.symbol} @ ${trigger} (id ${id})`);
    return true;
  }
  console.error(`[exec] ${address.slice(0, 10)} backstop stop refused (try ${pos.backstop_tries}/${BACKSTOP_MAX_TRIES}):`, JSON.stringify(res).slice(0, 200));
  if (pos.backstop_tries >= BACKSTOP_MAX_TRIES) {
    const tk = pos.symbol.replace("PERP_", "").replace("_USDC", "");
    await notifyTelegram(address, env, `⚠️ <b>No exchange backstop on ${pos.direction} ${tk}</b>\nOrderly refused the resting stop ${BACKSTOP_MAX_TRIES} times. The agent still checks its own stop every minute; set a stop by hand if you want one on the exchange.`);
  }
  return true;
}

// Cancel this position's backstop after exec closed it. A cancel that doesn't go through is kept in
// state.backstop_cleanup and retried before the next live entry (sweepBackstops).
async function cancelBackstop(address, state, pos, keyData) {
  const bs = pos?.backstop;
  if (!bs?.id) return;
  let ok = false;
  if (keyData) {
    try { ok = (await orderlyRequest(keyData, "DELETE", cancelPath({ id: bs.id, symbol: pos.symbol })))?.success === true; }
    catch (e) { console.error(`[exec] ${address.slice(0, 10)} backstop cancel failed:`, e.message); }
  }
  if (!ok) {
    state.backstop_cleanup = [...(state.backstop_cleanup || []), { id: bs.id, symbol: pos.symbol, tries: 0 }];
    console.warn(`[exec] ${address.slice(0, 10)} backstop ${bs.id} not cancelled yet — queued for cleanup`);
  }
}

// Retry the queued cancels. Returns the symbols that still carry a stale backstop (no entry there).
async function sweepBackstops(address, state, keyData, env) {
  if (!keyData || !(state.backstop_cleanup || []).length) return new Set();
  const r = await sweepStaleBackstops(state.backstop_cleanup, {
    cancel: (it) => orderlyRequest(keyData, "DELETE", cancelPath(it)),
    status: (it) => orderlyRequest(keyData, "GET", `/v1/algo/order/${it.id}`),
  });
  state.backstop_cleanup = r.left;
  for (const it of r.dropped) {
    const tk = it.symbol.replace("PERP_", "").replace("_USDC", "");
    await notifyTelegram(address, env, `⚠️ <b>Old backstop stop on ${tk} may still be resting</b>\nCouldn't cancel order ${it.id} after ${it.tries} tries. Check open orders on ${tk} and cancel it by hand.`);
  }
  if (r.done.length || r.dropped.length) await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  return new Set(r.left.map((it) => it.symbol));
}

async function enterPosition(address, state, config, signal, env, cache) {
  // PAPER mode simulates the full trade lifecycle without ever touching a real
  // trading key or placing a live order. Everything else (sizing, mark price,
  // TP/SL/timeout management, daily limits) runs identically so results are
  // realistic — they're just recorded to a separate paper ledger in state.
  const paper = config.mode === "PAPER";
  // A directive is the user's exact directional trade — it overrides sizing/levels
  // for THIS entry (the user supplies the edge). null for normal signal entries.
  const directive = signal.directive || null;
  // The graded exit (the scoreboard's R contract) is PAPER ONLY and the WHOLE contract. Refused here,
  // before any price read, key read, order or state write (app/lib/gradedExit.mjs; borst 2026-10-15:
  // the uncapped stop never reaches live money without its own review).
  const gradedRefusal = gradedExitRefusal(config, paper);
  if (gradedRefusal) {
    console.error(`[exec] ${address.slice(0, 10)} graded exit refused: ${gradedRefusal}`);
    return;
  }
  // Fixed-risk sizing (app/lib/riskSizing.mjs): PAPER only, graded exit only, never with DCA or vol-targeted
  // capital. Refused here, before anything is read or placed. A directive keeps its own size.
  const riskSized = !directive && usesRiskSizing(config);
  const riskRefusal = riskSized ? riskSizingRefusal(config, paper) : null;
  if (riskRefusal) {
    console.error(`[exec] ${address.slice(0, 10)} fixed-risk sizing refused: ${riskRefusal}`);
    return;
  }
  const effLeverage = (directive && directive.leverage > 0) ? directive.leverage : config.leverage;
  let effCapital = (directive && directive.capitalPerTrade > 0) ? directive.capitalPerTrade : config.capitalPerTrade;

  const symbol = signal.symbol;
  const side = signal.direction === "SHORT" ? "SELL" : "BUY";

  // Fetch current mark price (shared per-symbol cache) + tick size
  const markPrice = await getMarkPrice(symbol, env, cache);

  // B — volatility-targeted sizing (opt-in). Scale capital inversely to recent
  // realized vol so risk-per-trade is steady across symbols/regimes. Gated on
  // config.volTargetPct>0 and NOT for directives (user set their own size). Fully
  // fail-safe: any fetch/vol error leaves effCapital unchanged (existing agents
  // with volTargetPct unset are byte-for-byte identical).
  if (config.volTargetPct > 0 && !directive) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const hist = await orderlyPublicGet(`${ORDERLY_API}/tv/history?symbol=${symbol}&resolution=15&from=${nowSec - 24 * 3600}&to=${nowSec}`);
      const closes = (hist && hist.s === "ok" && Array.isArray(hist.c)) ? hist.c.map(Number) : null;
      const rv = realizedVolPct(closes);
      if (rv) {
        const scaled = volScaledCapital(effCapital, rv, config.volTargetPct);
        if (scaled > 0) {
          console.log(`[exec] ${address.slice(0, 10)} vol-sizing: rv=${rv.toFixed(2)}% target=${config.volTargetPct}% cap ${effCapital}→${scaled}`);
          effCapital = scaled;
        }
      }
    } catch (e) { /* fail-safe: keep effCapital as-is */ }
  }

  // Fetch symbol info for step size + min order constraints
  const infoData = await orderlyPublicGet(`${ORDERLY_API}/v1/public/info/${symbol}`);
  const info = infoData.data || {};
  const baseTick = info.base_tick || 0.001;
  const baseMin = info.base_min || baseTick;
  const minNotional = info.min_notional || 0;
  const quoteTick = Number(info.quote_tick) > 0 ? Number(info.quote_tick) : null;

  // DCA mode reserves the rest of capitalPerTrade for safety orders, so the BASE
  // order is only a fraction of it (the ladder sums back to capitalPerTrade). DCA is
  // disabled for directives — a directive is one managed trade, not an averaging ladder.
  const dca = (config.dcaEnabled && !directive) ? config.dca : null;
  const baseMargin = dca ? dcaUnitMargin(effCapital, dca) : effCapital;

  // Resolve a directive's %-levels off the CURRENT mark BEFORE placing any order. If
  // they're inverted at fill time (e.g. price already blew past the stop), refuse the
  // entry and retire the directive — never enter a self-contradicting trade.
  let directiveLv = null;
  if (directive) {
    directiveLv = directiveLevels(directive, markPrice);
    if (directiveLv.error) {
      directive.status = "DONE"; directive.result = `rejected: ${directiveLv.error}`;
      await env.NEXUS_AGENT.put(`agent:directive:${address}`, JSON.stringify(directive), { expirationTtl: 3600 });
      console.error(`[exec] ${address.slice(0, 10)} directive rejected at fill: ${directiveLv.error}`);
      return;
    }
  }

  // Graded-exit levels are read BEFORE anything is placed (and before sizing: fixed-risk needs the stop): no H4 ATR → sit this one out, never a
  // fallback to the flat config % (that would trade an exit the scoreboard didn't grade).
  let gradedLv = null;
  if (!directive && usesGradedExit(config)) {
    gradedLv = await fetchGradedExitLevels(symbol);
    if (!gradedLv) {
      console.error(`[exec] ${address.slice(0, 10)} graded exit: no H4 ATR for ${symbol}, sitting out`);
      return;
    }
  }

  // Fixed-risk sizing: the margin that makes this trade's own graded stop lose riskPerTradeUsd, capped at
  // capitalPerTrade (the margin ceiling).
  let sizeMargin = baseMargin;
  if (riskSized) {
    const rs = riskSizedMargin({ riskPerTradeUsd: config.riskPerTradeUsd, slPercent: gradedLv?.slPercent, leverage: effLeverage, maxMargin: config.capitalPerTrade });
    if (!rs) { console.error(`[exec] ${address.slice(0, 10)} fixed-risk sizing: no stop for ${symbol}, sitting out`); return; }
    sizeMargin = rs.margin;
    console.log(`[exec] ${address.slice(0, 10)} fixed-risk: $${config.riskPerTradeUsd} at sl=${gradedLv.slPercent}% → margin $${rs.margin}${rs.capped ? " (capped at capitalPerTrade)" : ""}`);
  }

  // Calculate qty, snapped to base_tick (tested in logic.mjs — guards the
  // -1104 step-size float artifact + base_min / min_notional constraints).
  const snap = snapQty({
    capitalPerTrade: sizeMargin, leverage: effLeverage,
    markPrice, baseTick, baseMin, minNotional,
  });
  if (!snap.ok) {
    console.error(`[exec] ${address.slice(0, 10)} ${snap.reason} for ${symbol}`);
    return;
  }
  const qty = snap.qty;
  const entryNotional = qty * markPrice;

  // Load the (decrypted) trading key up front for LIVE — needed for both the
  // portfolio delta-cap read and the order itself. PAPER never touches a key.
  let keyData = null;
  if (!paper) {
    const keyRaw = await env.NEXUS_AGENT.get(`agent:key:${address}`);
    if (!keyRaw) { console.error(`[exec] no key for ${address.slice(0, 10)}`); return; }
    keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));    // Auth v2: a 30-day key must outlive the position's max hold, or the agent could be left unable
    // to close it (agentKey.mjs). v1 keys pass.
    const keyWhy = keyHoldRefusal({ keyData, now: Date.now(), maxHoldHours: config.maxHoldHours });
    if (keyWhy) { console.error(`[exec] ${address.slice(0, 10)} entry skipped: ${keyWhy}`); return; }
    // A backstop left over from an earlier close must be gone before a new position on that market
    // (a positional stop would attach to it).
    const stale = await sweepBackstops(address, state, keyData, env);
    if (stale.has(symbol)) { console.error(`[exec] ${address.slice(0, 10)} entry skipped: an old backstop on ${symbol} isn't cancelled yet`); return; }
  }

  // ── Portfolio delta cap (PRO) ── Reject an entry that would push the account's
  // NET directional exposure past config.maxPortfolioDeltaUsd. LIVE sums the REAL
  // account's open positions (manual / Bankr / concurrent trades included); PAPER
  // has no exchange account, so it checks this agent's own book only. Fail-OPEN
  // only when the live read truly fails (null) — never silently over-leverage a
  // real account on a transient read error.
  if (Number(config.maxPortfolioDeltaUsd) > 0) {
    const positions = paper
      ? (state.current_position
          ? [{ signedQty: (state.current_position.direction === "SHORT" ? -1 : 1) * (state.current_position.total_qty ?? state.current_position.qty ?? 0), mark: state.current_position.current_price }]
          : [])
      : await fetchAccountPositions(keyData);
    if (positions) {
      const dc = portfolioDeltaCheck(positions, entryNotional, signal.direction, config.maxPortfolioDeltaUsd);
      if (dc.blocked) {
        console.log(`[exec] ${address.slice(0, 10)} delta cap: projected $${dc.projectedDelta.toFixed(0)} > cap $${dc.cap} (existing $${dc.existingDelta.toFixed(0)}) — ${signal.direction} ${symbol} entry blocked`);
        return;
      }
    }
  }

  let orderId = null;
  let entryFill = { price: markPrice, source: paper ? "paper" : "mark" };
  if (!paper) {
    // Set leverage
    await orderlyRequest(keyData, "POST", "/v1/client/leverage", {
      symbol, leverage: effLeverage,
    });

    // Place market order
    const order = await orderlyRequest(keyData, "POST", "/v1/order", {
      symbol,
      order_type: "MARKET",
      side,
      order_quantity: qty,
      broker_id: "nexus_trading",
    });

    if (order.success === false) {
      console.error(`[exec] ${address.slice(0, 10)} order failed:`, JSON.stringify(order));
      return;
    }
    orderId = order.data?.order_id;
    entryFill = await readFill(keyData, orderId, markPrice);
  }

  // Effective TP/SL — fixed config %, or volatility-scaled to recent ATR (opt-in
  // config.volScaledStops). Resolved per-entry + stored on the position so the
  // monitor exits on THESE levels, not the flat config %. Computed for paper too,
  // so PAPER validates the exact behavior before anyone goes live with it.
  let effTp = config.tpPercent, effSl = config.slPercent;
  let takeProfits;
  if (directive) {
    // Directive: honor the user's explicit levels (converted off the fill above).
    // Skip volatility-scaling — the user gave concrete prices, not a % to scale.
    effTp = directiveLv.tpPercent; effSl = directiveLv.slPercent;
    takeProfits = normTakeProfits({ takeProfits: directiveLv.takeProfits, tpPercent: effTp }, config);
  } else if (gradedLv) {
    effTp = gradedLv.tpPercent; effSl = gradedLv.slPercent;
    console.log(`[exec] ${address.slice(0, 10)} graded exit → tp=${effTp} sl=${effSl} hold=${config.maxHoldHours}h`);
    takeProfits = normTakeProfits({ tpPercent: effTp }, {});
  } else {
    if (config.volScaledStops) {
      const atrPct = await fetchAtrPct(symbol, env);
      const lv = volScaledLevels(atrPct, config);
      effTp = lv.tpPercent; effSl = lv.slPercent;
      console.log(`[exec] ${address.slice(0, 10)} volScaledStops atr%=${atrPct == null ? "n/a" : atrPct.toFixed(2)} → tp=${effTp} sl=${effSl}`);
    }
    // Resolve the take-profit ladder for this entry. Explicit config.takeProfits
    // (multi-level scale-out) wins; otherwise a single 100%-size level from the
    // effective tpPercent — so legacy/simple configs behave exactly as before.
    takeProfits = normTakeProfits({ takeProfits: config.takeProfits, tpPercent: effTp }, config);
  }

  // Update state
  state.current_position = {
    symbol,
    direction: signal.direction,
    entry_price: entryFill.price,
    entry_fill: entryFill.source,
    current_price: markPrice,
    pnl_percent: 0,
    qty,
    opened_at: Date.now(),
    order_id: orderId,
    paper,
    leverage: effLeverage,
    tpPercent: effTp,
    slPercent: effSl,
    // Fixed-risk sizing: the dollars this position actually risks to its stop (after snapping and any cap),
    // so P&L ÷ risk_usd = the trade's R.
    ...(riskSized ? { sizing: "RISK", risk_target_usd: Number(config.riskPerTradeUsd), risk_usd: riskTaken(qty, entryFill.price, effSl) } : {}),
    // Strategy label stamped at ENTRY (config can change before close) so the trade
    // record + History tab can show which strategy produced each trade.
    strategy: directive
      ? `DIRECTIVE · ${signal.direction}`
      : `${(config.maxHoldHours ?? 0) <= 8 ? "DAY" : (config.maxHoldHours ?? 0) <= 120 ? "SWING" : "POSITION"} · ${config.signalMode || "CONFLUENCE"}${config.dcaEnabled ? " · DCA" : ""}`,
    // Copy-loop provenance: which leader this trade mirrors, if any. An autocopy
    // COPY signal carries signal.leader; a smart-money ⚡ copy arrives as a directive
    // whose `source` is the leader's 0x address (THESIS / non-address sources → none).
    // Stamped so the closed trade can prove "copies of leader X actually returned Y".
    ...(() => {
      const lead = signal.leader
        || (directive && /^0x[a-fA-F0-9]{40}$/.test(String(directive.source || "")) ? String(directive.source) : null);
      return lead ? { source_leader: lead.toLowerCase() } : {};
    })(),
    // Back-link to the source directive so the one-shot close can retire it.
    ...(directive ? { directive_id: directive.id } : {}),
    // Multi-TP + trailing exit state (evaluateExit). remaining_qty shrinks as
    // levels scale out; tp_hits records filled levels; peak_pnl_pct ratchets the
    // trailing stop. Legacy positions without these fall back to single-TP/SL.
    takeProfits,
    remaining_qty: qty,
    tp_hits: [],
    peak_pnl_pct: 0,
    // Exchange step/min constraints, stored so partial scale-outs can snap the
    // reduce-only slice to base_tick (avoids -1104) without re-fetching info.
    base_tick: baseTick,
    base_min: baseMin,
    min_notional: minNotional,
    quote_tick: quoteTick,
    // DCA state (averaging mode). The monitor manages these on a separate path:
    // base_entry_price anchors the safety-order triggers; avg_entry/total_qty are
    // the running blended position; TP is taken off avg_entry, not the base.
    ...(dca ? {
      dca: { ...dca, takeProfitPct: config.tpPercent },
      base_entry_price: entryFill.price,
      avg_entry: entryFill.price,
      total_qty: qty,
      filled_safety_orders: 0,
    } : {}),
  };
  state.last_trade_time = Date.now();
  state.trades_today = (state.trades_today || 0) + 1;
  { const key = brainSignalKey(signal); if (key) state.last_signal_key = key; } // this read is now traded

  // The exchange-side backstop: placed right after the fill, before state is saved. A refusal never
  // undoes the entry (the position is open); monitorPosition retries it each tick.
  if (!paper) await ensureBackstop(address, state.current_position, keyData, env);

  // Mark the directive LIVE (a position is now open for it) so the UI/API reflect it
  // and a second directive can't arm on top. Retired to DONE by closePosition.
  if (directive) {
    directive.status = "LIVE";
    directive.filledPrice = markPrice;
    directive.filledAt = Date.now();
    await env.NEXUS_AGENT.put(`agent:directive:${address}`, JSON.stringify(directive));
  }

  // Publish to the public feed (real trades only by default). Store the feed id
  // on the position so the close path can resolve it. Best-effort — a feed write
  // failure must never block the actual trade lifecycle.
  if (PUBLISH_AGENT_FEED && (!paper || PUBLISH_PAPER_TO_FEED)) {
    try {
      // Feed card should reflect the levels/leverage actually used (directive overrides).
      const feedConfig = directive ? { ...config, leverage: effLeverage, tpPercent: effTp, slPercent: effSl } : config;
      state.current_position.feed_id = await publishAgentEntry(address, env, { config: feedConfig, signal, markPrice, qty });
    } catch (e) {
      console.error(`[exec] ${address.slice(0, 10)} agent feed publish failed:`, e.message);
    }
  }

  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));

  console.log(`[exec] ${address.slice(0, 10)} ${paper ? "PAPER " : ""}ENTER ${signal.direction} ${symbol} @ ${markPrice} qty=${qty}`);

  const tkEnter = symbol.replace("PERP_", "").replace("_USDC", "");
  await notifyTelegram(address, env,
    `${paper ? "📝 <b>[PAPER]</b> " : "🟢 "}<b>OPEN ${signal.direction} ${tkEnter}</b> @ $${markPrice}\n` +
    `TP ${effTp}% · SL ${effSl}% · ${effLeverage}x${directive ? " · directive" : ` · ${config.signalMode || "CONFLUENCE"}`}`);

  await fireCallback(address, config, env, "ENTRY", {
    symbol, direction: signal.direction, qty, price: markPrice, leverage: effLeverage, paper,
  });
}

// The graded exit's stop/target from the coin's H4 ATR-14 — built from the last 80h of 1h candles by
// the SAME function the scoreboard's R grade uses (app/lib/atr.mjs via gradedExit.mjs). null on any
// failure; the caller sits out.
async function fetchGradedExitLevels(symbol) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - (GRADED_EXIT_LOOKBACK_H + 2) * 3600;
    const d = await orderlyPublicGet(`${ORDERLY_API}/tv/history?symbol=${symbol}&resolution=60&from=${from}&to=${now}`);
    if (!d || d.s !== "ok" || !Array.isArray(d.t)) return null;
    const hourly = d.t.map((t, i) => ({ t: Number(t), h: Number(d.h[i]), l: Number(d.l[i]), c: Number(d.c[i]) }));
    return gradedExitLevelsFromHourly(hourly);
  } catch { return null; }
}

// ATR as a % of price from recent 1h candles (public /tv/history). Used to scale
// the agent's stop to each symbol's real volatility (opt-in volScaledStops).
async function fetchAtrPct(symbol, env, periods = 14) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - (periods + 5) * 3600;
    const d = await orderlyPublicGet(`${ORDERLY_API}/tv/history?symbol=${symbol}&resolution=60&from=${from}&to=${now}`);
    if (!d || d.s !== "ok" || !Array.isArray(d.t) || d.t.length < 3) return null;
    const { h: H, l: L, c: C, t } = d;
    const n = t.length;
    let trSum = 0, cnt = 0;
    for (let i = Math.max(1, n - periods); i < n; i++) {
      const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
      if (Number.isFinite(tr)) { trSum += tr; cnt++; }
    }
    const lastClose = C[n - 1];
    return cnt && lastClose > 0 ? (trSum / cnt / lastClose) * 100 : null;
  } catch { return null; }
}

async function monitorPosition(address, state, config, env, cache) {
  const pos = state.current_position;
  if (!pos) return;

  // ── Reconcile with the exchange ──────────────────────────
  // The user may have closed this position manually in the UI. The agent tracks
  // positions from KV, so without this it would monitor a ghost and eventually
  // log a bogus trade. Verify the position still exists on Orderly; if the
  // exchange shows flat, clear the stale record and resume scanning (honoring
  // the cooldown). If the check itself fails (API hiccup), fall through and
  // manage on cached data rather than risk discarding a real position.
  // Paper positions have no exchange counterpart — skip reconciliation entirely.
  const keyRaw = pos.paper ? null : await env.NEXUS_AGENT.get(`agent:key:${address}`);
  let liveKey = null; // the key, once the reconcile read worked (the backstop uses it below)
  if (keyRaw) {
    try {
      const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));
      const posRes = await orderlyRequest(keyData, "GET", `/v1/position/${pos.symbol}`);
      // An error answer reads as null (unreadable), never as flat: logic.mjs exchangePositionQty.
      const liveQty = exchangePositionQty(posRes);
      if (liveQty === null) throw new Error(`position read refused: ${String(posRes?.message || posRes?.code || "no answer").slice(0, 80)}`);
      // Grace window: a just-opened position may not have propagated to the position
      // endpoint yet — a 0-qty read here would wrongly discard a REAL fill (→ ghost).
      // Defer the reconcile-clear until the position has had time to settle; adoption
      // self-heals anyway if we ever miss one.
      if (Number.isFinite(liveQty) && liveQty < 1e-9 && Date.now() - pos.opened_at < 120000) {
        console.log(`[exec] ${address.slice(0, 10)} exchange flat but position <2m old — deferring reconcile (fill may be propagating)`);
        return;
      }
      if (Number.isFinite(liveQty) && liveQty < 1e-9) {
        console.log(`[exec] ${address.slice(0, 10)} position flat on exchange (manual close?) — clearing stale record`);
        // Did our backstop close it (exec stalled past the stop)? Read the order; never guessed.
        if (pos.backstop?.id) {
          let fired = false;
          try { fired = backstopHit(await orderlyRequest(keyData, "GET", `/v1/algo/order/${pos.backstop.id}`)); } catch { fired = false; }
          if (fired) {
            state.last_backstop_hit = { symbol: pos.symbol, direction: pos.direction, trigger: pos.backstop.trigger, at: Date.now() };
            const tkb = pos.symbol.replace("PERP_", "").replace("_USDC", "");
            await notifyTelegram(address, env, `🛡 <b>Backstop stop closed ${pos.direction} ${tkb}</b> near $${pos.backstop.trigger}\nThe agent missed its own stop (worker delay), so the exchange stop closed it. Check the fill in your Orderly history: this close isn't on the agent's ledger.`);
          } else {
            await cancelBackstop(address, state, pos, keyData); // closed some other way: cancel what's resting
          }
        }
        // Resolve the published feed card too — otherwise clearing state alone strands
        // it ACTIVE forever (the "zombie" agent position the user sees on the feed while
        // the agent is actually flat). Best-effort exit = current mark; the exchange
        // closed this outside our monitor so we don't have the true fill. NOT written to
        // agent_trades — the graded ledger only records closes we execute + can verify,
        // never a reconstructed fill, so the leaderboard stays trustless.
        if (pos.feed_id) {
          try {
            let estExit = pos.current_price;
            try { estExit = await getMarkPrice(pos.symbol, env, cache); } catch { /* keep cached */ }
            const { pnlUsdc } = computePnl(pos.direction, pos.avg_entry ?? pos.entry_price, estExit, pos.remaining_qty ?? pos.qty);
            await publishAgentClose(address, env, pos.feed_id, { reason: "CLOSED", pnlUsdc, exitPrice: estExit });
          } catch (e) {
            console.error(`[exec] ${address.slice(0, 10)} feed resolve on reconcile failed:`, e.message);
          }
        }
        state.current_position = null;
        state.last_trade_time = Date.now(); // respect cooldown before any re-entry
        await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
        return;
      }
      liveKey = keyData;
    } catch (e) {
      console.error(`[exec] ${address.slice(0, 10)} position reconcile failed, managing on cached data:`, e.message);
    }
  }

  // A live position with no backstop yet (refused at entry, or adopted): try again, and save at once
  // (some paths below return without a state write).
  if (liveKey && await ensureBackstop(address, pos, liveKey, env)) await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));

  // Fetch current price (shared per-symbol cache). If the public price fetch
  // fails (transient Orderly outage / HTML challenge to the worker IP), fall back
  // to the last known price so the SAFETY-NET exits still run — otherwise a price
  // hiccup strands the position open indefinitely past its max hold (the exit
  // checks live below getMarkPrice, so an unguarded throw here skips them).
  let currentPrice;
  try {
    currentPrice = await getMarkPrice(pos.symbol, env, cache);
  } catch (e) {
    currentPrice = pos.current_price;
    console.error(`[exec] ${address.slice(0, 10)} mark price fetch failed, using cached ${currentPrice}:`, e.message);
  }

  // No usable price at all (no cached value either): the only exit we can judge
  // without a price is the time-based TIMEOUT. Fire it so a position can't be held
  // forever during a price outage, then bail.
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    if (Date.now() - pos.opened_at >= config.maxHoldHours * 60 * 60 * 1000) {
      console.log(`[exec] ${address.slice(0, 10)} no price + past max hold — force TIMEOUT close`);
      await closePosition(address, state, config, env, "TIMEOUT", cache);
    }
    return;
  }

  // ── DCA / averaging path ──────────────────────────────
  // Managed separately from evaluateExit: P&L is off the BLENDED avg, TP is taken
  // off avg, adverse moves ADD safety orders (up to maxSafetyOrders), and only once
  // the ladder is exhausted does the slPercent stop cut the loss. The daily-loss cap
  // + kill switch stay absolute overrides (enforced in processUser).
  if (pos.dca) {
    const { pnlPct: dcaPnl } = computePnl(pos.direction, pos.avg_entry, currentPrice, pos.total_qty);
    pos.current_price = currentPrice;
    pos.pnl_percent = dcaPnl;
    const holdMs = Date.now() - pos.opened_at;
    const maxSO = Math.floor(Number(pos.dca.maxSafetyOrders) || 0);

    // Breakeven on the BLENDED avg entry: once the averaged-in position recovers
    // past the trigger, latch and protect it at (blended entry + buffer). This is
    // the honest way breakeven coexists with DCA — it only acts AFTER you're in
    // profit, never fighting the averaging-down thesis, and takes priority over a
    // new safety order or TP so a recovered position can't round-trip to a loss.
    pos.be_armed = breakevenArmed(pos, dcaPnl, config.breakevenTriggerPct);
    if (pos.be_armed && dcaPnl <= (Number(config.breakevenBufferPct) || 0)) {
      await closePosition(address, state, config, env, "BE", cache, currentPrice); return;
    }

    if (dcaPnl >= (pos.dca.takeProfitPct || config.tpPercent)) {
      await closePosition(address, state, config, env, "TP", cache, currentPrice); return;
    }
    if (holdMs >= config.maxHoldHours * 60 * 60 * 1000) {
      await closePosition(address, state, config, env, "TIMEOUT", cache, currentPrice); return;
    }
    const so = nextSafetyOrder(pos, currentPrice, config.capitalPerTrade, pos.dca);
    if (so.shouldAdd) { await addSafetyOrder(address, state, config, env, so, currentPrice); return; }
    pos.next_safety_price = so.trigger ?? pos.next_safety_price;
    // Final stop — only after the whole ladder is spent (averaging is done).
    if ((pos.filled_safety_orders || 0) >= maxSO && pos.slPercent && dcaPnl <= -pos.slPercent) {
      await closePosition(address, state, config, env, "SL", cache, currentPrice); return;
    }
    await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
    console.log(`[exec] ${address.slice(0, 10)} ${pos.paper ? "PAPER " : ""}DCA HOLD ${pos.direction} ${pos.symbol.replace("PERP_", "").replace("_USDC", "")} avgPnl=${dcaPnl.toFixed(3)}% SOs=${pos.filled_safety_orders || 0}/${maxSO}`);
    return;
  }

  // Calculate P&L % (tested in logic.mjs)
  const { pnlPct } = computePnl(pos.direction, pos.entry_price, currentPrice, pos.qty);

  // Update current price in state
  pos.current_price = currentPrice;
  pos.pnl_percent = pnlPct;

  // Breakeven / "risk-free trade" stop: latch pos.be_armed once price has moved
  // breakevenTriggerPct in our favor (stays latched even through a pullback —
  // evaluateExit just reads it below). No-op unless the user set a trigger.
  pos.be_armed = breakevenArmed(pos, pnlPct, config.breakevenTriggerPct);

  // Exit decision: multi-TP scale-out + trailing stop, with hard-stop priority
  // BE→SL→TIMEOUT→trail over take-profit (tested in logic.mjs). Uses per-position
  // levels resolved at entry, falling back to config for legacy positions.
  const action = evaluateExit(pos, pnlPct, Date.now() - pos.opened_at, {
    tpPercent: pos.tpPercent ?? config.tpPercent,
    slPercent: pos.slPercent ?? config.slPercent,
    maxHoldHours: config.maxHoldHours,
    takeProfits: pos.takeProfits,
    trailingStopPct: config.trailingStopPct,
    trailActivatePct: config.trailActivatePct,
    breakevenBufferPct: config.breakevenBufferPct,
  });

  if (action && action.type === "FULL_CLOSE") {
    await closePosition(address, state, config, env, action.reason, cache, currentPrice);
    return;
  }
  if (action && action.type === "PARTIAL_TP") {
    await partialClose(address, state, config, env, action, cache);
    return; // partialClose persists state (and full-closes if only dust remains)
  }
  if (action && action.type === "TRAIL_UPDATE") {
    pos.peak_pnl_pct = action.peak;
    pos.trail_stop = action.trailStop;
  }

  // Still holding — save updated state
  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  console.log(`[exec] ${address.slice(0, 10)} HOLDING ${pos.direction} ${pos.symbol.replace("PERP_","").replace("_USDC","")} pnl=${pnlPct.toFixed(3)}%`);
}

// Insert a closed-trade (or scale-out slice) row into Supabase agent_trades.
// Writes the full auditable row (order IDs + ladder parent_id/exit_seq + strategy +
// source_leader — all six columns verified present 2026-09-25). If that row is ever
// rejected, it retries with just the core columns so a real trade never vanishes from
// the ledger/leaderboard — but that row is UNAUDITABLE (no order IDs), so it logs an
// error, not a warning. SERVICE key = least privilege (anon RLS blocks forged
// inserts). Shared by closePosition + partialClose so the write path can't drift.
async function logAgentTrade(address, env, auditable) {
  const writeKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  const insert = async (payload) => fetch(`${env.SUPABASE_URL}/rest/v1/agent_trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: writeKey, Authorization: `Bearer ${writeKey}` },
    body: JSON.stringify(payload),
  });
  // Core row = drop optional columns that may not be migrated yet.
  const { entry_order_id, close_order_id, parent_id, exit_seq, strategy, source_leader, ...core } = auditable;
  try {
    let res = await insert({ wallet_address: address, ...auditable });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[exec] ${address.slice(0, 10)} auditable insert REJECTED (${res.status}) — logging core row WITHOUT order IDs:`, detail.slice(0, 200));
      res = await insert({ wallet_address: address, ...core });
      if (!res.ok) console.error(`[exec] ${address.slice(0, 10)} core insert also failed (${res.status})`);
    }
  } catch (e) {
    console.error(`[exec] ${address.slice(0, 10)} supabase log failed:`, e.message);
  }
}

// Average INTO a position (DCA safety order): place a same-side market order for
// this safety order's margin, blend it into avg_entry/total_qty, advance the ladder.
// Not reduce-only — it ADDS to the position. The whole ladder is pre-budgeted within
// capitalPerTrade so total exposure stays bounded.
async function addSafetyOrder(address, state, config, env, so, price) {
  const pos = state.current_position;
  if (!pos) return;
  const paper = !!pos.paper;
  const tick = pos.base_tick || 0.001;
  const snap = snapQty({
    capitalPerTrade: so.soMargin, leverage: config.leverage,
    markPrice: price, baseTick: tick, baseMin: pos.base_min || tick, minNotional: pos.min_notional || 0,
  });
  if (!snap.ok) {
    // This safety order is too small to place — consume the level so we advance the
    // ladder (and can still hit the final stop) instead of retrying forever.
    pos.filled_safety_orders = (pos.filled_safety_orders || 0) + 1;
    await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
    console.log(`[exec] ${address.slice(0, 10)} DCA SO${so.level} skipped (${snap.reason})`);
    return;
  }
  const addQty = snap.qty;
  let addPrice = price; // live: the safety order's own fill (readFill)
  const side = pos.direction === "LONG" ? "BUY" : "SELL";
  if (!paper) {
    const keyRaw = await env.NEXUS_AGENT.get(`agent:key:${address}`);
    if (keyRaw) {
      try {
        const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));
        const r = await orderlyRequest(keyData, "POST", "/v1/order", {
          symbol: pos.symbol, order_type: "MARKET", side, order_quantity: addQty, broker_id: "nexus_trading",
        });
        if (r && r.success === false) { console.error(`[exec] ${address.slice(0, 10)} DCA SO order failed:`, JSON.stringify(r)); return; }
        addPrice = (await readFill(keyData, r?.data?.order_id, price)).price;
      } catch (e) { console.error(`[exec] ${address.slice(0, 10)} DCA SO error:`, e.message); return; }
    } else {
      // No key = no order placed: never book a safety order that didn't happen.
      console.error(`[exec] ${address.slice(0, 10)} DCA SO skipped: no key`);
      return;
    }
  }
  const blended = blendAvg(pos.total_qty, pos.avg_entry, addQty, addPrice);
  pos.avg_entry = blended.newAvg;
  pos.total_qty = blended.newQty;
  pos.remaining_qty = blended.newQty;
  pos.qty = blended.newQty; // keep qty in sync (used by the reduce-only close)
  pos.filled_safety_orders = (pos.filled_safety_orders || 0) + 1;
  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  console.log(`[exec] ${address.slice(0, 10)} ${paper ? "PAPER " : ""}DCA SO${so.level} +${addQty} @ ${price} → avg ${pos.avg_entry.toFixed(4)} qty ${pos.total_qty}`);
  await fireCallback(address, config, env, "DCA_ADD", {
    symbol: pos.symbol, direction: pos.direction, qty: addQty, price, leverage: config.leverage, paper,
  });
}

// Scale OUT a fraction of an open position at a take-profit level (multi-TP). Sends
// a reduce-only market order for the slice, realizes its P&L to a per-slice Supabase
// row (shared parent_id, exit_seq), and keeps the runner. If what would remain is
// dust (below base_min / min_notional), close the whole thing instead so we never
// strand an unsellable remainder.
async function partialClose(address, state, config, env, action, cache) {
  const pos = state.current_position;
  if (!pos) return;
  const paper = !!pos.paper;
  const remaining = pos.remaining_qty ?? pos.qty;
  const tick = pos.base_tick || 0.001;
  const decimals = Math.max(0, Math.round(-Math.log10(tick)));

  // Slice = sizePct of the ORIGINAL qty, snapped to the tick.
  const rawSlice = pos.qty * (action.sizePct / 100);
  let slice = parseFloat((Math.floor(rawSlice / tick) * tick).toFixed(decimals));
  const afterRemain = parseFloat((remaining - slice).toFixed(decimals));

  // Dust guard: if the slice is too small to place, or the leftover would be below
  // the exchange minimum, just close the full remainder as a TP.
  const price = pos.current_price;
  let slicePrice = price; // live: the slice's own fill (readFill)
  const tooSmallSlice = slice < (pos.base_min || tick) || slice <= 0;
  const leftoverDust = afterRemain > 0 && (afterRemain < (pos.base_min || tick) ||
    (pos.min_notional && afterRemain * price < pos.min_notional));
  if (tooSmallSlice || leftoverDust || afterRemain <= 0) {
    await closePosition(address, state, config, env, "TP", cache, price);
    return;
  }

  // Place the reduce-only slice (real positions only).
  let sliceOrderId = null;
  if (!paper) {
    const keyRaw = await env.NEXUS_AGENT.get(`agent:key:${address}`);
    if (keyRaw) {
      try {
        const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));
        const closeSide = pos.direction === "LONG" ? "SELL" : "BUY";
        const r = await orderlyRequest(keyData, "POST", "/v1/order", {
          symbol: pos.symbol, order_type: "MARKET", side: closeSide,
          order_quantity: slice, reduce_only: true, broker_id: "nexus_trading",
        });
        if (r && r.success === false) {
          console.error(`[exec] ${address.slice(0, 10)} partial TP order failed:`, JSON.stringify(r));
          return; // leave the position intact; try again next tick
        }
        sliceOrderId = r?.data?.order_id ?? null;
        slicePrice = (await readFill(keyData, sliceOrderId, price)).price;
      } catch (e) {
        console.error(`[exec] ${address.slice(0, 10)} partial TP error:`, e.message);
        return;
      }
    } else {
      // No key = no reduce-only order placed: never book a slice that didn't happen.
      console.error(`[exec] ${address.slice(0, 10)} partial TP skipped: no key`);
      return;
    }
  }

  // Realize this slice's P&L and advance the ladder state.
  const { pnlPct, pnlUsdc } = computePnl(pos.direction, pos.entry_price, slicePrice, slice);
  state.daily_pnl = (state.daily_pnl || 0) + pnlUsdc;
  pos.remaining_qty = afterRemain;
  pos.tp_hits = [...(pos.tp_hits || []), action.level];

  const sliceTrade = {
    symbol: pos.symbol, direction: pos.direction, entry_price: pos.entry_price,
    exit_price: slicePrice, qty: slice, leverage: pos.leverage ?? null, pnl: pnlUsdc, pnl_percent: pnlPct,
    reason: "TP_PARTIAL",
    opened_at: new Date(pos.opened_at).toISOString(), closed_at: new Date().toISOString(),
  };
  if (paper) {
    // tp_level is added on the PAPER row only — the live insert keeps its exact
    // existing column set (an unmigrated column would drop the row to the fallback).
    const paperSlice = { id: `paper_${Date.now()}`, tp_level: action.level, ...sliceTrade };
    state.paper_trades = state.paper_trades || [];
    state.paper_trades.unshift(paperSlice);
    if (state.paper_trades.length > 50) state.paper_trades.pop();
    state.paper_agg = accruePaperAgg(state.paper_agg, paperSlice);
  } else {
    await logAgentTrade(address, env, {
      ...sliceTrade,
      entry_order_id: pos.order_id ?? null, close_order_id: sliceOrderId,
      ...(pos.source_leader ? { source_leader: pos.source_leader } : {}),
      parent_id: `agent_${address.slice(2, 8)}_${pos.opened_at}`, exit_seq: pos.tp_hits.length,
    });
  }

  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  console.log(`[exec] ${address.slice(0, 10)} ${paper ? "PAPER " : ""}PARTIAL TP L${action.level} ${action.sizePct}% slice=${slice} pnl=$${pnlUsdc.toFixed(4)} remaining=${afterRemain}`);
  await fireCallback(address, config, env, "PARTIAL_TP", {
    symbol: pos.symbol, direction: pos.direction, qty: slice, price, leverage: pos.leverage, reason: "TP_PARTIAL", pnl: pnlUsdc, pnlPercent: pnlPct, paper,
  });
}

// Append this paper close to the wallet's hash-chained paper ledger (app/lib/paperLedger.mjs).
// Rows live under their own KV keys, so they survive a reset and are never truncated.
// Never throws: a KV failure is logged loudly and the trade still closes. The head only
// advances after the row is stored, so a failed write leaves a visible gap, not a fake row.
async function appendPaperLog(address, state, env, row) {
  try {
    const seq = (Number(state.paper_seq) || 0) + 1;
    const head = await nextPaperHead(state.paper_head || GENESIS_HEAD, seq, row);
    await env.NEXUS_AGENT.put(paperSeqKey(address, seq), JSON.stringify({ seq, row, head }));
    state.paper_seq = seq;
    state.paper_head = head;
  } catch (e) {
    console.error(`[exec] ${address.slice(0, 10)} paper log REJECTED:`, String(e?.message || e).slice(0, 200));
  }
}

async function closePosition(address, state, config, env, reason, cache, decisionPrice = null) {
  const pos = state.current_position;
  if (!pos) return;
  const paper = !!pos.paper;
  let closeOrderId = null;
  let closeFill = null; // live: { price, source } of the reduce-only close
  // Paper positions never touched the exchange, so the close is always "confirmed".
  // For real positions this only flips true once Orderly ACCEPTS the reduce-only
  // close — otherwise we must NOT mark the trade closed (see the guard below).
  let closeConfirmed = paper;
  // After multi-TP scale-outs only the runner remains — close THAT, not the
  // original size (legacy positions have no remaining_qty → fall back to qty).
  const closeQty = pos.remaining_qty ?? pos.qty;
  let closeKey = null; // live: the key the close was sent with (the backstop cancel uses it)

  // Real positions: send a reduce-only market close. Paper positions never
  // touched the exchange, so there's nothing to close — skip straight to P&L.
  if (!paper) {
    const keyRaw = await env.NEXUS_AGENT.get(`agent:key:${address}`);
    if (!keyRaw) {
      // Key was deleted (kill switch): we can't place a close. Clear the record
      // anyway — the position auto-liquidates or the user closes it manually.
      closeConfirmed = true;
      console.warn(`[exec] ${address.slice(0, 10)} no key — cannot place close (reason=${reason}); clearing record`);
    } else {
      const keyData = await resolveKeyRecord(JSON.parse(keyRaw), keyIo(address, env));
      closeKey = keyData;
      const closeSide = pos.direction === "LONG" ? "SELL" : "BUY";

      try {
        const closeOrder = await orderlyRequest(keyData, "POST", "/v1/order", {
          symbol: pos.symbol,
          order_type: "MARKET",
          side: closeSide,
          order_quantity: closeQty,
          reduce_only: true,
          broker_id: "nexus_trading",
        });
        // Orderly returns { success:false, code, message } on a REJECT without
        // throwing — treating that as closed abandons a still-open position (the
        // "ghost": marked closed in KV/History while live on the exchange). Only
        // confirm on an accepted order.
        if (closeOrder?.success === false) {
          console.error(`[exec] ${address.slice(0, 10)} close order REJECTED:`, JSON.stringify(closeOrder).slice(0, 200));
        } else {
          closeOrderId = closeOrder?.data?.order_id ?? null;
          closeFill = await readFill(keyData, closeOrderId, null);
          closeConfirmed = true;
        }
      } catch (e) {
        console.error(`[exec] ${address.slice(0, 10)} close order failed:`, e.message);
      }
    }
  }

  // If a real close was attempted but the exchange never confirmed it, DO NOT clear
  // state or log a close — the position is still open. Keep it so the next tick
  // retries; the reconcile self-heal clears it only once the exchange truly shows
  // flat. This is what prevents the unmanaged ghost the user hit (agent shows flat
  // while a live position sits on Orderly unmanaged).
  if (!closeConfirmed) {
    console.warn(`[exec] ${address.slice(0, 10)} close NOT confirmed (reason=${reason}) — keeping position open for retry next tick`);
    return;
  }

  // Closed: the resting backstop goes too (queued for cleanup if the cancel doesn't go through).
  if (!paper) await cancelBackstop(address, state, pos, closeKey);

  // Book the close. PAPER books at the price the exit was DECIDED on — there is no real
  // fill to approximate, and a second mark read only lets the booked price drift from the
  // one that triggered the exit (that drift is how a "TP" row gets recorded red: the
  // monitor can fall back to the last known price, decide TP on it, and then this read
  // succeeds with a worse one). LIVE still re-fetches — there the fresh mark is the best
  // proxy for the price the exchange actually filled at.
  let exitPrice = pos.current_price;
  if (!paper && closeFill?.source === "exchange") {
    exitPrice = closeFill.price; // what the exchange actually filled the close at
  } else if (paper && Number.isFinite(decisionPrice) && decisionPrice > 0) {
    exitPrice = resolveExitPrice({ paper, decisionPrice, fetchedPrice: exitPrice });
  } else {
    try {
      exitPrice = resolveExitPrice({ paper, decisionPrice, fetchedPrice: await getMarkPrice(pos.symbol, env, cache) });
    } catch { /* best-effort */ }
  }

  // DCA positions realize P&L against the BLENDED average entry (the honest cost
  // basis after averaging in); single-entry positions use their entry price.
  const entryForPnl = pos.avg_entry ?? pos.entry_price;
  const { pnlPct, pnlUsdc } = computePnl(pos.direction, entryForPnl, exitPrice, closeQty);

  // Update daily P&L
  state.daily_pnl = (state.daily_pnl || 0) + pnlUsdc;
  state.current_position = null;
  // The cooldown counts from the exit too, as the reconcile path and parity already assume
  // (paperParity: an entry occupies [open, close + 15 min)). It used to count from the entry
  // only, so a stop inside 15 min of the entry allowed an immediate re-entry.
  state.last_trade_time = Date.now();

  const trade = {
    symbol: pos.symbol,
    direction: pos.direction,
    entry_price: entryForPnl,
    exit_price: exitPrice,
    qty: closeQty,
    leverage: pos.leverage ?? null,
    pnl: pnlUsdc,
    pnl_percent: pnlPct,
    reason,
    strategy: pos.strategy ?? null,
    opened_at: new Date(pos.opened_at).toISOString(),
    closed_at: new Date().toISOString(),
  };
  // Orderly order IDs make every record independently auditable against the
  // exchange (anyone can verify the order existed + its fill). Optional columns.
  // If this position scaled out (tp_hits), tag the final row with the same
  // parent_id so the slices + runner read as one position in the ledger.
  const laddered = (pos.tp_hits || []).length > 0;
  const auditable = {
    ...trade, entry_order_id: pos.order_id ?? null, close_order_id: closeOrderId,
    ...(pos.source_leader ? { source_leader: pos.source_leader } : {}),
    ...(laddered ? { parent_id: `agent_${address.slice(2, 8)}_${pos.opened_at}`, exit_seq: pos.tp_hits.length + 1 } : {}),
  };

  if (paper) {
    // Paper trades live in state (rides along in the API's state response) so
    // they stay completely separate from the real Supabase track record.
    state.paper_trades = state.paper_trades || [];
    // A fixed-risk position carries the dollars it risked, so the row reads in R (pnl ÷ risk_usd). Paper rows
    // only: the live Supabase row's columns are unchanged.
    state.paper_trades.unshift({ id: `paper_${Date.now()}`, ...auditable, ...(pos.risk_usd > 0 ? { risk_usd: pos.risk_usd } : {}) });
    if (state.paper_trades.length > 50) state.paper_trades.pop(); // keep last 50
    // ⚠️ That pop is why the window is NOT the record. Accrue the LIFETIME aggregate
    // here, once, at close — it cannot be rebuilt from a truncated window later.
    state.paper_agg = accruePaperAgg(state.paper_agg, auditable);
    await appendPaperLog(address, state, env, auditable);
  } else {
    await logAgentTrade(address, env, auditable);
  }

  // One-shot directive: retire it on close so it can never re-enter. By default a
  // directive means "make THIS trade" — so the agent goes idle afterward rather than
  // silently drifting into brain-signal trades the user never asked for. A user who
  // wants the signal bot to keep running sets resumeSignals on the directive.
  if (pos.directive_id) {
    try {
      const dRaw = await env.NEXUS_AGENT.get(`agent:directive:${address}`);
      if (dRaw) {
        const d = JSON.parse(dRaw);
        d.status = "DONE"; d.result = reason; d.closedAt = Date.now();
        await env.NEXUS_AGENT.put(`agent:directive:${address}`, JSON.stringify(d), { expirationTtl: 24 * 3600 });
        if (!d.resumeSignals) {
          state.active = false;
          console.log(`[exec] ${address.slice(0, 10)} directive done (${reason}) → agent idle`);
        }
      }
    } catch { /* best-effort — never block the close */ }
  }

  // Resolve the published feed thesis (if this trade was published on entry).
  // NOT gated by PUBLISH_AGENT_FEED: if an entry was published (has a feed_id),
  // always resolve it to CLOSED on exit — otherwise toggling the publish flag off
  // between entry and close orphans the card as ACTIVE forever (zombie position).
  if (pos.feed_id) {
    try {
      await publishAgentClose(address, env, pos.feed_id, { reason, pnlUsdc, exitPrice });
    } catch (e) {
      console.error(`[exec] ${address.slice(0, 10)} agent feed close failed:`, e.message);
    }
  }

  await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));
  console.log(`[exec] ${address.slice(0, 10)} ${paper ? "PAPER " : ""}CLOSE ${pos.direction} ${pos.symbol} reason=${reason} pnl=$${pnlUsdc.toFixed(4)}`);

  const tkClose = pos.symbol.replace("PERP_", "").replace("_USDC", "");
  const sign = pnlUsdc >= 0 ? "+" : "";
  await notifyTelegram(address, env,
    `${paper ? "📝 <b>[PAPER]</b> " : (pnlUsdc >= 0 ? "✅ " : "🔴 ")}<b>CLOSE ${pos.direction} ${tkClose}</b> · ${reason}\n` +
    `P&L ${sign}$${pnlUsdc.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`);

  await fireCallback(address, config, env, "CLOSE", {
    symbol: pos.symbol, direction: pos.direction, qty: closeQty, price: exitPrice,
    leverage: pos.leverage, reason, pnl: pnlUsdc, pnlPercent: pnlPct, paper,
  });
}
