// ── A fired price alert, as a share card ─────────────────────────────────────────────────────────────────────────
//   GET /share/alert?c=BTC&l=60000&d=above&t=<ms>   → crawler page (OG/Twitter meta + the card), forwards humans to the coin
//   GET /og/alert(.png)?same                         → the card (PNG; SVG without .png)
// The link carries numbers anyone could edit, so the card trusts none of them: it reads Orderly's public 1-minute bars
// around `t` itself and draws "traded above $60,000" ONLY if a bar there did (priceAlerts.mjs verifyCross). Otherwise
// it says the cross isn't on the tape. The chart = 15-minute closes from 18h before to 6h after, the level as a line,
// the crossing minute as a dot. Bone on black, no green/red (a level is not money). A verified result is immutable,
// so it's kept in KV (`palert:share:*`) and the PNG in the edge cache. Public, read-only.
import { BRAND } from "../../app/lib/brand.mjs";
import { parseShare, verifyCross } from "../../app/lib/priceAlerts.mjs";
import { readBars } from "./alertBars.mjs";

const APP = "https://trade.nexustradinglabs.com";
const OG = "https://og.nexustradinglabs.com";
const H = 3600_000, MIN = 60_000;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const dp = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
const when = (t) => {
  const d = new Date(t);
  return `${d.toISOString().slice(11, 16)} UTC · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
};

/** What the card says: verified, not on the tape, or unreadable. Pure. */
export function alertCard(share, check, series) {
  if (!share) return { ok: false, title: "Not a valid alert link.", sub: "Nothing to check.", series: [] };
  const word = share.dir === "above" ? "above" : "below";
  if (check?.ok) {
    return { ok: true, title: `${share.coin} traded ${word} ${money(share.level)}`,
      sub: `${when(share.t)} · ${share.dir === "above" ? "high" : "low"} ${money(check.px)}`, series: series || [], share };
  }
  if (check?.why === "not_traded") {
    return { ok: false, title: `${share.coin} didn’t trade ${word} ${money(share.level)} then`, sub: `Orderly’s 1-minute bars at ${when(share.t)} don’t show it.`, series: series || [], share };
  }
  return { ok: false, title: `Couldn’t check ${share.coin} right now`, sub: "Orderly’s bars didn’t load. Try the link again later.", series: [], share };
}

export function buildAlertCardSvg(card, { fontFamily = "'JetBrains Mono'" } = {}) {
  const { bone: BONE, bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT, border: BORDER, panel: PANEL, canvas: CANVAS, brand: MARK } = BRAND;
  const X0 = 48, X1 = 1152, Y0 = 200, Y1 = 500;
  let chart = "";
  const pts = (card.series || []).filter((p) => Number.isFinite(p.t) && p.c > 0);
  if (pts.length >= 2 && card.share) {
    const lv = card.share.level;
    const vals = [...pts.map((p) => p.c), lv];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.1 || hi * 0.01;
    lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = (t1 - t0) || 1;
    const X = (t) => X0 + ((t - t0) / span) * (X1 - X0 - 170);
    const Y = (v) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
    const line = pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`).join(" ");
    const ly = Y(lv);
    const dot = card.ok && card.share.t >= t0 && card.share.t <= t1
      ? `<circle cx="${X(card.share.t).toFixed(1)}" cy="${ly.toFixed(1)}" r="9" fill="${CANVAS}" stroke="${BONE}" stroke-width="3"/>` : "";
    chart = `
  <line x1="${X0}" y1="${ly.toFixed(1)}" x2="${X1 - 170}" y2="${ly.toFixed(1)}" stroke="${FOG}" stroke-width="2" stroke-dasharray="8 6"/>
  <text x="${X1 - 160}" y="${(ly + 6).toFixed(1)}" fill="${FOG}" font-size="20">alert ${esc(money(lv))}</text>
  <polyline points="${line}" fill="none" stroke="${BRIGHT}" stroke-width="3" stroke-linejoin="round"/>
  ${dot}
  <text x="${X0}" y="${Y1 + 34}" fill="${FAINT}" font-size="15">15-minute closes · 18h before to 6h after · UTC</text>`;
  }
  const badge = card.ok ? "ON THE TAPE" : "NOT VERIFIED";
  const badgeW = badge.length * 13 + 40;
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${MARK}" rx="1"/>
  <text x="48" y="80" fill="${MUTED}" font-size="15" letter-spacing="3">PRICE ALERT · NEXUS</text>
  <rect x="${1152 - badgeW}" y="54" width="${badgeW}" height="38" fill="none" stroke="${card.ok ? BONE : FAINT}" stroke-width="1.5" rx="6"/>
  <text x="${1152 - badgeW / 2}" y="79" fill="${card.ok ? BONE : FOG}" font-size="15" font-weight="bold" letter-spacing="1" text-anchor="middle">${badge}</text>
  <text x="48" y="136" fill="${BRIGHT}" font-size="40" font-weight="bold">${esc(card.title.slice(0, 48))}</text>
  <text x="48" y="172" fill="${FOG}" font-size="20">${esc(card.sub.slice(0, 80))}</text>
  ${chart}
  <line x1="48" y1="560" x2="1152" y2="560" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="592" fill="${MUTED}" font-size="15">Checked against Orderly’s public 1-minute bars. Not advice.</text>
  <text x="1152" y="592" fill="${FAINT}" font-size="14" text-anchor="end">trade.nexustradinglabs.com</text>
</svg>`;
}

const shareKey = (s) => `palert:share:${s.coin}:${s.level}:${s.dir}:${s.t}`;

async function loadCard(env, q, deps) {
  const share = parseShare(q);
  if (!share) return alertCard(null);
  const kv = env.LAB_STORE;
  const getBars = deps.readBars || readBars;
  let check = null;
  try { const hit = await kv.get(shareKey(share)); if (hit) check = JSON.parse(hit); } catch { /* re-check */ }
  if (!check) {
    const minute = await getBars(share.coin, share.t - 2 * MIN, share.t + 2 * MIN, 1);
    check = verifyCross(share, minute);
    if (check.ok) { try { await kv.put(shareKey(share), JSON.stringify(check)); } catch { /* best-effort */ } }
  }
  if (check.why === "unread" || check.why === "bad_link") return alertCard(share, check);
  const now = deps.now ?? Date.now();
  const series = await getBars(share.coin, share.t - 18 * H, Math.min(now, share.t + 6 * H), 15);
  return alertCard(share, check, series);
}

function shareHtml(card, qs) {
  const coin = card.share?.coin;
  const appUrl = coin ? `${APP}/lab?tab=intel&market=${encodeURIComponent(coin)}` : `${APP}/lab`;
  const img = esc(`${OG}/og/alert.png?${qs}`); // escaped once: it sits inside HTML attributes
  const title = esc(card.title), desc = esc(`${card.sub} Checked against Orderly’s public 1-minute bars.`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nexus Trading Labs">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)})</script>
</head><body style="background:#0a0a0b;color:#a1a1aa;font-family:monospace;padding:40px">
Opening Nexus… <a style="color:#ededf0" href="${esc(appUrl)}">view on Nexus →</a>
</body></html>`;
}

// deps.renderPng(svg) → Uint8Array (index.js supplies resvg + the mono font).
export async function handleAlertShare(parts, request, env, deps = {}) {
  const isShare = parts[0] === "share" && parts[1] === "alert" && parts.length === 2;
  const isOg = parts[0] === "og" && (parts[1] === "alert" || parts[1] === "alert.png") && parts.length === 2;
  if (!isShare && !isOg) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams);
  const qs = new URLSearchParams({ c: q.c || "", l: q.l || "", d: q.d || "", t: q.t || "" }).toString();
  if (isShare) {
    const card = await loadCard(env, q, deps);
    return new Response(shareHtml(card, qs), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  }
  const cache = deps.cache ?? (typeof caches !== "undefined" ? caches.default : null);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }
  const card = await loadCard(env, q, deps);
  const maxAge = card.ok ? 86400 : 300;
  if (parts[1] === "alert.png" && deps.renderPng) {
    try {
      const res = new Response(await deps.renderPng(buildAlertCardSvg(card)), {
        headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*" },
      });
      if (card.ok && cache) await cache.put(cacheKey, res.clone());
      return res;
    } catch (e) { console.error("[og alert PNG] failed, falling back to SVG:", String(e)); }
  }
  return new Response(buildAlertCardSvg(card), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*" } });
}
