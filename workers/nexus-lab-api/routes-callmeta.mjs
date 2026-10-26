// ── GET /thesis/:wallet/:id/meta — what the call's page tells a search engine ─────────────────────────
// Asked by the site's Pages Function (functions/feed/thesis/[wallet]/[id].js) on every load of a call
// permalink: 404 → the page answers 404 + noindex; 200 → the model (app/lib/callPageMeta.mjs) goes into
// the HTML head. Public calls only (isPublicCall: public, not holders-only, not a duplicate copy), same
// rule as the share card and the permalink. Built from the STORED call: a grade shows only when the
// current grader stamped it (isCurrentStamp), and nothing here reads candles, so a page load never
// costs an Orderly request.
import { normalizeAddress } from "./shared.mjs";
import { isCurrentStamp } from "./grading.mjs";
import { isPublicCall } from "./routes-verify.mjs";
import { callPageMeta } from "../../app/lib/callPageMeta.mjs";

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=300" : "public, max-age=60", "Access-Control-Allow-Origin": "*" },
});

export async function handleCallMeta(parts, request, env) {
  if (!(parts[0] === "thesis" && parts[1] && parts[2] && parts[3] === "meta" && parts.length === 4)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const wallet = normalizeAddress(parts[1]);
  const id = parts[2];
  const [raw, profileRaw] = await Promise.all([env.LAB_STORE.get(`lab:${wallet}`), env.LAB_STORE.get(`profile:${wallet}`)]);
  if (!raw) return reply({ error: "not found" }, 404);
  let data; try { data = JSON.parse(raw); } catch { return reply({ error: "not found" }, 404); }
  const t = (data.theses || []).find((x) => x && x.id === id);
  if (!isPublicCall(t)) return reply({ error: "not found" }, 404);
  let profile = {}; try { profile = profileRaw ? JSON.parse(profileRaw) : {}; } catch { /* none */ }
  const graded = isCurrentStamp(t) && typeof t.gradedR === "number" ? { outcome: t.gradedOutcome, r: t.gradedR } : null;
  return reply({ meta: callPageMeta(t, { wallet, id, displayName: profile.displayName || null, graded }) });
}
