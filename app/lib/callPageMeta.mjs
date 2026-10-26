// What a search engine reads for a call permalink (/feed/thesis/:wallet/:id), before any script runs.
//
// The page is the app's shell until JavaScript paints it, so every published call looked the same to a
// crawler: "Nexus Trading Labs" and the site blurb. The Pages Function at
// functions/feed/thesis/[wallet]/[id].js asks lab-api for this model (GET /thesis/:w/:id/meta, which
// builds it from the STORED call) and writes it into the HTML head plus a <noscript> summary, so each
// call is its own result: market, side, who, the levels, and the grade.
//
// Rules (same as the cards, so a search result never says more than the page):
//   - a grade shows only when the current grader stamped it (lab-api passes `graded`); otherwise the
//     call's lifecycle (callLifecycle.mjs): awaiting fill, open, fill not checked, or not graded + why.
//   - R:R from the levels (callRR), never the stored riskReward.
//   - a split whose runner was stopped says so (splitRunnerStopped).
//   - plain words, numbers, no adjectives (marketing/VOICE.md).

import { callRR, splitRunnerStopped, callInvalidReason } from "./callMath.mjs";
import { callLifecycle } from "./callLifecycle.mjs";

export const SITE = "https://trade.nexustradinglabs.com";
export const OG_HOST = "https://og.nexustradinglabs.com";
const SUFFIX = " | Nexus Trading Labs";

const tickerOf = (symbol) => String(symbol || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const shortWallet = (w) => (w && w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : String(w || ""));

// $64,100 · $2,416.70 · $0.4321 · $0.000123: enough digits to read the level, no more.
export function fmtPx(v) {
  const n = Number(v);
  if (!(n > 0)) return "—";
  const d = n >= 10000 ? 0 : n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: d === 0 ? 0 : 2, maximumFractionDigits: d });
  return `$${s}`;
}

const fmtR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
const fmtDate = (ms) => {
  const d = new Date(Number(ms));
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
};

/**
 * @param {object} t        the stored public call
 * @param {object} o
 * @param {string} o.wallet the call's wallet as lab-api normalised it
 * @param {string} o.id
 * @param {string|null} o.displayName
 * @param {{outcome:"WIN"|"LOSS", r:number}|null} o.graded  a CURRENT grader stamp, else null
 * @returns {{title, description, headline, result, url, image, publishedAt}}
 */
export function callPageMeta(t, { wallet, id, displayName = null, graded = null }) {
  const ticker = tickerOf(t?.symbol) || "Call";
  const side = t?.direction === "SHORT" ? "SHORT" : "LONG";
  const who = displayName || shortWallet(wallet);
  const rr = callRR(t);

  // The state line: the grade if there is a current one, else where the call stands.
  let result;
  if (graded && (graded.outcome === "WIN" || graded.outcome === "LOSS") && Number.isFinite(Number(graded.r))) {
    const r = Number(graded.r);
    const runner = splitRunnerStopped({ ...t, gradedOutcome: graded.outcome, gradedR: r });
    result = runner ? `graded: TP1 hit, runner stopped ${fmtR(r)}` : `graded ${graded.outcome} ${fmtR(r)}`;
  } else {
    // Lifecycle on the levels + fill stamps only: an unstamped grade never counts as closed here.
    const lc = callLifecycle({ ...t, gradedOutcome: undefined, gradedR: undefined, status: "ACTIVE" });
    result = lc === "WORKING" ? `awaiting fill at ${fmtPx(t?.entryPrice)}`
      : lc === "OPEN" ? "open, not graded yet"
      : lc === "INVALID" ? `not graded: ${callInvalidReason(t)}`
      : "fill not checked yet";
  }

  const headline = `${ticker} ${side} call by ${who}`;
  const title = `${headline} · ${result}${SUFFIX}`;
  const posted = fmtDate(t?.publishedAt || t?.createdAt);
  const levels = `Entry ${fmtPx(t?.entryPrice)} · stop ${fmtPx(t?.stopLoss)} · target ${fmtPx(t?.takeProfit1)}${rr != null ? ` (1:${rr.toFixed(2)})` : ""}.`;
  const how = graded
    ? "First touch of target or stop, on public Orderly price."
    : "Graded on public Orderly price when the target or the stop is touched.";
  const description = [posted ? `Posted ${posted}.` : null, levels, `${result.charAt(0).toUpperCase()}${result.slice(1)}.`, how]
    .filter(Boolean).join(" ");

  const w = String(wallet || "");
  return {
    title,
    description,
    headline,
    result,
    url: `${SITE}/feed/thesis/${encodeURIComponent(w)}/${encodeURIComponent(String(id || ""))}`,
    image: `${OG_HOST}/og/thesis/${encodeURIComponent(w)}/${encodeURIComponent(String(id || ""))}.png`,
    publishedAt: Number(t?.publishedAt || t?.createdAt) || null,
  };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Tags the app's index.html carries for the whole site; a call page replaces every one of them.
const SITE_TAG = /\s*<meta\s+(?:property|name)="(?:og:(?:title|description|image|url|type)|twitter:(?:title|description|image|card)|description)"[^>]*>/gi;

/**
 * The app's HTML with the call's head tags and a <noscript> summary. Pure string work, so the Pages
 * Function and the tests run the same code. Returns the html unchanged when it has no <head>.
 */
export function injectCallMeta(html, meta) {
  const src = String(html || "");
  if (!/<\/head>/i.test(src) || !meta) return src;
  const head = [
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:type" content="article" />`,
    meta.publishedAt ? `<meta property="article:published_time" content="${new Date(meta.publishedAt).toISOString()}" />` : null,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
  ].filter(Boolean).join("\n    ");
  let out = src.replace(SITE_TAG, "");
  out = /<title>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.title)}</title>`)
    : out.replace(/<\/head>/i, `<title>${esc(meta.title)}</title></head>`);
  out = out.replace(/<\/head>/i, `    ${head}\n  </head>`);
  const summary = `<noscript><h1>${esc(meta.headline)}</h1><p>${esc(meta.description)}</p></noscript>`;
  return /<body[^>]*>/i.test(out) ? out.replace(/<body([^>]*)>/i, `<body$1>\n    ${summary}`) : out;
}
