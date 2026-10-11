// ── OKX fetch helper — one retry to harden the flaky CF→OKX egress ───────────
// The OKX public endpoints (tickers, trades, books, liquidation-orders, candles) occasionally
// hiccup when called from a Cloudflare Worker (shared egress), returning a non-"0" code or
// throwing — which intermittently blanked basis/CVD/order-book/liq reads in THE READ. A single
// fast retry catches the vast majority of those transients. Returns the parsed JSON (caller
// still checks `code === "0"`); on total failure returns the last response so callers fail soft.
export async function okxJson(url, tries = 2) {
  let last = { code: "err" };
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.code === "0") return j;
      last = j || last;
    } catch (e) {
      last = { code: "err", msg: String(e && e.message || e) };
    }
  }
  return last;
}

// ── okxGetAll — the hourly SNAPSHOT path's reader (2026-10-11) ───────────────────────────────
// Why it exists: basis:hist was missing 10–31% of hours (BTC least, HYPE most — loss grew with each
// coin's place in the loop) while cvd:hist, written in the same pass, had ~none. Basis = TWO ticker
// calls per coin, CVD = one trades call; okxJson retried instantly (inside OKX's 2-second rate window)
// and the snapshot dropped the failure without a word. This reader:
//   · re-fetches a GROUP of URLs together on a retry (a basis never pairs a fresh perp with a stale spot),
//   · backs off exponentially with jitter, honours Retry-After (capped), stops at a deadline,
//   · never retries what can't change (OKX 51001 = no such instrument),
//   · returns WHY it failed ({ ok:false, reason, attempts }) so the caller can log it.
// okxJson above is unchanged: the live request paths (THE READ, /intel/flow, liquidations) keep it.
// Pure + injectable (fetchImpl / sleep / random / now) so okx.test.mjs runs without the network.
export const OKX_PERMANENT_CODES = new Set(["51001"]);
const OKX_BASE_DELAY_MS = 500;
const OKX_MAX_DELAY_MS = 4000;

export function okxBackoffMs(attempt, retryAfter, random = Math.random) {
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, OKX_MAX_DELAY_MS) + Math.floor(random() * 250);
  const exp = Math.min(OKX_BASE_DELAY_MS * 2 ** attempt, OKX_MAX_DELAY_MS);
  return exp + Math.floor(random() * exp);
}

const shortErr = (e) => String((e && e.message) || e).slice(0, 80);

// One request, classified. Never throws.
export async function okxOnce(url, fetchImpl = globalThis.fetch) {
  let res, text;
  try {
    res = await fetchImpl(url);
    text = await res.text();
  } catch (e) {
    return { ok: false, retryable: true, reason: `network: ${shortErr(e)}` };
  }
  const retryAfter = res.headers?.get?.("retry-after") ?? null;
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 429) return { ok: false, retryable: true, retryAfter, reason: `HTTP 429${j?.msg ? ` ${String(j.msg).slice(0, 60)}` : ""}` };
  if (!j) return { ok: false, retryable: true, reason: `HTTP ${res.status} non-JSON` };
  if (j.code === "0") return { ok: true, json: j };
  const code = String(j.code ?? "?");
  return {
    ok: false, retryable: !OKX_PERMANENT_CODES.has(code), retryAfter,
    reason: `okx ${code}${j.msg ? ` ${String(j.msg).slice(0, 60)}` : ""} (HTTP ${res.status})`,
  };
}

export async function okxGetAll(urls, {
  tries = 4, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random, deadline = Infinity, now = Date.now,
} = {}) {
  let last = { ok: false, reason: "not attempted", attempts: 0 };
  for (let attempt = 0; attempt < tries; attempt++) {
    const rs = await Promise.all(urls.map((u) => okxOnce(u, fetchImpl)));
    if (rs.every((r) => r.ok)) return { ok: true, json: rs.map((r) => r.json), attempts: attempt + 1 };
    const bad = rs.find((r) => !r.ok);
    last = { ok: false, reason: bad.reason, attempts: attempt + 1 };
    if (rs.some((r) => !r.ok && !r.retryable)) return last;
    if (attempt === tries - 1) break;
    const wait = okxBackoffMs(attempt, bad.retryAfter, random);
    if (now() + wait > deadline) return { ...last, reason: `${last.reason} (out of time)` };
    await sleep(wait);
  }
  return last;
}

// Same one-retry hardening for Deribit (options skew / DVOL term structure) — its CF→Deribit
// egress hiccups the same way. Success = a non-empty `result` array. Returns [] on failure.
export async function deribitResult(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j && Array.isArray(j.result) && j.result.length) return j.result;
    } catch { /* retry */ }
  }
  return [];
}
