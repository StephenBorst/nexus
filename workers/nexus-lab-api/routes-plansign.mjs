// ── /pipeline/live-plan/:axis — the read's live plan, and the owner's wallet signature on it (after a PASS) ─────
// Rules: app/lib/livePlanSign.mjs. The page's exact text + sha256 come from app/lib/livePlanText.mjs (generated from the
// page, test-pinned), so what the owner reads, what the hash covers and what's in git are one text.
//   GET  /pipeline/live-plan/:axis      → { axis, doc, text, sha256, verdict, licensed, signed: record|null } (public)
//   POST /pipeline/live-plan/:axis/sign { address, ts, sig, sha256 } → a treasury Safe owner or an OPS_WALLETS address
//        signing livePlanSignMessage within 5 minutes, over the page as committed, only once the read's 30-trade
//        verdict is RECORDED as PASS. Once per page. Stored in LAB_STORE; the watcher appends it under Sign-off.
//        ARMS NOTHING: GRADED_EXIT_LIVE_LIFT stays empty until borst's own arming PR.
import { json, recoverEthAddress } from "./shared.mjs";
import { isRevenueViewer } from "./revenue.mjs";
import { ownersOf } from "./routes-revenue.mjs";
import { withLock, LOCK_KEYS, LockBusy } from "./lock.mjs";
import { readRecordedJudgment } from "./paperJudge.mjs";
import { CLAIM_SIG_MAX_AGE_MS, CLAIM_SIG_SKEW_MS } from "../../app/lib/paperClaim.mjs";
import { LIVE_PLAN_SIGS_KEY, livePlanSignMessage, planSignRefusal } from "../../app/lib/livePlanSign.mjs";
import { LIVE_PLAN_TEXT } from "../../app/lib/livePlanText.mjs";

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export async function readPlanSigs(env) {
  try {
    const o = JSON.parse((await env.LAB_STORE.get(LIVE_PLAN_SIGS_KEY)) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch { return {}; }
}

export async function handlePlanSign(parts, request, env, { now = Date.now, fetchImpl = globalThis.fetch, lock = withLock, plans = LIVE_PLAN_TEXT } = {}) {
  if (!(parts[0] === "pipeline" && parts[1] === "live-plan" && parts[2])) return null;
  const axis = String(parts[2]).slice(0, 64);
  const isSign = parts[3] === "sign" && parts.length === 4;
  if (!isSign && parts.length !== 3) return null;
  if (!env.LAB_STORE) return json({ error: "store_unbound" }, request, 503);
  const plan = plans[axis] || null;

  if (!isSign) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, request, 405);
    if (!plan) return json({ error: "no_plan", axis }, request, 404);
    const verdict = (await readRecordedJudgment(env, axis).catch(() => null))?.verdict || null;
    const signed = (await readPlanSigs(env))[axis]?.[plan.sha256] || null;
    return json({ axis, doc: plan.doc, text: plan.text, sha256: plan.sha256, verdict, licensed: verdict === "PASS", signed }, request);
  }

  if (request.method !== "POST") return json({ error: "method not allowed" }, request, 405);
  let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const address = String(body?.address || "").toLowerCase();
  const ts = Number(body?.ts);
  if (!isEvm(address)) return json({ error: "bad_address" }, request, 400);
  if (!Number.isFinite(ts) || typeof body?.sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.sig)) return json({ error: "sign_to_sign" }, request, 401);
  const at = now();
  if (ts > at + CLAIM_SIG_SKEW_MS) return json({ error: "signed_in_future" }, request, 401);
  if (at - ts > CLAIM_SIG_MAX_AGE_MS) return json({ error: "signature_expired" }, request, 401);
  const sha = String(body.sha256 || "").toLowerCase();

  try {
    return await lock(env, LOCK_KEYS.planSigs(), async () => {
      const verdict = (await readRecordedJudgment(env, axis).catch(() => null))?.verdict || null;
      const sigs = await readPlanSigs(env);
      const no = planSignRefusal({ axis, verdict, planSha: plan?.sha256 || null, sha, signed: plan ? sigs[axis]?.[plan.sha256] : null });
      if (no) return json(no, request, no.status);
      let signer = null;
      try { signer = recoverEthAddress(livePlanSignMessage(address, axis, sha, ts), body.sig); } catch { signer = null; }
      if (!signer || String(signer).toLowerCase() !== address) return json({ error: "bad_signature" }, request, 401);
      const owners = await ownersOf(env, fetchImpl);
      if (!isRevenueViewer(address, owners, env.OPS_WALLETS)) {
        return json({ error: "not_allowed", hint: "Only a treasury Safe owner (or an OPS_WALLETS address) can sign.", ownersRead: owners.length > 0 }, request, 403);
      }
      const rec = { axis, by: address, at: new Date(at).toISOString(), sigTs: ts, sig: body.sig, sha256: sha };
      await env.LAB_STORE.put(LIVE_PLAN_SIGS_KEY, JSON.stringify({ ...sigs, [axis]: { ...(sigs[axis] || {}), [sha]: rec } }));
      console.log(`[pipeline] ${axis} live plan signed by ${address.slice(0, 10)}`);
      return json({ ok: true, signed: rec, note: "Arms nothing. The daily watcher writes this signature under the page's Sign-off. Arming is its own PR, in person." }, request);
    });
  } catch (e) {
    if (e instanceof LockBusy) return json({ error: "busy" }, request, 409);
    return json({ error: "lock_unavailable" }, request, 503);
  }
}
