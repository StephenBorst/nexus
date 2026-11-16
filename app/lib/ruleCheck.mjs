// RULE CHECK: an engine's posted calls against its own registered rules (borst 2026-11-16, "posted vs skipped vs
// off-rule"). docs/research/scanner-rule-check.md. Measurement only: it grades nothing, moves no stamp, licenses nothing.
//
// The two Bankr scanners post calls from their engine wallet, and the scoreboard runs their rules itself every hour
// (shelf_breakdown_short, bb_rsi_momentum, registered 2026-11-17). This lines the two records up:
//   - a SETUP = an event the registered rule fired on one of the engine's coins, from its start date;
//   - POSTED  = a public call from the engine's wallet on that coin and side, published from the bar's OPEN to
//               MATCH_AFTER_MS after its close (the scanner reads finer bars, so it can post inside the bar);
//   - SKIPPED = a setup with no such call once its window has closed;
//   - PENDING = a setup whose window is still open (never counted as skipped);
//   - OFF-RULE = a call from the wallet that matches no setup.
// Each call matches one setup at most (the earliest setup it fits, then the earliest call), and the two rules' setups
// on the same coin, side and hour are one setup (named for both rules). Calls on coins the engine isn't checked on are
// off-rule too: the rules are what it said it trades.
// Known gaps, said on the page and never "fixed" by loosening the match: the scanners also use a macro freeze, 5m/15m
// volume and (breakout) a retest entry that the registered rules leave out, so some skips and off-rule calls are expected.

export const MATCH_AFTER_MS = 2 * 3600000;
const BAR_MS = 3600000;

/** Which engine wallets are checked, against which registered reads, on which coins, from when. */
export const RULE_CHECKS = Object.freeze({
  "0xbce4b16be2088696d11d271ad29149f2dd97f432": Object.freeze({
    reads: Object.freeze(["shelf_breakdown_short", "bb_rsi_momentum"]),
    coins: Object.freeze(["BTC", "ETH", "SOL", "HYPE", "ZEC"]),
    from: "2026-11-17T00:00:00Z",
    gaps: "Some gaps are expected: the scanners also use a macro freeze and finer bars that the registered rules leave out.",
  }),
});

export const ruleCheckFor = (wallet) => RULE_CHECKS[String(wallet || "").toLowerCase()] || null;

const bare = (s) => {
  const m = /^PERP_([^_]+)_USDC(?:_.*)?$/.exec(String(s || ""));
  return (m ? m[1] : String(s || "")).toUpperCase();
};
const isPublic = (t) => !!t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf;

/**
 * @param {{ coin:string, read:string, t:number, side:"LONG"|"SHORT" }[]} events every rule event (t = bar close, ms)
 * @param {object[]} theses the wallet's Lab record (`lab:{wallet}`.theses)
 * @param {{ reads:string[], coins:string[], from:string }} check
 * @param {number} now ms
 * @param {{ unread?: string[] }} [opts] coins whose tape couldn't be read: their calls are left out (neither
 *   matched nor off-rule) and the reply names them, never a skip
 */
export function ruleCheck(events, theses, check, now, opts = {}) {
  const unread = new Set(opts.unread || []);
  const fromMs = Date.parse(check.from);
  const coins = new Set(check.coins), reads = new Set(check.reads);
  // One setup per coin + side + bar close, named for every rule that fired on it.
  const byKey = new Map();
  for (const e of events || []) {
    if (unread.has(e.coin) || !coins.has(e.coin) || !reads.has(e.read) || !(e.t > fromMs) || e.t > now) continue;
    const k = `${e.coin}|${e.side}|${e.t}`;
    const s = byKey.get(k) || { coin: e.coin, side: e.side, t: e.t, reads: [] };
    if (!s.reads.includes(e.read)) s.reads.push(e.read);
    byKey.set(k, s);
  }
  const setups = [...byKey.values()].sort((a, b) => a.t - b.t);
  const calls = (theses || [])
    .filter((t) => isPublic(t) && Number(t.publishedAt) >= fromMs)
    .map((t) => ({ id: String(t.id), coin: bare(t.symbol), side: String(t.direction || "").toUpperCase(), at: Number(t.publishedAt), match: null }))
    .filter((c) => !unread.has(c.coin))
    .sort((a, b) => a.at - b.at);
  for (const s of setups) {
    const c = calls.find((x) => !x.match && x.coin === s.coin && x.side === s.side && x.at >= s.t - BAR_MS && x.at <= s.t + MATCH_AFTER_MS);
    if (c) { c.match = s; s.call = c.id; }
  }
  const state = (s) => (s.call ? "POSTED" : now <= s.t + MATCH_AFTER_MS ? "PENDING" : "SKIPPED");
  const per = Object.fromEntries(check.reads.map((r) => [r, { setups: 0, posted: 0, skipped: 0, pending: 0 }]));
  for (const s of setups) {
    s.state = state(s);
    for (const r of s.reads) { per[r].setups += 1; per[r][s.state.toLowerCase()] += 1; }
  }
  const offRule = calls.filter((c) => !c.match);
  const count = (st) => setups.filter((s) => s.state === st).length;
  return {
    from: check.from, coins: [...check.coins], unread: [...unread], reads: per,
    setups: setups.length, posted: count("POSTED"), skipped: count("SKIPPED"), pending: count("PENDING"),
    calls: calls.length, offRule: offRule.length,
    recent: setups.slice(-8).reverse().map((s) => ({ coin: s.coin, side: s.side, t: s.t, reads: s.reads, state: s.state, call: s.call || null })),
    recentOffRule: offRule.slice(-5).reverse().map((c) => ({ id: c.id, coin: c.coin, side: c.side, at: c.at })),
  };
}

/** The one line /proof prints under the engine row. Null = nothing to say yet (no check, or no setup and no call). */
export function ruleCheckLine(rc, now = Date.now()) {
  if (!rc || !Number.isFinite(rc.setups)) return null;
  const since = new Date(rc.from).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (Date.parse(rc.from) > now) return `Rule check starts ${since}: each call matched to the setups its own registered rules find.`;
  if (rc.setups === 0 && rc.calls === 0) return `Rule check since ${since}: no setup on its coins yet, no call posted.`;
  const s = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [`${s(rc.setups, "setup")} on its coins`, `${rc.posted} posted`, `${rc.skipped} skipped`];
  if (rc.pending) parts.push(`${rc.pending} pending`);
  const gap = rc.unread?.length ? ` (${rc.unread.join(", ")} unread)` : "";
  return `Rule check since ${since}: ${parts.join(" · ")} · ${s(rc.offRule, "call")} off its rules${gap}.`;
}
