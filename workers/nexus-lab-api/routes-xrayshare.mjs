// ── Wallet X-Ray share links ─────────────────────────────────────────────────
//   GET /share/xray/:address       → crawler-friendly page: real OG/Twitter meta + the
//                                     card image, then forwards humans to /analyze
//   GET /og/xray/:address(.png)    → the verdict card (PNG; SVG without .png)
//
// Same pattern as /share/thesis + /share/identity: the SPA's meta tags are injected by
// JS, which X/Discord/Telegram crawlers never run, so share links point HERE.
//
// The card content comes from app/lib/xrayCard.mjs, graded with the SAME code the page
// uses (xrayGrade.mjs) on the SAME stored tape (routes-hltape.mjs) — the card can't
// disagree with the page it links to. The image URL carries a version (newest fill +
// counts) so a re-share after new fills gets a fresh image; X caches image URLs for days.
import { makeRateLimiter } from "./keyProxy.mjs";
import { readTape, syncHlTape } from "./routes-hltape.mjs";
import { readXrayHist } from "./routes-smart.mjs";
import { xrayTrack } from "./logic.mjs";
import { expandFill } from "../../app/lib/hlTape.mjs";
import { fillsToClosedTrades } from "../../app/lib/xrayGrade.mjs";
import { xrayCard, cardVersion } from "../../app/lib/xrayCard.mjs";

const APP = "https://trade.nexustradinglabs.com";
const OG = "https://og.nexustradinglabs.com";
const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(s || "");

// A share link to a wallet nobody has opened yet has no stored tape. Seeding it calls
// Hyperliquid, so crawlers get their own small per-IP budget; over it, the card renders
// from whatever is stored (possibly the honest "no record yet" card).
const seedLimiter = makeRateLimiter({ limit: 10, windowMs: 60000 });

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function loadCardInputs(env, address, { hlInfo, now = Date.now(), ip = "unknown", limiter = seedLimiter } = {}) {
  const addr = address.toLowerCase();
  let tape = await readTape(env, addr);
  if (!tape && !limiter(ip, now)) {
    try { tape = (await syncHlTape(env, addr, { hlInfo, now })).record; } catch { tape = null; }
  }
  let track = null;
  try {
    const hist = await readXrayHist(env, addr);
    if (hist.length) track = xrayTrack(hist);
  } catch { /* no watched record */ }
  const fills = tape ? tape.fills.map(expandFill) : [];
  const trades = fillsToClosedTrades(fills);
  const card = xrayCard({ address: addr, trades, completeFrom: tape ? tape.completeFrom : null, track, now });
  const version = cardVersion({
    newestFillTs: fills.length ? fills[fills.length - 1].time : null,
    fillCount: fills.length,
    trackPoints: track ? track.points || 0 : 0,
  });
  return { card, version };
}

// 1200×630, same grammar as the identity/thesis cards: bone on near-black, green/red
// ONLY on numbers that mean profit/loss, hairline borders, JetBrains Mono.
export function buildXrayCardSvg(card, { fontFamily = "'JetBrains Mono'" } = {}) {
  const BONE = "#ededf0", BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b";
  const POS = "#3ecf8e", NEG = "#f7525f", WARN = "#fbbf24", BORDER = "#232327", PANEL = "#0f0f11";
  const toneColor = (t) => (t === "pos" ? POS : t === "neg" ? NEG : BRIGHT);
  const badge = card.status === "GRADED" ? (card.kind === "WATCHED" ? "WATCHED RECORD" : "30D GRADE")
    : card.status === "ACCRUING" ? "ACCRUING" : "NO RECORD";
  const badgeW = badge.length * 13 + 40;
  const hSize = Math.min(60, Math.floor(1090 / (Math.max(card.headline.length, 1) * 0.6)));
  const colX = [48, 330, 612, 894];
  const stats = card.stats.map((s, i) => `
  <text x="${colX[i]}" y="420" fill="${FAINT}" font-size="15" letter-spacing="2">${esc(s.label)}</text>
  <text x="${colX[i]}" y="472" fill="${toneColor(s.tone)}" font-size="40" font-weight="bold">${esc(s.value)}</text>`).join("");
  const context = esc(String(card.context).slice(0, 96));
  const partial = card.partialNote
    ? `<text x="48" y="520" fill="${WARN}" font-size="15">${esc(card.partialNote)}</text>` : "";
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="#0a0a0b"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${BONE}" rx="10" opacity="0.5"/>

  <text x="48" y="86" fill="${BRIGHT}" font-size="24" font-weight="bold" letter-spacing="4">WALLET X-RAY</text>
  <text x="48" y="112" fill="${MUTED}" font-size="15" letter-spacing="2">${esc(card.who)} · PUBLIC DATA · NEXUS</text>
  <rect x="${1152 - badgeW}" y="60" width="${badgeW}" height="40" fill="none" stroke="${BONE}" stroke-width="1.5" rx="6"/>
  <text x="${1152 - badgeW / 2}" y="86" fill="${BONE}" font-size="16" font-weight="bold" letter-spacing="1" text-anchor="middle">${esc(badge)}</text>

  <line x1="48" y1="150" x2="1152" y2="150" stroke="${BORDER}" stroke-width="1"/>

  <text x="48" y="250" fill="${toneColor(card.headlineTone)}" font-size="${hSize}" font-weight="bold">${esc(card.headline)}</text>
  <text x="48" y="300" fill="${FOG}" font-size="19">${context}</text>

  <line x1="48" y1="348" x2="1152" y2="348" stroke="${BORDER}" stroke-width="1"/>
  ${stats}
  ${partial}

  <line x1="48" y1="556" x2="1152" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="590" fill="${MUTED}" font-size="15">graded by Nexus X-Ray · ${esc(card.stamp)}</text>
  <text x="1152" y="590" fill="${FAINT}" font-size="14" text-anchor="end">verify → trade.nexustradinglabs.com/analyze</text>
</svg>`;
}

function shareHtml(card, version) {
  const addr = card.address;
  const appUrl = `${APP}/analyze?address=${addr}`;
  const img = `${OG}/og/xray/${addr}.png?v=${encodeURIComponent(version)}`;
  const shareUrl = `${OG}/share/xray/${addr}`;
  const title = esc(card.title);
  const desc = esc(card.description);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${shareUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nexus Trading Labs">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${appUrl}">
<script>location.replace(${JSON.stringify(appUrl)})</script>
</head><body style="background:#0a0a0b;color:#a1a1aa;font-family:monospace;padding:40px">
Opening the x-ray… <a style="color:#ededf0" href="${appUrl}">view on Nexus →</a>
</body></html>`;
}

// deps.renderPng(svg) → Uint8Array (index.js supplies resvg + the mono font).
export async function handleXrayShare(parts, request, env, deps = {}) {
  const isShare = parts[0] === "share" && parts[1] === "xray" && parts[2];
  const isOg = parts[0] === "og" && parts[1] === "xray" && parts[2];
  if (!isShare && !isOg) return null;
  return serveXrayShare(parts, request, env, deps, { isShare, isOg });
}

async function serveXrayShare(parts, request, env, deps, { isShare, isOg }) {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

  const isPng = isOg && parts[2].endsWith(".png");
  const raw = isPng ? parts[2].slice(0, -4) : parts[2];
  if (!isAddr(raw)) return new Response("valid 0x address required", { status: 400 });
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = deps.now ?? Date.now();

  if (isShare) {
    const { card, version } = await loadCardInputs(env, raw, { hlInfo: deps.hlInfo, now, ip, limiter: deps.limiter });
    return new Response(shareHtml(card, version), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Versioned image URLs are immutable → cache them long at the edge; an unversioned
  // request (someone pasting the bare URL) stays short-lived.
  const url = new URL(request.url);
  const versioned = url.searchParams.has("v");
  const cache = deps.cache ?? (typeof caches !== "undefined" ? caches.default : null);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (isPng && versioned && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Response(hit.body, hit);
      h.headers.set("X-Card-Cache", "hit");
      return h;
    }
  }
  const { card } = await loadCardInputs(env, raw, { hlInfo: deps.hlInfo, now, ip, limiter: deps.limiter });
  if (isPng && deps.renderPng) {
    try {
      const png = await deps.renderPng(buildXrayCardSvg(card, { fontFamily: "'JetBrains Mono'" }));
      const res = new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": versioned ? "public, max-age=86400" : "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
          "X-Card-Cache": "miss",
        },
      });
      if (versioned && cache) await cache.put(cacheKey, res.clone());
      return res;
    } catch (e) {
      console.error("[og xray PNG] failed, falling back to SVG:", String(e));
    }
  }
  return new Response(buildXrayCardSvg(card), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
