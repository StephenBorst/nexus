// ── /pipeline/judgment/:axis — the drafted 30-trade judgment page, and the owner's wallet signature on it ──────
// Rules: app/lib/paperJudgePage.mjs. A page exists for a read whose paper wallet was registered through
// /pipeline/paper-wallet (paperClaim.mjs) and that has no PAPER_JUDGMENTS entry in the code yet. The page is
// rendered from the claim, so it is the same text every time and its sha256 is what the owner signs.
//   GET  /pipeline/judgment/:axis      → { axis, page, sha256, signed: record|null } (public); 404 = no draft
//   POST /pipeline/judgment/:axis/sign { address, ts, sig, sha256 } → a treasury Safe owner or an OPS_WALLETS
//        address signing judgmentSignMessage(address, axis, sha256, ts) within 5 minutes, over the page as served,
//        before trade 30. Stored once, never rewritten. The daily watcher writes page + signature into the repo.
import { json, recoverEthAddress } from "./shared.mjs";
import { isRevenueViewer } from "./revenue.mjs";
import { ownersOf } from "./routes-revenue.mjs";
import { withLock, LOCK_KEYS, LockBusy } from "./lock.mjs";
import { readPaperClaims } from "./routes-paperclaim.mjs";
import { CLAIM_SIG_MAX_AGE_MS, CLAIM_SIG_SKEW_MS } from "../../app/lib/paperClaim.mjs";
import { renderJudgmentPage, pageAboveResults, judgmentSignMessage } from "../../app/lib/paperJudgePage.mjs";
import { PAPER_JUDGMENTS } from "../../app/lib/paperJudge.mjs";
import { PAPER_MIN_TRADES } from "../../app/lib/readPipeline.mjs";

export const JUDGMENT_SIGS_KEY = "pipeline:judgsigs:v1"; // LAB_STORE: { [axis]: signature record }

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readJudgmentSigs(env) {
  try {
    const o = JSON.parse((await env.LAB_STORE.get(JUDGMENT_SIGS_KEY)) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch { return {}; }
}

/** The draft for a read: its claim, page and hash; null = no draft (no claim, or the code already judges it). */
export async function judgmentDraft(env, axis, { judgments = PAPER_JUDGMENTS, setups } = {}) {
  if (judgments[axis]) return null;
  const claim = (await readPaperClaims(env))[axis];
  if (!claim) return null;
  const page = setups ? renderJudgmentPage(claim, setups) : renderJudgmentPage(claim);
  const above = pageAboveResults(page);
  if (!above) return null;
  return { claim, page, sha256: await sha256Hex(above) };
}

export async function handleJudgeSign(parts, request, env, { now = Date.now, fetchImpl = globalThis.fetch, lock = withLock, judgments, setups } = {}) {
  const deps = { ...(judgments ? { judgments } : {}), ...(setups ? { setups } : {}) };
  if (!(parts[0] === "pipeline" && parts[1] === "judgment" && parts[2])) return null;
  const axis = String(parts[2]).slice(0, 64);
  const isSign = parts[3] === "sign" && parts.length === 4;
  if (!isSign && parts.length !== 3) return null;
  if (!env.LAB_STORE || !env.NEXUS_AGENT) return json({ error: "store_unbound" }, request, 503);

  if (!isSign) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, request, 405);
    const d = await judgmentDraft(env, axis, deps);
    if (!d) return json({ error: "no_draft", axis }, request, 404);
    return json({ axis, page: d.page, sha256: d.sha256, signed: (await readJudgmentSigs(env))[axis] || null }, request);
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

  try {
    return await lock(env, LOCK_KEYS.judgeSigs(), async () => {
      const d = await judgmentDraft(env, axis, deps);
      if (!d) return json({ error: "no_draft", axis }, request, 404);
      // The signature must be over THIS page: a page that changed under the owner's eyes is refused.
      if (String(body.sha256 || "").toLowerCase() !== d.sha256) return json({ error: "page_changed", sha256: d.sha256 }, request, 409);
      let signer = null;
      try { signer = recoverEthAddress(judgmentSignMessage(address, axis, d.sha256, ts), body.sig); } catch { signer = null; }
      if (!signer || String(signer).toLowerCase() !== address) return json({ error: "bad_signature" }, request, 401);
      const owners = await ownersOf(env, fetchImpl);
      if (!isRevenueViewer(address, owners, env.OPS_WALLETS)) {
        return json({ error: "not_allowed", hint: "Only a treasury Safe owner (or an OPS_WALLETS address) can sign.", ownersRead: owners.length > 0 }, request, 403);
      }
      const sigs = await readJudgmentSigs(env);
      if (sigs[axis]) return json({ error: "already_signed", signed: sigs[axis] }, request, 409);
      let trades = null;
      try { trades = Number(JSON.parse((await env.NEXUS_AGENT.get(`agent:state:${d.claim.wallet}`)) || "{}")?.paper_agg?.trades) || 0; } catch { trades = null; }
      if (trades == null) return json({ error: "record_unread" }, request, 503);
      // Signing after the 30th trade would be signing a result: refused.
      if (trades >= PAPER_MIN_TRADES) return json({ error: "too_late", detail: `${trades} trades closed` }, request, 409);
      const rec = { axis, by: address, at: new Date(at).toISOString(), sigTs: ts, sig: body.sig, pageSha256: d.sha256, tradesAtSigning: trades };
      await env.LAB_STORE.put(JUDGMENT_SIGS_KEY, JSON.stringify({ ...sigs, [axis]: rec }));
      console.log(`[pipeline] ${axis} judgment signed by ${address.slice(0, 10)} at ${trades} trades`);
      return json({ ok: true, signed: rec, note: "The daily watcher writes the page and this signature into the repo; the judge then treats a PASS or FAIL at trade 30 as final." }, request);
    });
  } catch (e) {
    if (e instanceof LockBusy) return json({ error: "busy" }, request, 409);
    return json({ error: "lock_unavailable" }, request, 503);
  }
}
