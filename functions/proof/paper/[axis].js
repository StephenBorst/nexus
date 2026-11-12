// Cloudflare Pages Function for /proof/paper/:axis: the run's live count in the HTML head (link cards,
// crawlers), a real 404 for a read with no paper wallet. Rules + tests: app/lib/seoGate.mjs
// (gatePaperRunPage) and app/lib/paperRun.mjs. Fail open: any error serves the plain app.
import { gatePaperRunPage } from "../../../app/lib/seoGate.mjs";

export async function onRequest(context) {
  const { request, params, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const loadApp = () => env.ASSETS.fetch(new Request(new URL("/", request.url)));
  try {
    return await gatePaperRunPage({ axis: params.axis, loadApp });
  } catch {
    try { return await loadApp(); } catch { return next(); }
  }
}
