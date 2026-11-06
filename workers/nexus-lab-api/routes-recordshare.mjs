// ── The record, as a share card ────────────────────────────────────────────────────
//   GET /share/record          → crawler page: OG/Twitter meta + the card image, forwards humans to /proof
//   GET /og/record(.png)       → the card (PNG; SVG without .png)
//
// Same pattern as /share/xray: X/Discord/Telegram crawlers never run the SPA's JS, so the share link points
// HERE. The card reads the SAME pulse the app strip, Lab home and landing read (readPulse, routes-pulse.mjs) and
// the SAME words as the post (recordCard, app/lib/recordShare.mjs): people and our engines counted apart, the
// cleared read's paper count. Counts only: no green/red (brand: money only). Public, read-only, writes only
// the pulse's own cache. The image URL carries a version (day + numbers) so a new week never shows last week's.
import { BRAND } from "../../app/lib/brand.mjs";
import { recordCard, recordCardVersion } from "../../app/lib/recordShare.mjs";
import { readPulse } from "./routes-pulse.mjs";

const APP = "https://trade.nexustradinglabs.com";
const OG = "https://og.nexustradinglabs.com";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 1200×630, the X-Ray card's grammar: bone on near-black, a bone top rule, mono type.
export function buildRecordCardSvg(card, { fontFamily = "'JetBrains Mono'" } = {}) {
  const { bone: BONE, bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT, border: BORDER, panel: PANEL, canvas: CANVAS, brand: MARK } = BRAND;
  const badge = card.stamp.toUpperCase();
  const badgeW = badge.length * 13 + 40;
  const colX = [48, 612];
  const cols = card.ok
    ? card.cols.map((c, i) => `
  <text x="${colX[i]}" y="214" fill="${FAINT}" font-size="16" letter-spacing="3">${esc(c.label)}</text>
  <text x="${colX[i]}" y="282" fill="${BRIGHT}" font-size="58" font-weight="bold">${esc(c.value)}</text>
  <text x="${colX[i]}" y="322" fill="${FOG}" font-size="20">${esc(String(c.sub).slice(0, 40))}</text>`).join("")
    : `
  <text x="48" y="262" fill="${BRIGHT}" font-size="44" font-weight="bold">The public record.</text>
  <text x="48" y="310" fill="${FOG}" font-size="20">Live counts are unavailable right now.</text>`;
  const signal = card.signal ? `
  <text x="48" y="420" fill="${BRIGHT}" font-size="24" font-weight="bold">${esc(card.signal.title.slice(0, 72))}</text>
  <text x="48" y="458" fill="${FOG}" font-size="19">${esc(card.signal.sub)}</text>` : card.noneCleared ? `
  <text x="48" y="420" fill="${FOG}" font-size="21">Nothing has proven itself yet. The misses stay up.</text>` : "";
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${MARK}" rx="1"/>

  <text x="48" y="86" fill="${BRIGHT}" font-size="24" font-weight="bold" letter-spacing="4">THE RECORD</text>
  <text x="48" y="112" fill="${MUTED}" font-size="15" letter-spacing="2">GRADED FROM PUBLIC PRICE · NEXUS</text>
  <rect x="${1152 - badgeW}" y="60" width="${badgeW}" height="40" fill="none" stroke="${BONE}" stroke-width="1.5" rx="6"/>
  <text x="${1152 - badgeW / 2}" y="86" fill="${BONE}" font-size="16" font-weight="bold" letter-spacing="1" text-anchor="middle">${esc(badge)}</text>

  <line x1="48" y1="150" x2="1152" y2="150" stroke="${BORDER}" stroke-width="1"/>
  ${cols}
  <line x1="48" y1="370" x2="1152" y2="370" stroke="${BORDER}" stroke-width="1"/>
  ${signal}

  <line x1="48" y1="556" x2="1152" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="590" fill="${MUTED}" font-size="15">Every call graded from public price. Losses stay up.</text>
  <text x="1152" y="590" fill="${FAINT}" font-size="14" text-anchor="end">verify → trade.nexustradinglabs.com/proof</text>
</svg>`;
}

function shareHtml(card, version) {
  const appUrl = `${APP}/proof`;
  const img = `${OG}/og/record.png?v=${encodeURIComponent(version)}`;
  const title = esc(`The record · ${card.stamp}`);
  const desc = esc(card.ok
    ? `${card.cols.map((c) => `${c.label === "PEOPLE" ? "People" : "Our engines"}: ${c.value} · ${c.sub}`).join(". ")}.${card.signal ? ` ${card.signal.title}. ${card.signal.sub}` : ""}`
    : "Every call graded from public price. Losses stay up.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${OG}/share/record">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nexus Trading Labs">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${appUrl}">
<script>location.replace(${JSON.stringify(appUrl)})</script>
</head><body style="background:#0a0a0b;color:#a1a1aa;font-family:monospace;padding:40px">
Opening the record… <a style="color:#ededf0" href="${appUrl}">view on Nexus →</a>
</body></html>`;
}

async function loadCard(env, deps, now) {
  let pulse = null;
  try { pulse = await (deps.readPulse || readPulse)(env, { scorecardKey: deps.scorecardKey }); } catch { pulse = null; }
  return { card: recordCard(pulse, now), version: recordCardVersion(pulse, now) };
}

// deps.renderPng(svg) → Uint8Array (index.js supplies resvg + the mono font).
export async function handleRecordShare(parts, request, env, deps = {}) {
  const isShare = parts[0] === "share" && parts[1] === "record" && parts.length === 2;
  const isOg = parts[0] === "og" && (parts[1] === "record" || parts[1] === "record.png") && parts.length === 2;
  if (!isShare && !isOg) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const now = deps.now ?? Date.now();

  if (isShare) {
    const { card, version } = await loadCard(env, deps, now);
    return new Response(shareHtml(card, version), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", "Access-Control-Allow-Origin": "*" },
    });
  }

  const isPng = parts[1] === "record.png";
  const url = new URL(request.url);
  const versioned = url.searchParams.has("v");
  const cache = deps.cache ?? (typeof caches !== "undefined" ? caches.default : null);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (isPng && versioned && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const { card } = await loadCard(env, deps, now);
  if (isPng && deps.renderPng) {
    try {
      const png = await deps.renderPng(buildRecordCardSvg(card));
      const res = new Response(png, {
        headers: { "Content-Type": "image/png", "Cache-Control": versioned ? "public, max-age=86400" : "public, max-age=300", "Access-Control-Allow-Origin": "*" },
      });
      if (versioned && cache) await cache.put(cacheKey, res.clone());
      return res;
    } catch (e) {
      console.error("[og record PNG] failed, falling back to SVG:", String(e));
    }
  }
  return new Response(buildRecordCardSvg(card), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
