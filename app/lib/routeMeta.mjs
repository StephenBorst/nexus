// ── Page titles + descriptions for the app's indexed routes ───────────────────────────────────────
// The app is a single-page shell, so every route used to say "Nexus Trading Labs" and the site blurb,
// to a search engine and to a link preview on X or Telegram (neither runs JavaScript). ONE source:
//   - the Pages Functions (functions/<route>.js) write it into the HTML head before any script runs
//     (injectCallMeta, the same injector the call permalinks use; fail open: the plain page on any error);
//   - the route's PageMeta (app/components/PageMeta.tsx, react-helmet) sets the same title + description in the tab.
// The routes are the ones public/_headers leaves indexable. Copy follows marketing/VOICE.md: what the
// page is, in plain words, numbers over adjectives, never "proven".

import { SITE } from "./callPageMeta.mjs";

export const SITE_TITLE = "Nexus Trading Labs";
const SUFFIX = ` | ${SITE_TITLE}`;
export const DEFAULT_IMAGE = `${SITE}/embed-mini.png?v=2026-09-29b`;
// /proof's card: the record's counts (routes-recordshare.mjs), the same card its share link unfurls into.
const RECORD_IMAGE = "https://og.nexustradinglabs.com/og/record.png";

export const ROUTE_META = Object.freeze({
  "/proof": {
    name: "Proof: the public record",
    description: "Every read we run and every call posted here, graded from public Orderly price. Losses stay up. Retired reads stay listed. Anyone can re-run the grade.",
    image: RECORD_IMAGE,
  },
  "/lab": {
    name: "The Lab: plan, run and grade a trade",
    description: "Write a call with an entry, a stop and a target, or run a paper agent on a registered read. Every published call is graded from public price, wins and losses.",
  },
  "/feed": {
    name: "Feed: traders’ calls, graded",
    description: "Calls posted by traders on Nexus. Each one is graded first-touch against public Orderly candles. No self-reported results.",
  },
  "/arena": {
    name: "Arena: AI trading agents, ranked by graded record",
    description: "Any agent with a wallet can register and trade through the webhook rail, paper first. The board ranks by graded record, never by backtest.",
  },
  "/analyze": {
    name: "Wallet X-Ray: any trader’s record, graded",
    description: "Paste a wallet. See its perp record on Orderly and Hyperliquid over 24H, 7D, 30D and all time. No login, no wallet connect.",
  },
  "/token": {
    name: "Spot: swap on Solana and EVM chains",
    description: "Buy and sell spot tokens from your own wallet, on Solana and EVM chains. Non-custodial: you sign every trade.",
  },
  "/intel": {
    name: "Market terminal: read the tape",
    description: "Funding, open interest and regime for each market, each read against its own history.",
  },
});

const norm = (p) => {
  const s = String(p || "/").split(/[?#]/)[0].replace(/\/+$/, "");
  return s || "/";
};

/** The full meta for a route (injectCallMeta's shape), or null for a route this file doesn't name. */
export function routeMetaFor(pathname) {
  const path = norm(pathname);
  const m = ROUTE_META[path];
  if (!m) return null;
  const title = `${m.name}${SUFFIX}`;
  return { title, headline: m.name, description: m.description, url: `${SITE}${path}`, image: m.image || DEFAULT_IMAGE, type: "website", publishedAt: null };
}

/** The browser-tab title for a route: its own, else the site name. */
export function routeTitle(pathname) {
  return routeMetaFor(pathname)?.title || SITE_TITLE;
}

/** The public sitemap: the site root + every route above. */
export function sitemapXml() {
  const urls = ["/", ...Object.keys(ROUTE_META)];
  const rows = urls.map((p) => `  <url><loc>${SITE}${p === "/" ? "/" : p}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}
