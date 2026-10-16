// ── Who is acting, and who gets told ──────────────────────────────────────────────────────
// Comments, reactions, takes, follows and the notification list used to take the acting wallet
// from the request (a `wallet` field, or the URL) with no proof, so anyone could post, react,
// follow or delete as any address, and clear anyone's notifications. Now every one of those
// writes carries `labAuth` in the JSON body, the same signature the Lab saves need
// (app/lib/labAuth.mjs): one signature a day covers the wallet's Lab and its social actions.
//
// The notifications these writes send ("New comment on your BTC LONG call") used to name the
// call's author, symbol and side from the request too, so a caller could aim one at any wallet.
// Now the server reads the author from the stored call or take; the request only says where to look.
import { json, checkLabAuth } from "./shared.mjs";
import { isPublicCall } from "./routes-verify.mjs";

/**
 * Does `labAuth` prove the caller is `claimed`? `claimed` = the wallet the request acts as (a body
 * field or the URL). Returns { ok, wallet } (lowercased, as the stores key it) or { ok:false, reason }.
 */
export function provenWallet(claimed, labAuth, now = Date.now()) {
  const wallet = typeof claimed === "string" ? claimed.trim().toLowerCase() : "";
  if (!wallet) return { ok: false, reason: "missing_wallet" };
  const v = checkLabAuth(wallet, labAuth, now);
  return v.ok ? { ok: true, wallet } : { ok: false, reason: v.reason };
}

/** The 401 every unsigned social write gets. Nothing has happened when this is sent. */
export const unsignedSocial = (request, v) => json({
  error: "sign_to_save",
  reason: v.reason,
  hint: "Sign the Nexus Lab message with this wallet and send it as body.labAuth.",
}, request, 401);

const CHAIN_RE = /^[a-z0-9-]{1,24}$/;
const CA_RE = /^[a-zA-Z0-9]{1,64}$/;

/**
 * The author of the call or take `id`, read from storage, or null when it can't be proven.
 *  • A take: the request names its token (`take: { chain, ca }`); the take must be in that list.
 *  • A call: the request names the author's wallet (`authorWallet`); that wallet's record must hold
 *    a PUBLIC call with this id (not private, not holders-only, not a copy of someone else's).
 * Returns { wallet, label } where label is "BTC LONG call" / "PEPE BULL take", from the stored row.
 */
export async function verifiedAuthor(env, id, body) {
  const take = body?.take;
  if (take && typeof take === "object") {
    const chain = String(take.chain || "").toLowerCase();
    const ca = String(take.ca || "").trim();
    if (!CHAIN_RE.test(chain) || !CA_RE.test(ca)) return null;
    let list = [];
    try { list = JSON.parse((await env.LAB_STORE.get(`takes:${chain}:${ca}`)) || "[]"); } catch { return null; }
    const t = Array.isArray(list) ? list.find((x) => x && x.id === id) : null;
    if (!t || typeof t.wallet !== "string") return null;
    const sym = typeof t.sym === "string" && t.sym ? `${t.sym} ` : "";
    return { wallet: t.wallet.toLowerCase(), label: `${sym}${t.direction === "BEAR" ? "BEAR" : "BULL"} take` };
  }
  const author = typeof body?.authorWallet === "string" ? body.authorWallet.trim().toLowerCase() : "";
  if (!author) return null;
  let rec = null;
  try { rec = JSON.parse((await env.LAB_STORE.get(`lab:${author}`)) || "null"); } catch { return null; }
  const call = Array.isArray(rec?.theses) ? rec.theses.find((t) => t && t.id === id) : null;
  if (!isPublicCall(call)) return null;
  const sym = String(call.symbol || "").replace("PERP_", "").replace("_USDC", "");
  const dir = call.direction === "LONG" || call.direction === "SHORT" ? ` ${call.direction}` : "";
  return { wallet: author, label: sym ? `${sym}${dir} call` : "call" };
}
