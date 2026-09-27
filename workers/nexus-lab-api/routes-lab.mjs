// ── /profile/:address and /lab/:address — a wallet's profile, calls and journal ──────────────
// Only the wallet can change its record. Every write carries `labAuth` in the JSON body (the
// wallet's signature over app/lib/labAuth.mjs labSaveMessage) and is checked BEFORE any side
// effect: no write, no copy count, no challenge fan-out, no autocopy stamp. The signature is
// never stored. (These routes used to trust the URL, so anyone who knew an address could replace,
// delete or read that wallet's record.)
//
//   GET    /lab/:address              → the PUBLIC view: public calls only, no notes
//   POST   /lab/:address/read         → the full record (private calls + notes), owner only
//   PUT    /lab/:address              → replace the record, owner only
//   DELETE /lab/:address/thesis/:id   → remove one call, owner only
//   PUT    /profile/:address          → display name + pfp, owner only (GET stays public)
import { json, normalizeAddress, appendNotification, checkLabAuth } from "./shared.mjs";
import { normalizeSymbol } from "./logic.mjs";
import { publicLabView } from "../../app/lib/labAuth.mjs";

// 401 and nothing else happens. `error` tells the client which action to re-sign for.
const unsigned = (request, error, v) =>
  json({ error, reason: v.reason, hint: "Sign the Nexus Lab message with this wallet and send it as body.labAuth." }, request, 401);

async function bodyOrNull(request) {
  try { return await request.json(); } catch { return null; }
}

export async function handleProfile(parts, request, env, { now = Date.now } = {}) {
  if (!parts[1]) return json({ error: "not found" }, request, 404);
  const address = normalizeAddress(parts[1]);
  const profileKey = `profile:${address}`;

  if (request.method === "GET") {
    const raw = await env.LAB_STORE.get(profileKey);
    if (!raw) return json({ pfp: null, displayName: null }, request);
    return json(JSON.parse(raw), request);
  }

  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, request, 400);
    }
    const auth = checkLabAuth(address, body?.labAuth, now());
    if (!auth.ok) return unsigned(request, "sign_to_save", auth);
    // Only allow pfp (URL string) and displayName
    const profile = {
      pfp: typeof body.pfp === "string" ? body.pfp.trim().slice(0, 500) : null,
      displayName:
        typeof body.displayName === "string" ? body.displayName.trim().slice(0, 40) : null,
    };
    await env.LAB_STORE.put(profileKey, JSON.stringify(profile));
    return json({ ok: true }, request);
  }

  return json({ error: "method not allowed" }, request, 405);
}

export async function handleLab(parts, request, env, { now = Date.now } = {}) {
  // ── /lab/:address ──────────────────────────────────────
  if (parts[0] !== "lab" || !parts[1]) {
    return json({ error: "not found" }, request, 404);
  }

  const address = normalizeAddress(parts[1]);
  const kvKey = `lab:${address}`;

  // ── GET /lab/:address — public view (public calls only, no notes) ─
  if (request.method === "GET") {
    const raw = await env.LAB_STORE.get(kvKey);
    if (!raw) {
      return json({ theses: [], notes: {} }, request);
    }
    return json(publicLabView(JSON.parse(raw)), request);
  }

  // ── POST /lab/:address/read — the full record, owner only ─
  if (request.method === "POST" && parts[2] === "read") {
    const body = await bodyOrNull(request);
    const auth = checkLabAuth(address, body?.labAuth, now());
    if (!auth.ok) return unsigned(request, "sign_to_read", auth);
    const raw = await env.LAB_STORE.get(kvKey);
    return json(raw ? JSON.parse(raw) : { theses: [], notes: {} }, request);
  }

  // ── PUT /lab/:address ──────────────────────────────────
  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, request, 400);
    }

    // Owner check FIRST: everything below (copy count, notifications, autocopy stamp, write) is a
    // side effect on someone's record.
    const auth = checkLabAuth(address, body?.labAuth, now());
    if (!auth.ok) return unsigned(request, "sign_to_save", auth);

    if (!Array.isArray(body.theses) || typeof body.notes !== "object") {
      return json({ error: "expected { theses: [], notes: {} }" }, request, 400);
    }

    // Ph27/28: notify original author and increment copyCount when a thesis is copied
    if (body.copiedFromWallet && typeof body.copiedFromWallet === "string") {
      const originalWallet = normalizeAddress(body.copiedFromWallet);
      if (originalWallet !== address) {
        const symbol = typeof body.copiedThesisSymbol === "string"
          ? body.copiedThesisSymbol.replace("PERP_", "").replace("_USDC", "")
          : "unknown";
        const direction = typeof body.copiedThesisDirection === "string" ? ` ${body.copiedThesisDirection}` : "";

        // Ph28: increment copyCount on the original thesis
        if (body.copiedThesisId && typeof body.copiedThesisId === "string") {
          const origRaw = await env.LAB_STORE.get(`lab:${originalWallet}`);
          if (origRaw) {
            const origData = JSON.parse(origRaw);
            const origThesis = (origData.theses || []).find((t) => t.id === body.copiedThesisId);
            if (origThesis) {
              origThesis.copyCount = (origThesis.copyCount || 0) + 1;
              await env.LAB_STORE.put(`lab:${originalWallet}`, JSON.stringify(origData));
            }
          }
        }

        await appendNotification(env, originalWallet, {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: "copy",
          message: `Someone copied your ${symbol}${direction} thesis`,
          fromWallet: address,
          createdAt: Date.now(),
        });
      }
    }

    // Challenge fan-out: when a thesis goes PUBLIC, tell active opposing callers on
    // the same symbol that a counter-view just landed — turning disagreement into a
    // thread. Fires ONLY on the public transition (compared against the stored copy),
    // never on ordinary edits, so the caller scan stays off the hot path. Capped both
    // ways to bound work + spam. (An aggregate symbol→callers index would remove the
    // scan if publish volume ever grows.)
    try {
      const prevRaw = await env.LAB_STORE.get(kvKey);
      const prevPublic = new Set(
        prevRaw ? (JSON.parse(prevRaw).theses || []).filter((t) => t.isPublic).map((t) => t.id) : []
      );
      const newlyPublic = (body.theses || []).filter(
        (t) => t.isPublic && t.id && !prevPublic.has(t.id) && t.symbol && t.direction
      );
      // Autocopy fan-out: stamp the caller's NEWEST just-published call into the
      // agent namespace so followers' agents can mirror it (exec reads
      // caller:latest:{addr}). Self-expiring; the exec gates on stampedAt freshness
      // so a stale call never fires late. Symbol → canonical PERP_ id the exec trades.
      if (newlyPublic.length && env.NEXUS_AGENT) {
        const nt = newlyPublic.reduce((a, b) => ((b.createdAt || 0) > (a.createdAt || 0) ? b : a));
        const sym = normalizeSymbol(nt.symbol);
        if (sym) {
          await env.NEXUS_AGENT.put(`caller:latest:${address}`, JSON.stringify({
            symbol: sym, direction: String(nt.direction).toUpperCase(), id: nt.id,
            createdAt: nt.createdAt || Date.now(), stampedAt: Date.now(),
          }), { expirationTtl: 6 * 3600 });
        }
      }
      if (newlyPublic.length) {
        const listed = await env.LAB_STORE.list({ prefix: "lab:" });
        for (const nt of newlyPublic.slice(0, 3)) {
          const sym = String(nt.symbol);
          const bareSym = sym.replace("PERP_", "").replace("_USDC", "");
          const dir = String(nt.direction).toUpperCase();
          const opp = dir === "LONG" ? "SHORT" : "LONG";
          let notified = 0;
          for (const k of listed.keys) {
            if (notified >= 10) break;
            const w = k.name.replace("lab:", "");
            if (w === address) continue;
            const raw2 = await env.LAB_STORE.get(k.name);
            if (!raw2) continue;
            let d2; try { d2 = JSON.parse(raw2); } catch { continue; }
            const opposes = (d2.theses || []).some(
              (t) => t.isPublic && t.symbol === sym && String(t.direction).toUpperCase() === opp
                && (t.status === "ACTIVE" || !t.status)
                && t.gradedOutcome !== "WIN" && t.gradedOutcome !== "LOSS"
            );
            if (!opposes) continue;
            await appendNotification(env, w, {
              id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              type: "challenge",
              message: `Someone posted an opposing ${bareSym} ${dir} call`,
              fromWallet: address,
              thesisId: nt.id,
              thesisWallet: address,
              createdAt: Date.now(),
            });
            notified++;
          }
        }
      }
    } catch (e) { console.error("[challenge] fan-out failed", e && e.message); }

    // Strip copy metadata + the signature before persisting (a stored signature is a replayable one)
    const { labAuth: _la, copiedFromWallet: _cfw, copiedThesisSymbol: _cts, copiedThesisDirection: _ctd, copiedThesisId: _cti, ...dataToSave } = body;
    await env.LAB_STORE.put(kvKey, JSON.stringify(dataToSave));
    return json({ ok: true }, request);
  }

  // ── DELETE /lab/:address/thesis/:id ────────────────────
  if (request.method === "DELETE" && parts[2] === "thesis" && parts[3]) {
    const auth = checkLabAuth(address, (await bodyOrNull(request))?.labAuth, now());
    if (!auth.ok) return unsigned(request, "sign_to_save", auth);
    const thesisId = parts[3];
    const raw = await env.LAB_STORE.get(kvKey);
    if (!raw) return json({ ok: true }, request);

    const data = JSON.parse(raw);
    data.theses = (data.theses || []).filter((t) => t.id !== thesisId);
    await env.LAB_STORE.put(kvKey, JSON.stringify(data));
    return json({ ok: true }, request);
  }

  return json({ error: "method not allowed" }, request, 405);
}
