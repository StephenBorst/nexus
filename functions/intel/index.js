// Cloudflare Pages Function for /intel: the app with this page's own title, description and link card
// written into the HTML head (app/lib/routeMeta.mjs, applied by gateRoutePage in app/lib/seoGate.mjs).
// Fail open: any error serves the plain app exactly as before.
import { gateRoutePage } from "../../app/lib/seoGate.mjs";

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const loadApp = () => env.ASSETS.fetch(new Request(new URL("/", request.url)));
  try {
    return await gateRoutePage({ pathname: new URL(request.url).pathname, loadApp });
  } catch {
    try { return await loadApp(); } catch { return next(); }
  }
}
