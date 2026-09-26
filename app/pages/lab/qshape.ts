// ── Q Signals shaper (CLIENT copy) ───────────────────────────────────────────
// Quotient 403s Cloudflare-Worker / datacenter IPs (same block the codebase already
// dodges for rss2json), so the browser must call Quotient DIRECTLY and shape the raw
// response itself — the worker can't relay. This is a faithful mirror of
// workers/nexus-lab-api/logic.mjs `quotientSignals` + `quotientPerpMap` (which stay the
// TESTED source of truth; keep the two in sync). Pure, no deps.

export interface QPerp { coin: string; perpSymbol: string; direction: "LONG" | "SHORT"; targetUsd: number | null; }

export interface QSignal {
  id: string;
  question: string;
  venue: string | null;
  url: string | null;
  quotientUrl: string | null;
  side: string | null;
  qProbPct: number;
  marketProbPct: number;
  spreadPp: number;
  convictionTier: number | null;
  conviction: string;
  convergeUpsidePct: number | null;
  maxRoiPct: number | null;
  thesis: string | null;
  windowDays: number | null;
  endDate: string | null;
  volume24hUsd: number | null;
  capacityUsd: number | null;
  isFresh: boolean;
  isNewToday: boolean;
  status: string | null;
  adverseMovePct: number | null;
  perp: QPerp | null;
}

export interface QBoard {
  ok?: boolean;
  reason?: string;
  scanned?: number;
  freshCount?: number;
  highConvictionCount?: number;
  perpCount?: number;
  signals?: QSignal[];
}

const round = (n: unknown, dp = 1): number => { const f = 10 ** dp; return Math.round(Number(n) * f) / f; };
const numOrNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
function pctFrom01(prob01: unknown, pctFallback: unknown): number | null {
  const p = Number(prob01);
  if (Number.isFinite(p) && p >= 0 && p <= 1) return round(p * 100, 1);
  const f = Number(pctFallback);
  return Number.isFinite(f) ? round(f, 1) : null;
}
function convictionLabel(tier: number, upstream?: unknown): string {
  if (upstream) return String(upstream).toLowerCase();
  if (tier >= 3) return "high";
  if (tier === 2) return "medium";
  if (tier >= 1) return "low";
  return "—";
}

// ── QUOTIENT → PERP mapping ("perp signals from Q") — verbatim from logic.mjs ──
const PERP_COIN_ALIASES: Record<string, string[]> = {
  BTC: ["btc", "bitcoin"], ETH: ["eth", "ethereum", "ether"], SOL: ["sol", "solana"],
  XRP: ["xrp", "ripple"], BNB: ["bnb"], DOGE: ["doge", "dogecoin"], ADA: ["ada", "cardano"],
  AVAX: ["avax", "avalanche"], LINK: ["link", "chainlink"], SUI: ["sui"], LTC: ["ltc", "litecoin"],
  DOT: ["dot", "polkadot"], HYPE: ["hyperliquid"], TON: ["toncoin"], ARB: ["arbitrum"],
  OP: ["optimism"], PEPE: ["pepe"], WIF: ["dogwifhat"], BONK: ["bonk"], AAVE: ["aave"],
};
const Q_UP_WORDS = ["reach", "hit", "above", "exceed", "surpass", "cross", "break above", "climb to", "rise to", "rally to", "all-time high", "ath", "≥"];
const Q_DOWN_WORDS = ["below", "under", "fall", "drop", "dip", "crash", "decline", "less than", "dump", "≤"];

export function quotientPerpMap(sig: { question?: string | null; side?: string | null; qProbPct?: number; marketProbPct?: number }): QPerp | null {
  const q = String((sig && sig.question) || "").toLowerCase();
  if (!q) return null;
  let coin: string | null = null;
  for (const [sym, aliases] of Object.entries(PERP_COIN_ALIASES)) {
    if (aliases.some((a) => new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(q))) { coin = sym; break; }
  }
  if (!coin) return null;
  const up = Q_UP_WORDS.some((w) => q.includes(w));
  const down = Q_DOWN_WORDS.some((w) => q.includes(w));
  if (up === down) return null;
  const yesMeansUp = up;
  const side = String((sig && sig.side) || "").toUpperCase();
  let onYes: boolean;
  if (side === "YES") onYes = true;
  else if (side === "NO") onYes = false;
  else if (Number.isFinite(Number(sig && sig.qProbPct)) && Number.isFinite(Number(sig && sig.marketProbPct)))
    onYes = Number(sig.qProbPct) >= Number(sig.marketProbPct);
  else return null;
  const bullish = onYes ? yesMeansUp : !yesMeansUp;
  let targetUsd: number | null = null;
  const m = q.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)(k|m|b)?(?![a-z])/);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    const suf = m[2];
    if (suf === "k") n *= 1e3; else if (suf === "m") n *= 1e6; else if (suf === "b") n *= 1e9;
    if (Number.isFinite(n) && n > 0) targetUsd = n;
  }
  return { coin, perpSymbol: `PERP_${coin}_USDC`, direction: bullish ? "LONG" : "SHORT", targetUsd };
}

const REQUIRE_ACTIONABLE = true;
const MAX_SIGNALS = 24;

// Quotient's raw signal row — only the fields the shaper reads, all optional (upstream
// is untrusted; every read below already guards). Type-only: no runtime change.
type QRawMarket = {
  question?: string; market_odds?: unknown; marketKey?: string; venue?: string;
  marketUrl?: string; polymarketUrl?: string; sourceUrl?: string; quotientUrl?: string;
  end_date?: string; volume_24h?: unknown;
};
type QRawSignal = {
  market?: QRawMarket; question?: string; id?: string;
  is_active?: boolean; suppression_reason?: unknown; grounding_status?: string;
  latest_q?: unknown; entry_q?: unknown; entry_pm?: unknown; entry_spread_pp?: unknown;
  venue_quote?: { selected_probability?: unknown; venue?: string };
  conviction_tier?: unknown; conviction?: unknown; q_side?: string; side?: string;
  converge_upside_pct?: unknown; max_roi_pct?: unknown; thesis?: unknown; window_days?: unknown;
  capacity_usd_at_2c?: unknown; is_fresh?: unknown; is_new_today?: unknown;
  forecast_status?: { state?: string; adverse_move_pct?: unknown };
};

// Mirror of logic.mjs quotientSignals. Takes the raw `signals` array from Quotient.
export function shapeQuotientSignals(rawSignals: unknown): QBoard {
  const rows = Array.isArray(rawSignals) ? rawSignals : [];
  const out: QSignal[] = [];
  for (const raw of rows) {
    const s = raw as QRawSignal;
    if (!s || typeof s !== "object") continue;
    const market: QRawMarket = s.market || {};
    const question = market.question || s.question || null;
    if (!question) continue;
    if (REQUIRE_ACTIONABLE) {
      if (s.is_active === false) continue;
      if (s.suppression_reason) continue;
      if (s.grounding_status && s.grounding_status !== "actionable") continue;
    }
    const qProbPct = pctFrom01(s.latest_q, s.entry_q);
    const mktProbPct = pctFrom01(
      market.market_odds != null ? market.market_odds : (s.venue_quote && s.venue_quote.selected_probability),
      s.entry_pm,
    );
    if (qProbPct == null || mktProbPct == null) continue;
    const spreadPp = Number.isFinite(Number(s.entry_spread_pp))
      ? Math.abs(Number(s.entry_spread_pp))
      : round(Math.abs(qProbPct - mktProbPct), 1);
    const tier = Number.isFinite(Number(s.conviction_tier)) ? Number(s.conviction_tier) : null;
    const entry: QSignal = {
      id: s.id ?? market.marketKey ?? question,
      question,
      venue: market.venue || (s.venue_quote && s.venue_quote.venue) || null,
      url: market.marketUrl || market.polymarketUrl || market.sourceUrl || null,
      quotientUrl: market.quotientUrl || null,
      side: s.q_side || s.side || null,
      qProbPct,
      marketProbPct: mktProbPct,
      spreadPp,
      convictionTier: tier,
      conviction: convictionLabel(tier ?? 0, s.conviction),
      convergeUpsidePct: numOrNull(s.converge_upside_pct),
      maxRoiPct: numOrNull(s.max_roi_pct),
      thesis: typeof s.thesis === "string" ? s.thesis : null,
      windowDays: numOrNull(s.window_days),
      endDate: market.end_date || null,
      volume24hUsd: numOrNull(market.volume_24h),
      capacityUsd: numOrNull(s.capacity_usd_at_2c),
      isFresh: s.is_fresh === true,
      isNewToday: s.is_new_today === true,
      status: (s.forecast_status && s.forecast_status.state) || null,
      adverseMovePct: s.forecast_status ? numOrNull(s.forecast_status.adverse_move_pct) : null,
      perp: null,
    };
    entry.perp = quotientPerpMap(entry);
    out.push(entry);
  }
  out.sort((a, b) =>
    ((b.convictionTier ?? 0) - (a.convictionTier ?? 0)) ||
    ((b.spreadPp ?? 0) - (a.spreadPp ?? 0)) ||
    (Number(b.isFresh) - Number(a.isFresh)),
  );
  return {
    ok: true,
    scanned: out.length,
    freshCount: out.filter((s) => s.isFresh).length,
    highConvictionCount: out.filter((s) => (s.convictionTier ?? 0) >= 3).length,
    perpCount: out.filter((s) => s.perp).length,
    signals: out.slice(0, MAX_SIGNALS),
  };
}
