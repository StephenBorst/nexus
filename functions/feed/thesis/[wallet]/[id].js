// Cloudflare Pages Function: a call permalink that doesn't exist answers 404, not a 200 app
// shell (Search Console Soft 404). Rules + tests: app/lib/seoGate.mjs. Only this path runs a
// Function (file-based routing), so static assets never invoke one.
import { gateThesisPage } from "../../../../app/lib/seoGate.mjs";

export async function onRequest(context) {
  const { request, params, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const loadApp = () => env.ASSETS.fetch(new Request(new URL("/", request.url)));
  try {
    return await gateThesisPage({ wallet: params.wallet, id: params.id, loadApp });
  } catch {
    return loadApp();
  }
}
