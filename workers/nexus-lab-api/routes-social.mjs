// ── /notifications/:wallet and /follows/:wallet ──────────────────────────────────────────
// Moved out of index.js (2026-10-16) when they got the owner check. Both used to trust the URL:
// anyone could mark another wallet's notifications read, delete them, or rewrite its follow list
// (and send "started following you" to every wallet in it). Now the writes carry `labAuth` in
// the JSON body, the wallet's Lab signature (socialAuth.mjs); the reads stay public.
//
//   GET    /notifications/:wallet        → the list, newest first (public)
//   PUT    /notifications/:wallet/read   → mark all read          body { labAuth }
//   DELETE /notifications/:wallet/:id    → remove one             body { labAuth }
//   GET    /follows/:wallet              → { following } (public)
//   PUT    /follows/:wallet              → replace the list       body { following, labAuth }
//
// No POST on /notifications: they are written only by the server (appendNotification).
import { json, normalizeAddress, appendNotification } from "./shared.mjs";
import { provenWallet, unsignedSocial } from "./socialAuth.mjs";

async function bodyOrNull(request) {
  try { return await request.json(); } catch { return null; }
}

export async function handleSocial(parts, request, env, { now = Date.now } = {}) {
  if (parts[0] === "notifications" && parts[1]) {
    const wallet = normalizeAddress(parts[1]);
    const notifKey = `notif:${wallet}`;

    // GET /notifications/:wallet
    if (request.method === "GET" && parts.length === 2) {
      const raw = await env.LAB_STORE.get(notifKey);
      return json(raw ? JSON.parse(raw) : [], request);
    }

    // PUT /notifications/:wallet/read — mark all read (owner only)
    if (request.method === "PUT" && parts.length === 3 && parts[2] === "read") {
      const who = provenWallet(wallet, (await bodyOrNull(request))?.labAuth, now());
      if (!who.ok) return unsignedSocial(request, who);
      const raw = await env.LAB_STORE.get(notifKey);
      if (!raw) return json({ ok: true }, request);
      const at = Date.now();
      const list = JSON.parse(raw).map((n) => n.readAt ? n : { ...n, readAt: at });
      await env.LAB_STORE.put(notifKey, JSON.stringify(list));
      return json({ ok: true }, request);
    }

    // DELETE /notifications/:wallet/:id (owner only)
    if (request.method === "DELETE" && parts.length === 3) {
      const who = provenWallet(wallet, (await bodyOrNull(request))?.labAuth, now());
      if (!who.ok) return unsignedSocial(request, who);
      const id = parts[2];
      const raw = await env.LAB_STORE.get(notifKey);
      if (!raw) return json({ ok: true }, request);
      const list = JSON.parse(raw).filter((n) => n.id !== id);
      await env.LAB_STORE.put(notifKey, JSON.stringify(list));
      return json({ ok: true }, request);
    }

    return json({ error: "method not allowed" }, request, 405);
  }

  // ── Ph24: /follows/:wallet → follow graph ──────────────
  if (parts[0] === "follows" && parts[1]) {
    const wallet = normalizeAddress(parts[1]);
    const followKey = `follows:${wallet}`;
    if (request.method === "GET") {
      const raw = await env.LAB_STORE.get(followKey);
      return json({ following: raw ? JSON.parse(raw) : [] }, request);
    }
    if (request.method === "PUT") {
      const body = await bodyOrNull(request);
      if (!body) return json({ error: "invalid json" }, request, 400);
      // Owner check FIRST: the write and the follow notifications below are side effects.
      const who = provenWallet(wallet, body.labAuth, now());
      if (!who.ok) return unsignedSocial(request, who);
      if (!Array.isArray(body.following)) return json({ error: "expected { following: [] }" }, request, 400);
      const newFollowing = body.following.map((a) => normalizeAddress(a)).slice(0, 500);

      // Detect newly followed wallets to trigger notifications
      const oldRaw = await env.LAB_STORE.get(followKey);
      const oldSet = new Set(oldRaw ? JSON.parse(oldRaw) : []);
      const newlyAdded = newFollowing.filter((a) => !oldSet.has(a));

      await env.LAB_STORE.put(followKey, JSON.stringify(newFollowing));

      // Notify each newly followed wallet
      const followerShort = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
      await Promise.all(
        newlyAdded.map((followedWallet) =>
          appendNotification(env, followedWallet, {
            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: "follow",
            message: `${followerShort} started following you`,
            fromWallet: wallet,
            createdAt: Date.now(),
          })
        )
      );

      return json({ ok: true }, request);
    }
    return json({ error: "method not allowed" }, request, 405);
  }

  return null;
}
