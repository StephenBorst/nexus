// ── The Wire: one stream of what just changed, across every board (borst 2026-11-20, terminal step 2) ───────────────
// The terminal had ~20 places to look. The Wire puts them on ONE clock: a headline, a registered read opening or closing
// a paper trade (house runs included), funding crossing its stated line, a tracked wallet moving size, a call graded.
// Synthesis here means the same clock and the same coin, never a sum: each row keeps its own source and its own grade
// line, and nothing adds rows up into a call. Rules pure and tested (wire.test.mjs); route workers/nexus-lab-api/routes-wire.mjs.

export const WIRE_WINDOW_MS = 24 * 3600_000;   // the stream shows the last day
export const WIRE_MAX = 40;
export const WIRE_UPCOMING_MS = 12 * 3600_000; // scheduled releases and market closes shown ahead
export const WIRE_NEWS_MAX = 15;
export const WIRE_WALLET_MIN_USD = 10_000;     // a tracked wallet's move counts from this size
export const WIRE_WALLET_MAX = 6;

/** The kinds, in the words a row's tag prints. */
export const WIRE_KINDS = Object.freeze({
  NEWS: "News",
  READ: "Read",
  FUNDING: "Funding",
  MOMENTUM: "Trend",
  WALLET: "Wallet",
  TIER: "Wallet",
  CALL: "Call",
  MINE: "Your call",
});
/** The filter chips: a chip covers one or more kinds. */
export const WIRE_FILTERS = Object.freeze([
  { id: "all", label: "All", kinds: null },
  { id: "news", label: "News", kinds: ["NEWS"] },
  { id: "reads", label: "Reads", kinds: ["READ"] },
  { id: "markets", label: "Markets", kinds: ["FUNDING", "MOMENTUM"] },
  { id: "wallets", label: "Wallets", kinds: ["WALLET", "TIER"] },
  { id: "calls", label: "Calls", kinds: ["CALL", "MINE"] },
  { id: "mine", label: "Mine", kinds: ["MINE"], wallet: true }, // shown only with a wallet connected
]);

export const HEADLINE_LINE = "A headline, not a read.";
export const CALL_LINE = "Graded from public price, first touch.";
export const WALLET_LINE = "A tracked wallet's own move: not a read, and not a reason to follow it.";

const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "") || null;
const side = (s) => (String(s).toUpperCase() === "SHORT" ? "short" : "long");
const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const signedR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

/** News wire items → rows. Undated stories use the time we first saw them. */
export function newsRows(items, now = Date.now()) {
  return (items || []).slice(0, WIRE_NEWS_MAX).map((s) => ({
    id: `news-${s.id}`, kind: "NEWS", t: s.publishedAt ?? s.firstSeenAt, coin: (s.coins || [])[0] || null, coins: s.coins || [],
    title: s.title, source: s.source, graded: HEADLINE_LINE, link: s.link || null,
  })).filter((r) => Number.isFinite(r.t) && now - r.t <= WIRE_WINDOW_MS);
}

/**
 * Bell rows (app/lib/signals.mjs buildSignals: READ / FUNDING / FADE_ALIGN / DIVERGENCE / MOMENTUM / TIER) → wire rows.
 * A standing condition (funding stretched, a trend) carries `ts: now` on every build; the wire dates it by when it was
 * FIRST seen (`seen`, id → ms, kept by the route), so it stays where it entered the stream instead of always on top.
 */
export function bellRows(list, seen = {}, now = Date.now()) {
  const out = [];
  for (const b of list || []) {
    if (!b || !b.id) continue;
    const kind = b.kind === "READ" ? "READ" : b.kind === "MOMENTUM" ? "MOMENTUM" : b.kind === "TIER" ? "TIER" : "FUNDING";
    const standing = kind === "FUNDING" || kind === "MOMENTUM";
    const t = standing ? (seen[b.id] ?? now) : Number(b.ts) || now;
    out.push({ id: b.id, kind, t, coin: coinOfTitle(b.title), title: b.title, detail: b.detail || null, source: "Nexus", graded: b.graded || null, path: b.path || null });
  }
  return out;
}
/** The coin a bell title starts with ("SOL: …", "SOL funding …"), else null. */
export function coinOfTitle(title) {
  const m = String(title || "").match(/^([A-Z0-9]{2,10})(?=[:\s])/);
  return m ? m[1] : null;
}

/** Tracked wallets' opens / closes (/smart/events) at size → rows. Small fills are noise on a wire. */
export function walletRows(events, now = Date.now()) {
  return (events || [])
    .filter((e) => e && e.addr && Number(e.szUsd) >= WIRE_WALLET_MIN_USD && Number.isFinite(Number(e.ts)) && now - Number(e.ts) <= WIRE_WINDOW_MS)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, WIRE_WALLET_MAX)
    .map((e) => {
      const who = `${String(e.addr).slice(0, 6)}…${String(e.addr).slice(-4)}`;
      const venue = e.source === "hl" ? "Hyperliquid" : "Orderly";
      const verb = e.type === "CLOSE" ? "closed" : "opened";
      const pnl = e.type === "CLOSE" && Number.isFinite(e.closedPnl) && e.closedPnl !== null ? ` (${e.closedPnl >= 0 ? "+" : "−"}${usd(Math.abs(e.closedPnl))})` : "";
      return {
        id: `wallet-${e.source}-${e.addr}-${e.coin}-${e.side}-${e.type}-${e.ts}`, kind: "WALLET", t: Number(e.ts), coin: bare(e.coin),
        title: `${bare(e.coin)}: a tracked wallet ${verb} a ${usd(Number(e.szUsd))} ${side(e.side)}${pnl}`,
        source: `${who} · ${venue}`, graded: WALLET_LINE, path: `/analyze?address=${e.addr}`,
      };
    });
}

/** Graded calls from the pulse (people and engines named apart) → rows. */
export function callRows(pulse, now = Date.now()) {
  const rows = [];
  const add = (c, engine) => {
    if (!c || !c.symbol || !Number.isFinite(Number(c.at)) || now - Number(c.at) > WIRE_WINDOW_MS) return;
    const r = Number(c.r);
    rows.push({
      id: `call-${c.path || `${c.wallet}-${c.at}`}`, kind: "CALL", t: Number(c.at), coin: bare(c.symbol),
      title: `${bare(c.symbol)} ${side(c.direction)} by ${c.caller || "a caller"} graded ${String(c.outcome || "").toUpperCase()}${Number.isFinite(r) ? ` ${signedR(r)}` : ""}`,
      source: engine ? "Engine caller" : "Caller", graded: CALL_LINE, path: c.path || null,
    });
  };
  for (const c of pulse?.recentGraded || []) add(c, false);
  for (const c of pulse?.engines?.recentGraded || []) add(c, true);
  return rows;
}

/**
 * YOUR calls moving (borst 2026-11-21: the Wire as a personal stream too). From the connected wallet's own
 * GET /theses/status/:wallet, read in the browser (the Wire route is shared and cached, so it never carries a wallet).
 * Three moments, each at the time the grader stamped it: a resting entry that traded later (FILL; a call filled at the
 * post was live from the start, the same rule as the owner's fill alert, callStatus.mjs fillEvents), TP1 reached on a
 * split call, and the grade (WIN / LOSS in R, from the grader's record). Facts about your own calls, never a signal.
 */
export function myCallRows(status, now = Date.now()) {
  if (!status || !Array.isArray(status.calls) || !status.wallet) return [];
  const wallet = String(status.wallet).toLowerCase();
  const rows = [];
  const fresh = (t) => Number.isFinite(t) && now - t <= WIRE_WINDOW_MS && t <= now + 60_000;
  for (const c of [...status.calls, ...(Array.isArray(status.recent) ? status.recent : [])]) {
    if (!c || !c.id || !c.symbol) continue;
    const coin = bare(c.symbol), dir = side(c.direction);
    const path = `/feed/thesis/${wallet}/${encodeURIComponent(String(c.id))}`;
    const base = { coin, source: "Your call", graded: CALL_LINE, path };
    const filled = Number(c.filledAt), posted = Number(c.postedAt);
    if (fresh(filled) && Number.isFinite(posted) && filled > posted + 60_000) {
      rows.push({ ...base, id: `mine-${c.id}-fill`, kind: "MINE", t: filled, title: `Your ${coin} ${dir} filled at ${c.entryPrice}`, detail: `Live and graded from here · stop ${c.stopLoss}, TP1 ${c.takeProfit1}` });
    }
    const tp1 = Number(c.tp1HitAt), r1 = Number(c.plannedR?.tp1);
    if (fresh(tp1)) {
      rows.push({ ...base, id: `mine-${c.id}-tp1`, kind: "MINE", t: tp1, title: `Your ${coin} ${dir} reached TP1 ${c.takeProfit1}${Number.isFinite(r1) ? ` · half closed ${signedR(r1 / 2)}` : ""}`, detail: c.graded ? null : "Runner still open" });
    }
    const g = c.graded, gt = Number(g?.at ?? g?.exitedAt), r = Number(g?.r);
    if (g && (g.outcome === "WIN" || g.outcome === "LOSS") && fresh(gt)) {
      const how = { TIME: "time stop", TRAIL: "trail", BE: "stop at entry" }[c.exitReason] || null;
      rows.push({ ...base, id: `mine-${c.id}-graded`, kind: "MINE", t: gt, title: `Your ${coin} ${dir} graded ${g.outcome}${Number.isFinite(r) ? ` ${signedR(r)}` : ""}`, detail: how ? `Closed on the ${how}` : null });
    }
  }
  return rows;
}

/** The shared stream with your rows merged in: the public row for a call you were graded on is dropped (it is yours). */
export function withMine(rows, mine, now = Date.now()) {
  if (!mine || mine.length === 0) return rows || [];
  const yours = new Set(mine.filter((r) => r.id.endsWith("-graded")).map((r) => String(r.path).toLowerCase()));
  const shared = (rows || []).filter((r) => !(r.kind === "CALL" && r.path && yours.has(String(r.path).toLowerCase())));
  return wireStream([mine, shared], now);
}

/** Scheduled releases and market closes due in the next 12h (the calendar route's events), soonest first. */
export function upcomingRows(events, now = Date.now()) {
  return (events || [])
    .filter((e) => e && Number.isFinite(Number(e.at)) && e.at > now && e.at - now <= WIRE_UPCOMING_MS)
    .sort((a, b) => a.at - b.at)
    .slice(0, 6)
    .map((e) => ({
      id: `soon-${e.kind}-${e.at}-${String(e.title).slice(0, 40)}`, kind: e.kind === "MACRO" ? "MACRO" : "MARKET", t: e.at,
      title: e.title, impact: e.impact || null, coins: e.coins || [],
      detail: e.kind === "MACRO" ? [e.forecast ? `forecast ${e.forecast}` : null, e.previous ? `previous ${e.previous}` : null].filter(Boolean).join(" · ") || null
        : Number.isFinite(e.yesPct) ? `market closes then · yes ${Math.round(e.yesPct)}%` : "market closes then",
    }));
}

/** One stream: newest first, one row per id, last 24h, ≤ WIRE_MAX. */
export function wireStream(groups, now = Date.now()) {
  const byId = new Map();
  for (const rows of groups) for (const r of rows || []) if (r && r.id && !byId.has(r.id) && Number.isFinite(r.t) && now - r.t <= WIRE_WINDOW_MS && r.t <= now + 60_000) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.t - a.t).slice(0, WIRE_MAX);
}

/** The first-seen map after a build: keep ids still standing, add new ones at `now`. */
export function nextSeen(prevSeen, standingIds, now = Date.now()) {
  const out = {};
  for (const id of standingIds) out[id] = prevSeen?.[id] ?? now;
  return out;
}

/** Rows a filter chip keeps. */
export function filterWire(rows, filterId) {
  const f = WIRE_FILTERS.find((x) => x.id === filterId);
  if (!f || !f.kinds) return rows || [];
  return (rows || []).filter((r) => f.kinds.includes(r.kind));
}

/** "now", "4m", "2h", or ahead "in 35m" / "in 3h". */
export function wireWhen(t, now = Date.now()) {
  const d = t - now;
  const m = Math.floor(Math.abs(d) / 60_000);
  if (d > 60_000) return m < 60 ? `in ${m}m` : `in ${Math.round(m / 60)}h`; // ahead: 1h59m reads "in 2h", not "in 1h"
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}
