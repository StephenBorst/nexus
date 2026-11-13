// Cloudflare Pages Function for /proof: the app with this page's own title, description and link card
// written into the HTML head (app/lib/routeMeta.mjs), and the boot screen swapped for a static copy of the
// page's header from GET /calls/pulse (app/lib/proofSnapshot.mjs), so the headline shows before the app boots.
// gateProofPage in app/lib/seoGate.mjs. Fail open: any error serves the plain app exactly as before.
import { gateProofPage } from "../../app/lib/seoGate.mjs";

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const loadApp = () => env.ASSETS.fetch(new Request(new URL("/", request.url)));
  try {
    return await gateProofPage({ pathname: new URL(request.url).pathname, loadApp });
  } catch {
    try { return await loadApp(); } catch { return next(); }
  }
}
