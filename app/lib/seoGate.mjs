// What a crawler gets for a call permalink (/feed/thesis/:wallet/:id), decided at the edge.
//
// The site is a single-page app: every path serves the same index.html with a 200, so a
// call that doesn't exist (or isn't public) came back as a 200 app shell with nothing in it,
// and Google flagged it as a Soft 404 (Search Console, first seen 2026-10-19). The Pages
// Function at functions/feed/thesis/[wallet]/[id].js asks lab-api whether the call is public
// (GET /thesis/:w/:id/meta, the same isPublicCall rule the page and the share card use) and
// turns a definite "not found" into a real 404 + noindex. People still see the page's own
// "This call isn't public, or doesn't exist." screen: the body is the same app.
//
// Fail OPEN: only a 404 from lab-api means missing. A timeout, a 5xx, a 405 or a network error
// serves the page exactly as before (no injected tags).

import { injectCallMeta } from "./callPageMeta.mjs";

export const LAB_API = "https://og.nexustradinglabs.com";
export const LOOKUP_TIMEOUT_MS = 2500;

export function thesisLookupUrl(wallet, id) {
  const w = String(wallet || "").trim();
  const i = String(id || "").trim();
  if (!w || !i || w.length > 100 || i.length > 200) return null;
  return `${LAB_API}/thesis/${encodeURIComponent(w)}/${encodeURIComponent(i)}/meta`;
}

// lab-api status → "found" | "missing" | "unknown".
export function lookupVerdict(status) {
  if (status === 404) return "missing";
  if (status >= 200 && status < 300) return "found";
  return "unknown";
}

// The same body (the app), with the status a crawler should see. HTML always revalidates
// (Function responses don't get public/_headers, so set it here).
export function withStatus(res, status, { noindex = false } = {}) {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-cache");
  if (noindex) headers.set("X-Robots-Tag", "noindex");
  return new Response(res.body, { status, statusText: status === 404 ? "Not Found" : res.statusText, headers });
}

// The whole decision, with fetch injected so it's testable without the network. `loadApp`
// returns the app's HTML (the Function asks the static assets for "/"): with public/404.html in
// place, an unmatched asset path would answer 404, so the Function never relies on the fallback.
// Found → the call's own title / description / grade go into the HTML (callPageMeta.mjs), so a
// search engine reads the call, not the site blurb. A reply without a `meta` (an older lab-api) or
// any failure serves the page exactly as before.
export async function gateThesisPage({ wallet, id, loadApp, fetchImpl = fetch, timeoutMs = LOOKUP_TIMEOUT_MS }) {
  const page = await loadApp();
  const url = thesisLookupUrl(wallet, id);
  if (!url) return withStatus(page, 404, { noindex: true });
  let meta = null;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (lookupVerdict(r.status) === "missing") return withStatus(page, 404, { noindex: true });
    if (lookupVerdict(r.status) === "found") meta = (await r.json())?.meta || null;
  } catch { /* fail open */ }
  if (!meta || typeof meta.title !== "string") return withStatus(page, 200);
  let html;
  try { html = await page.text(); } catch { return withStatus(page, 200); }
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(injectCallMeta(html, meta), { status: 200, headers });
}
