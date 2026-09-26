// ── LIVE-vs-GRADED PARITY — does the agent trade the read the scoreboard grades? ──
// The parity unit tests (basisStack.test.mjs) prove the live gate and the grader fire on the
// same hours on a SYNTHETIC tape. This checks it on REAL fills: every paper entry must line up
// with a graded event (same market, same side, the basis hour it acted on), and every graded
// event the agent was free to take must show up as an entry. Misses the agent's own rules
// explain (a position already open, cooldown, daily caps, the brain handing the wallet a
// different market) are listed with that reason. What's left — an entry with no graded event,
// or a free event with no entry — is DRIFT: the live path and the grade disagree.
//
// Pure: no fetch, no KV. Callers pass the paper ledger, the config and the axis events.

// The brain only acts on the LATEST hourly basis reading, so an event is actionable until the
// next reading lands (~1h). basisFadeFromHistory still trades a reading up to 3h old when the
// flow cron stalls, so an entry may follow its event by up to 3h.
export const PARITY_ACT_WINDOW_MS = 3600000;
export const PARITY_MATCH_SLACK_MS = 3 * 3600000;
// Tolerance for clock skew between the flow cron's stamp and the exec's opened_at.
export const PARITY_EARLY_MS = 10 * 60000;
// Events newer than this aren't judged yet (hourly flow + 5-min brain + 1-min exec).
export const PARITY_SETTLE_MS = 2 * 3600000;
// exec COOLDOWN_MS (brain signals only).
export const PARITY_COOLDOWN_MS = 15 * 60000;
const DAY_MS = 86400000;

// Which scoreboard axis a config trades — the exact rule, or null when it trades none.
export function axisForConfig(config) {
  if (!config || config.signalMode !== "BASIS_FADE") return null;
  if (config.invertSignal) return null; // an inverted fade trades the mirror image of every axis
  const c = config.basisConfirm;
  if (!c) return "basis_extreme";
  if (c === "CVD") return "basis_x_cvd";
  if (c === "SMART") return "basis_x_smart";
  if (c === "LIQ") return "basis_x_liqflush";
  return null;
}

// Filters the grader does not simulate AND that can suppress a BASIS_FADE entry. When any is
// on, a free miss may just be the filter doing its job, so parity says UNVERIFIABLE rather than
// calling it drift. Deliberately NOT listed: fundingPercentileMin (the brain applies it to
// FUNDING_ONLY / CONFLUENCE only — inert on BASIS_FADE) and maxSignalAgeSec (a latency guard;
// the brain re-stamps its signal every 5 min, so it only delays an entry by minutes).
export function unsimulatedFilters(config) {
  const c = config || {};
  const on = [];
  if (c.respectRegime) on.push("regime");
  if (c.respectSmartMoney) on.push("smart-money");
  if (Array.isArray(c.tradeSessions) && c.tradeSessions.length) on.push("session");
  if (c.minVolAtrPct || c.maxVolAtrPct) on.push("volatility");
  return on;
}

const bare = (sym) => String(sym || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");
const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// Paper rows → entries. A position is (market, side, open time): exec stamps every row of one
// position with the position's opened_at — scale-out slices (TP_PARTIAL, which on PAPER rows carry
// NO parent_id) and the final close (which may) — so that key collapses them whatever ids they
// carry: first open, last close, summed P&L.
// `openPosition` = state.current_position. The ledger only holds CLOSED rows, so without it the
// trade the agent is in right now reads as a graded event it "missed" (the Sept-26 LINK false
// alarm). It joins as an entry with closedAt null (its closed slices, if any, merge into it).
export function entriesFromPaperTrades(trades, openPosition = null) {
  const by = new Map();
  const add = (sym, side, o, c, pnl, id) => {
    const coin = bare(sym), key = `${coin}:${side}:${o}`;
    const cur = by.get(key);
    if (!cur) { by.set(key, { id: id || key, coin, side, openedAt: o, closedAt: Number.isFinite(c) ? c : null, pnl }); return by.get(key); }
    if (Number.isFinite(c)) cur.closedAt = Math.max(cur.closedAt ?? c, c);
    cur.pnl += pnl;
    return cur;
  };
  for (const t of trades || []) {
    if (!t) continue;
    const o = ms(t.opened_at);
    if (!Number.isFinite(o)) continue;
    add(t.symbol, t.direction, o, ms(t.closed_at), Number(t.pnl) || 0, t.parent_id || t.id);
  }
  const po = openPosition && ms(openPosition.opened_at);
  if (openPosition && Number.isFinite(po) && (openPosition.direction === "LONG" || openPosition.direction === "SHORT")) {
    const e = add(openPosition.symbol, openPosition.direction, po, NaN, 0, "open");
    e.closedAt = null; // still open: slices that already closed don't end it
    e.open = true;
  }
  return [...by.values()].sort((a, b) => a.openedAt - b.openedAt);
}

// Graded events → one per (market, hour, side), in time order.
function normEvents(events, coins) {
  const seen = new Set(), out = [];
  for (const e of events || []) {
    if (!e || (e.side !== "LONG" && e.side !== "SHORT")) continue;
    const t = ms(e.t), coin = bare(e.coin);
    if (!Number.isFinite(t) || (coins && !coins.has(coin))) continue;
    const k = `${coin}:${Math.round(t / 3600000)}:${e.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ coin, t, side: e.side });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Why the agent could not take an event, per its own rules — or null (then it's drift).
function explainMiss(ev, entries, config) {
  const end = ev.t + PARITY_ACT_WINDOW_MS;
  // The brain hands each wallet ONE signal (its best market). An entry on another market
  // inside this window means that market won the tick.
  const other = entries.find((x) => x.openedAt >= ev.t - PARITY_EARLY_MS && x.openedAt < end && !(x.coin === ev.coin && x.side === ev.side));
  // Blocked for the WHOLE window? Walk it: each entry occupies [open, close + cooldown). A gap
  // anywhere means the agent was free with the reading still live — so it should have entered.
  let cursor = ev.t, first = null;
  for (;;) {
    const cover = entries.find((x) => x.openedAt <= cursor && (x.closedAt == null || cursor < x.closedAt + PARITY_COOLDOWN_MS));
    if (!cover) break;
    if (!first) first = { x: cover, cooldown: cover.closedAt != null && cursor >= cover.closedAt };
    if (cover.closedAt == null) { cursor = Infinity; break; }
    cursor = cover.closedAt + PARITY_COOLDOWN_MS;
    if (cursor >= end) break;
  }
  if (cursor >= end && first) {
    if (first.cooldown) return { code: "COOLDOWN", text: "inside the 15-min cooldown after a close" };
    const x = first.x;
    if (x.coin === ev.coin && x.side === ev.side) return { code: "HOLDING", text: `already in this ${ev.side} on ${ev.coin}` };
    return { code: "BUSY", text: `in a ${x.coin} ${x.side} (opened ${new Date(x.openedAt).toISOString().slice(5, 16)}Z) — one position at a time` };
  }
  if (other) return { code: "OTHER_MARKET", text: `the brain handed the wallet ${other.coin} ${other.side} that hour` };
// Daily caps. The live counter resets 24h after its last reset, which the ledger doesn't
  // record, so this is judged on the trailing 24h — labelled "likely".
  const day = entries.filter((x) => x.openedAt < ev.t && x.openedAt >= ev.t - DAY_MS);
  const maxT = Number(config?.maxTradesPerDay) || 0;
  if (maxT > 0 && day.length >= maxT) return { code: "DAILY_TRADES", text: `likely the ${maxT}-trades/day cap (${day.length} in the prior 24h)` };
  const maxL = Number(config?.maxDailyLossUsdc) || 0;
  const dayPnl = entries.filter((x) => x.closedAt != null && x.closedAt < ev.t && x.closedAt >= ev.t - DAY_MS).reduce((s, x) => s + x.pnl, 0);
  if (maxL > 0 && dayPnl <= -maxL) return { code: "DAILY_LOSS", text: `likely the $${maxL} daily-loss cap (${dayPnl.toFixed(2)} in the prior 24h)` };
  return null;
}

// The check. `events` = the axis's graded events [{coin, t, side}]; `trades` = paper ledger
// rows; judged over [since, until − settle]. Returns counts, the pairs, and every mismatch.
export function paperParity({ trades, events, config, since = 0, until = Date.now(), openPosition = null }) {
  const coins = new Set((config?.symbols || []).map(bare));
  const cutoff = until - PARITY_SETTLE_MS;
  const entries = entriesFromPaperTrades(trades, openPosition).filter((x) => coins.has(x.coin));
  const judgedEntries = entries.filter((x) => x.openedAt >= since && x.openedAt <= cutoff);
  const evs = normEvents(events, coins).filter((e) => e.t >= since && e.t <= cutoff);

  const used = new Set(), matched = [], unmatchedTrades = [];
  for (const x of judgedEntries) {
    // the latest unused same-market same-side event it could have acted on
    let hit = -1;
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i], dt = x.openedAt - e.t;
      if (used.has(i) || e.coin !== x.coin || e.side !== x.side) continue;
      if (dt >= -PARITY_EARLY_MS && dt <= PARITY_MATCH_SLACK_MS) { hit = i; break; }
    }
    if (hit >= 0) { used.add(hit); matched.push({ entry: x, event: evs[hit], lagMin: Math.round((x.openedAt - evs[hit].t) / 60000) }); continue; }
    const opposite = evs.find((e) => e.coin === x.coin && e.side !== x.side && x.openedAt - e.t >= -PARITY_EARLY_MS && x.openedAt - e.t <= PARITY_MATCH_SLACK_MS);
    unmatchedTrades.push({ entry: x, reason: opposite ? `graded the OTHER side (${opposite.side}) that hour` : "no graded event in that market within 3h before entry" });
  }

  const explained = [], unexplained = [];
  evs.forEach((e, i) => {
    if (used.has(i)) return;
    const why = explainMiss(e, entries, config);
    if (why) explained.push({ event: e, ...why });
    else unexplained.push({ event: e });
  });

  const filters = unsimulatedFilters(config);
  const drift = unmatchedTrades.length + unexplained.length;
  let verdict = "CLEAN";
  if (!judgedEntries.length && !evs.length) verdict = "NO_DATA";
  else if (drift > 0) verdict = filters.length && !unmatchedTrades.length ? "UNVERIFIABLE" : "DRIFT";
  return {
    verdict,
    window: { since: new Date(since).toISOString(), until: new Date(cutoff).toISOString() },
    counts: { entries: judgedEntries.length, events: evs.length, matched: matched.length, unmatchedTrades: unmatchedTrades.length, missedExplained: explained.length, missedUnexplained: unexplained.length },
    unsimulatedFilters: filters,
    matched, unmatchedTrades, missed: { explained, unexplained },
  };
}
