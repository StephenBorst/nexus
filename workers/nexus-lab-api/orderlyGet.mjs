// Orderly public GETs, paced and honest about why they fail.
//
// Orderly limits public endpoints (e.g. GET /v1/public/futures) to 10 req/sec PER IP (confirmed by
// Orderly support, 2026-09-28). Worker subrequests leave from Cloudflare's shared egress IPs, so our
// own bursts stack with everyone else's on the same IP — a 14-wide Promise.all can trip it alone.
// Rules for any lab-api code that reads Orderly:
//   1. Fan-outs go through `mapLimit` (≤ ORDERLY_CONCURRENCY in flight, starts ≥ ORDERLY_GAP_MS
//      apart), never a bare Promise.all.
//   2. Reads go through `orderlyGet`: a 429 or an HTML challenge is retried with exponential backoff
//      + jitter (Retry-After honoured, capped), logged LOUDLY (`[orderly] RATE LIMITED`), and the
//      final failure throws an error that NAMES the cause (`kind`: rate_limited | challenge | http |
//      network) instead of a silent [] — the Sept 27–29 empty boards were undiagnosable because the
//      old code swallowed the status.
// Pure + injectable (fetchImpl / sleep / random) so orderlyGet.test.mjs runs without the network.

export const ORDERLY_CONCURRENCY = 3;
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 4000;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const pathOf = (url) => { try { const u = new URL(url); return u.pathname + (u.search ? "?…" : ""); } catch { return String(url).slice(0, 80); } };

// Delay before retry `attempt` (0-based): exponential, full jitter on top, Retry-After wins when
// the server sends one (still capped so a request path never hangs).
export function backoffMs(attempt, retryAfterHeader, random = Math.random) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_DELAY_MS) + Math.floor(random() * 250);
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exp + Math.floor(random() * exp);
}

export class OrderlyError extends Error {
  constructor(kind, status, path, detail) {
    super(`orderly ${kind} (HTTP ${status ?? "—"}) ${path}${detail ? `: ${detail}` : ""}`);
    this.kind = kind; this.status = status; this.path = path;
  }
}

export async function orderlyGet(url, {
  tries = 3, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random, log = console, headers = {},
} = {}) {
  const path = pathOf(url);
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res, text;
    try {
      res = await fetchImpl(url, { headers: { ...BROWSER_HEADERS, ...headers } });
      text = await res.text();
    } catch (e) {
      last = new OrderlyError("network", null, path, String(e?.message || e).slice(0, 80));
      if (attempt < tries - 1) { await sleep(backoffMs(attempt, null, random)); continue; }
      throw last;
    }
    if (res.status === 429) {
      last = new OrderlyError("rate_limited", 429, path);
      log.error(`[orderly] RATE LIMITED 429 ${path} (attempt ${attempt + 1}/${tries}, retry-after ${res.headers?.get?.("retry-after") ?? "—"}) — public limit is 10 req/s per IP`);
      if (attempt < tries - 1) { await sleep(backoffMs(attempt, res.headers?.get?.("retry-after"), random)); continue; }
      throw last;
    }
    let body;
    try { body = JSON.parse(text); }
    catch {
      // Cloudflare in front of Orderly answers bursts with an HTML page (403/503), not JSON.
      last = new OrderlyError("challenge", res.status, path, String(text).slice(0, 60).replace(/\s+/g, " "));
      log.error(`[orderly] non-JSON ${res.status} ${path} (attempt ${attempt + 1}/${tries}) — challenge page`);
      if (attempt < tries - 1) { await sleep(backoffMs(attempt, null, random)); continue; }
      throw last;
    }
    if (!res.ok) throw new OrderlyError("http", res.status, path, String(body?.message || "").slice(0, 80));
    return body;
  }
  throw last;
}

// Run `fn` over `items` with at most `limit` in flight AND starts spaced ≥ `gapMs` apart; results
// keep input order. The gap is what bounds the RATE (a fast round-trip would otherwise let even 3
// in flight exceed 10/s). Default ORDERLY_GAP_MS: an item that makes 2 reads ⇒ ≤ 8 req/s.
// Errors are fn's to handle (every caller wraps its body in try) — mapLimit never swallows them.
export const ORDERLY_GAP_MS = 250;
export async function mapLimit(items, limit, fn, { gapMs = ORDERLY_GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const out = new Array(items.length);
  let next = 0, nextStart = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const t = now(), at = Math.max(t, nextStart);
      nextStart = at + gapMs;
      if (at > t) await sleep(at - t);
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// One-line reason for a failed read, for the fail-soft payloads (`error: "futures unavailable (…)"`),
// so a curl of the public route says WHY without needing Worker logs.
export const whyFailed = (e) => (e instanceof OrderlyError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : String(e?.message || e).slice(0, 60));
