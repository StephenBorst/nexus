// Cloudflare Pages Function for /analyze: the app with this page's own title, description and link card
// written into the HTML head (app/lib/routeMeta.mjs), and the boot screen swapped for the X-Ray frame (the header +
// the linked wallet's "analyzing" block, app/lib/xraySnapshot.mjs), so a shared link shows at once.
// gateAnalyzePage in app/lib/seoGate.mjs. Fail open: any error serves the plain app exactly as before.
import { gateAnalyzePage } from "../../app/lib/seoGate.mjs";

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const loadApp = () => env.ASSETS.fetch(new Request(new URL("/", request.url)));
  try {
    const url = new URL(request.url);
    return await gateAnalyzePage({ pathname: url.pathname, search: url.search, loadApp });
  } catch {
    try { return await loadApp(); } catch { return next(); }
  }
}
