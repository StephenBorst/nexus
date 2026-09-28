// ── Thesis grading + caller aggregation ──
// The trustless core: grade every PUBLIC call against public price (first-touch
// TP-vs-SL) and aggregate per wallet. Lifted out of index.js's fetch handler
// (migration rules in shared.mjs).
//
// NOT folded into routes-theses.mjs on purpose: these are shared infrastructure, not
// theses-exclusive. gradedStatusOf/fetchGradeHistory drive the OG card routes,
// computeCallerStats also scores Desks, and gradePublicTheses is driven by the hourly
// cron. Burying them in a route slice would force index.js to import back out of a
// module it dispatches to.
//
// ⚠️ Pure move — logic byte-identical to what shipped.
import { notifyResolution } from "./resolutions.mjs";
import {
  gradeCall, classifyRegime, callAlignment, regimeBucketsOf, regimeBuckets,
  regimeEdge, planQuality, planSummary, expectancyStats, convictionCalibration, rankCaller,
  consensusBySymbol, stanceAtPost, classifyContrarian, aggregateSideRecord, contrarianEdgeScore,
  classifyMacro,
} from "./logic.mjs";
import { REGIME_PAD_S, makeGradeCandles, candlesForCall, callWindow, gradeSymbol, neededFrom } from "./gradeCandles.mjs";

// Candle pages one grading pass may fetch. The hourly cron can take a whole cold backfill (67 pages
// for the 27 symbols on 2026-09-27); a leaderboard read is a user waiting, so it takes less and
// leaves the rest to the next read or the cron.
export const CRON_PAGE_BUDGET = 80;
export const BOARD_PAGE_BUDGET = 24;

// A call is MACRO/event-driven when its catalyst (the "why now") classifies as a macro or
// geopolitical event — the same classifier the Macro & Events board uses. No thesis-schema
// change: the macro-events "draft thesis" sets the catalyst to the event, so it's captured
// by intent. Falls back to the notes for a macro-drafted call (notes carry the full event).
export const isMacroCall = (t) => !!(classifyMacro(t?.catalyst || "") || (t?.catalyst ? null : classifyMacro(t?.notes || "")));

// ── Historical stance snapshots (contrarian grading) ─────────────────────────
// Persist the merit-weighted consensus lean per symbol over time so a call can later
// be graded CONTRARIAN vs with-crowd against the lean that PRECEDED it. Mirrors the
// Tracked Record x-ray snapshot pattern. Keyed by BARE coin (BTC), matching the
// consensus board + the join in computeCallerStats. Spec: docs/historical-stance-snapshots-spec.md.
const STANCE_HIST_PREFIX = "stance:hist:";
const STANCE_SNAP_MIN_MS = 50 * 60 * 1000;  // ≥50min between stored snapshots (~hourly cron)
const STANCE_HIST_CAP = 240;
const STANCE_HIST_TTL = 400 * 86400;

async function readStanceHist(env, coin) {
  const raw = await env.LAB_STORE.get(STANCE_HIST_PREFIX + coin);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Cron pass: snapshot the CURRENT merit-weighted lean per symbol. Only symbols with a
// real lean (a dominant side + ≥2 participants) are stored — SPLIT/thin ticks would make
// everything read "contrarian" against noise. Throttled per symbol. Best-effort.
export async function snapshotStances(env) {
  let stored = 0;
  try {
    const { entries } = await gatherStanceEntries(env);
    const consensus = consensusBySymbol(entries);
    const now = Date.now();
    for (const [coin, c] of Object.entries(consensus)) {
      if ((c.side !== "LONG" && c.side !== "SHORT") || (c.participants || 0) < 2) continue;
      const hist = await readStanceHist(env, coin);
      const last = hist[hist.length - 1];
      if (last && Number.isFinite(last.t) && now - last.t < STANCE_SNAP_MIN_MS) continue;
      hist.push({ t: now, side: c.side, lean: c.lean, longWeight: c.longWeight, shortWeight: c.shortWeight, participants: c.participants });
      await env.LAB_STORE.put(STANCE_HIST_PREFIX + coin, JSON.stringify(hist.slice(-STANCE_HIST_CAP)), { expirationTtl: STANCE_HIST_TTL });
      stored++;
    }
  } catch (e) { console.error("[stances] snapshot", e.message); }
  return stored;
}

// Grade every PUBLIC thesis call against public price (first-touch TP-vs-SL via
// gradeCall in logic.mjs) and aggregate per wallet → { wallet: {calls,wins,rSum} }.
// Shared by the human-caller leaderboard AND Desk scoring so the two never drift.
// PENDING/INVALID are excluded from the record (same rule as the board).
// gradeCall outcome → the objective card status. Kept trivial + pure so the mapping
// is obvious: a WIN is first-touch of TP, a LOSS is first-touch of SL (or same-candle,
// conservatively). PENDING means neither level has been touched yet → still ACTIVE.
export function gradedStatusOf(outcome) {
  return outcome === "WIN" ? "HIT_TP" : outcome === "LOSS" ? "STOPPED_OUT" : "ACTIVE";
}

// The grader that wrote a stamp. Bumped when the rules or the candle window change, so every
// stamp from an older grader is re-derived once by the next pass. 2 = graded on the call's own
// window (gradeCandles.mjs, 2026-09-28): before it, calls stamped more than 60 days after they
// were posted were graded on a window that started after the post, and a client save could write
// a stamp itself. Cards trust a stamp only when it carries this version.
export const GRADE_V = 2;
export const isCurrentStamp = (t) => (t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS") && t?.gradeV === GRADE_V;

// The fields the hourly pass writes on a public call. When it writes back, it copies ONLY these onto
// a fresh read of the record, so a save that landed during the pass isn't overwritten.
const PASS_FIELDS = ["gradedOutcome", "gradedR", "gradedAt", "gradeV", "planScore", "planFlags", "regimeTrend", "regimeVol", "regimeAlign", "status"];

// 1h OHLC from REGIME_PAD_S before the call to now, for gradeCall. Every grader (this cron, the
// leaderboard, the permalink and the share card) reads the SAME per-symbol candle store
// (gradeCandles.mjs), so a call can't be graded one way on its card and another on the board.
// ⚠️ The window starts REGIME_PAD_S *before* the call, not at the call. Grading only
// needs candles from the call forward, but regime attribution + plan quality describe
// the market the call was posted INTO, which lives entirely in the bars before it.
// Without the pad, classifyRegime returns null for every call (nothing precedes it).
// Closes (`c`) are kept for the same reason — gradeCall only reads highs/lows.
export { REGIME_PAD_S };

// Plan-quality flags, phrased for a trader looking at a DRAFT (POST /theses/advice)
// rather than a graded record — present tense, and each one names the fix.
export const ADVICE_FLAG_TEXT = {
  LATE_ENTRY: "Price has already run past your entry — the R you're claiming isn't obtainable from here.",
  STOP_IN_NOISE: "Your stop sits inside a single bar's normal range — this is a coin flip on noise, not on the idea.",
  STOP_TOO_WIDE: "That stop is too wide to be risk control. Cut the size instead.",
  RR_MISMATCH: "Your stated R:R doesn't match these levels — the record will be graded on the levels.",
  BAD_LEVELS: "Your target or stop is on the wrong side of entry.",
};

// Candles for ONE call from the hour it was posted (the old version capped the window at 60 days,
// in one request). null = not gradeable yet (no candles back to the post, or Orderly refused):
// callers keep the stored status and try again later. The thesis FORM stores BARE tickers
// ("BTC"); gradeSymbol maps them to the Orderly perp id, which /tv/history needs.
export async function fetchGradeHistory(symbol, createdAt, env, opts = {}) {
  if (!env) return null;
  try { return await candlesForCall(env, symbol, createdAt, opts); }
  catch (e) { console.error("[grade] history", symbol, String((e && e.message) || e)); return null; }
}

// Cron pass: objectively resolve every PUBLIC thesis from public price and STAMP the
// result onto the stored record — gradedOutcome (WIN/LOSS), gradedR, gradedAt. This is
// what makes "it grades itself" true on the CARD, not just the leaderboard: the badge
// reads the stamp, never a self-report. Single writer (cron) = no race with the user's
// own edits, and we only write a wallet back when something actually changed.
export async function gradePublicTheses(env) {
  const listed = await env.LAB_STORE.list({ prefix: "lab:" });
  let graded = 0, regraded = 0, walletsWritten = 0;
  // One candle-store run for the whole pass: each symbol is loaded once and extended back to the
  // oldest call that needs it, within the run's page budget.
  const gc = makeGradeCandles(env, { budget: CRON_PAGE_BUDGET });
  for (const key of listed.keys) {
    const raw = await env.LAB_STORE.get(key.name);
    if (!raw) continue;
    let data; try { data = JSON.parse(raw); } catch { continue; }
    let changed = false;
    // Collected, not dispatched inline: a resolution must only be announced once the
    // stamp is actually persisted (see resolutions.mjs).
    const justResolved = [];
    for (const t of (data.theses || [])) {
      if (!t.isPublic || !t.symbol || !t.createdAt) continue;
      // A published call's status is the server's grade, never a self-mark (callLock.mjs): a legacy
      // "HIT_TP" or "INVALIDATED" the owner typed reads as live until the grade lands.
      const derived = gradedStatusOf(t.gradedOutcome);
      if (t.status !== derived) { t.status = derived; changed = true; }
      const resolved = isCurrentStamp(t); // a stamp from this grader is final
      // Plan quality + regime are properties of the MOMENT THE CALL WAS POSTED, so
      // they're stamped once and never revisited — including on already-resolved
      // calls that predate this feature (backfill). Skipped beyond the history
      // horizon, where the candles we'd need no longer come back.
      const stampable = t.planScore === undefined && t.createdAt > Date.now() - 60 * 86400 * 1000;
      if (resolved && !stampable) continue;

      // null = the candles don't reach back to this call yet (budget / Orderly refusal): leave it
      // for the next run rather than grade or stamp it on a partial window.
      const cd = await candlesForCall(env, t.symbol, t.createdAt, { gc });
      if (!cd) continue;

      if (stampable) {
        const pq = planQuality(t, cd);
        if (pq) { t.planScore = pq.score; t.planFlags = pq.flags; }
        const reg = classifyRegime(cd, Math.floor(t.createdAt / 1000));
        if (reg) {
          t.regimeTrend = reg.trend;
          t.regimeVol = reg.vol;
          t.regimeAlign = callAlignment(t.direction, reg);
        }
        // Stamp even when unscoreable (the candles were there), so a malformed call isn't re-fetched forever.
        if (t.planScore === undefined) t.planScore = null;
        changed = true;
      }

      if (!resolved) {
        const g = gradeCall(t, cd);
        const had = t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS";
        if (g.outcome === "WIN" || g.outcome === "LOSS") {
          if (!had || t.gradedOutcome !== g.outcome) t.gradedAt = Date.now();
          t.gradedOutcome = g.outcome;
          t.gradedR = g.r;
          t.gradeV = GRADE_V;
          changed = true;
          if (had) regraded++;
          else { graded++; justResolved.push({ t, outcome: g.outcome, r: g.r }); } // corrections aren't announced
        } else if (had) {
          // An old stamp the call's own window doesn't support: it goes, and the call grades live.
          delete t.gradedOutcome; delete t.gradedR; delete t.gradedAt; delete t.gradeV;
          changed = true; regraded++;
        }
        t.status = gradedStatusOf(t.gradedOutcome);
      }
    }
    if (changed) {
      // Write onto a FRESH read, copying only what this pass computes: an owner's save during the
      // pass (a new call, a timeline note) must not be lost to this older copy.
      let fresh = null;
      try { const f = JSON.parse((await env.LAB_STORE.get(key.name)) || "null"); if (f && Array.isArray(f.theses)) fresh = f; } catch { fresh = null; }
      if (fresh) {
        const mine = new Map((data.theses || []).filter((x) => x && x.id).map((x) => [x.id, x]));
        for (const ft of fresh.theses) {
          const m = ft && ft.isPublic ? mine.get(ft.id) : null;
          if (!m) continue;
          for (const k of PASS_FIELDS) { if (m[k] === undefined) delete ft[k]; else ft[k] = m[k]; }
        }
        data = fresh;
      }
      await env.LAB_STORE.put(key.name, JSON.stringify(data)); walletsWritten++;
      // Only now that the grade is durable. If the put throws we skip the fan-out and
      // the next pass re-resolves cleanly — better a late notification than a phantom
      // one for a grade that was never saved.
      const wallet = key.name.replace("lab:", "");
      for (const rz of justResolved) {
        await notifyResolution(env, wallet, rz.t, rz.outcome, rz.r);
      }
    }
  }
  await gc.flush();
  console.log(`[grade] resolved ${graded} calls (${regraded} older stamps re-derived) across ${walletsWritten} wallets · ${gc.pagesUsed()} candle pages`);
  return graded;
}

// `_unusedHorizonS` is kept only so existing callers' arguments still line up: the window is no
// longer a fixed horizon, it's each call's own (see below).
export async function computeCallerStats(env, _unusedHorizonS = 30 * 86400, opts = {}) {
  const onlyWallet = opts.onlyWallet ? String(opts.onlyWallet).toLowerCase() : null;
  const listed = await env.LAB_STORE.list({ prefix: "lab:" });
  const calls = [];
  for (const key of listed.keys) {
    const wallet = key.name.replace("lab:", "");
    // Single-wallet readouts (the process x-ray) skip every other wallet's KV read.
    if (onlyWallet && wallet.toLowerCase() !== onlyWallet) continue;
    const raw = await env.LAB_STORE.get(key.name);
    if (!raw) continue;
    let data; try { data = JSON.parse(raw); } catch { continue; }
    for (const t of (data.theses || [])) {
      if (t.isPublic && t.symbol && t.createdAt) calls.push({ wallet, t });
    }
  }
  // Each call is graded on the price from the hour it was posted. Every symbol's candle store
  // (gradeCandles.mjs, shared with the cron, the permalink and the share card) reaches back to that
  // symbol's OLDEST call. This used to be ONE fixed window per symbol, [now − 30d − 50h, now], so a
  // call older than that was graded on candles that started after it: an old WIN could read as a
  // LOSS, or drop out as pending. The stores live in KV (every run warms the same ones, which is
  // what fixed the old per-read Orderly starvation), grow within a page budget, and a call whose
  // window isn't loaded yet is left out of this read rather than graded on a partial one.
  const needs = {};
  for (const { t } of calls) {
    const sym = gradeSymbol(t.symbol), from = neededFrom(t.createdAt);
    if (!sym || from == null) continue; // not a market / not a real post time: never graded
    needs[sym] = Math.min(needs[sym] ?? from, from);
  }
  const gc = makeGradeCandles(env, { budget: opts.pageBudget ?? BOARD_PAGE_BUDGET });
  const stores = await gc.ensureAll(needs);
  await gc.flush();
  // Contrarian grading is OPT-IN (opts.contrarian) so the hot stance path — gatherStanceEntries
  // → computeCallerStats for merit weights — doesn't pay for the extra KV reads. Only the
  // leaderboard + the contrarians board ask for it. Stance history is keyed by BARE coin.
  const wantContrarian = !!opts.contrarian;
  const stanceHist = {};
  if (wantContrarian) {
    const coins = [...new Set(calls.map(({ t }) => bareCoin(t.symbol)))];
    await Promise.all(coins.map(async (coin) => { stanceHist[coin] = await readStanceHist(env, coin); }));
  }
  const byWallet = {};
  for (const { wallet, t } of calls) {
    const sym = gradeSymbol(t.symbol);
    const cd = sym ? callWindow(stores[sym], t.createdAt) : null;
    if (!cd) continue; // candles don't reach back to this call yet: not graded on this read
    const g = gradeCall(t, cd);
    if (g.outcome === "PENDING" || g.outcome === "INVALID") continue;
    const a = byWallet[wallet] || (byWallet[wallet] = { calls: 0, wins: 0, rSum: 0, resolved: [], regimeRows: [], planScored: [], expRows: [], _macro: [], _contra: { calls: 0, wins: 0, rSum: 0 }, _crowd: { calls: 0, wins: 0, rSum: 0 } });
    a.calls += 1; if (g.outcome === "WIN") a.wins += 1; a.rSum += g.r;
    // Track (time, R) so the leaderboard can emit a cumulative-R equity curve —
    // the same trustless grade, just as a series instead of an aggregate.
    a.resolved.push({ at: t.createdAt || 0, r: g.r });
    // Expectancy + conviction-calibration input. conviction = the trader's own size
    // proxy: how much of the account they put at risk (riskPercent), falling back to
    // the planned asymmetry (riskReward). Lets us ask "did the bigger bets win?".
    const conviction = Number(t.riskPercent) > 0 ? Number(t.riskPercent)
      : (Number(t.riskReward) > 0 ? Number(t.riskReward) : NaN);
    a.expRows.push({ r: g.r, win: g.outcome === "WIN", conviction });
    // MACRO sub-record: the SAME graded R, but only for event-driven calls (macro catalyst).
    // Powers the macro-caller leaderboard — verifiable macro track records, graded like any call.
    if (isMacroCall(t)) a._macro.push({ r: g.r, win: g.outcome === "WIN", conviction, category: (classifyMacro(t.catalyst || t.notes || "") || {}).category || null });

    // Attribute the SAME graded R to the regime the call was posted into. Same
    // candles, same first-touch outcome — this only asks "in which market?".
    const reg = classifyRegime(cd, Math.floor((t.createdAt || 0) / 1000));
    if (reg) a.regimeRows.push({ buckets: regimeBucketsOf(t.direction, reg), r: g.r, win: g.outcome === "WIN" });
    // Process grade: was the call well-formed at post time (public-verifiable half).
    const pq = planQuality(t, cd);
    if (pq) a.planScored.push(pq);

    // Contrarian attribution: was this call made AGAINST the crowd lean that PRECEDED
    // it, and did it pay? Same graded R, joined to the stance snapshot nearest-before
    // the post. Withheld (neither bucket) when there's no qualifying lean.
    if (wantContrarian) {
      const lean = stanceAtPost(stanceHist[bareCoin(t.symbol)], t.createdAt);
      const cls = classifyContrarian(t.direction, lean?.side);
      const bucket = cls === "CONTRARIAN" ? a._contra : cls === "WITH_CROWD" ? a._crowd : null;
      if (bucket) { bucket.calls += 1; if (g.outcome === "WIN") bucket.wins += 1; bucket.rSum += g.r; }
    }
  }
  for (const a of Object.values(byWallet)) {
    // Build the chronological cumulative-R series per wallet (a.rSeries).
    a.resolved.sort((x, y) => x.at - y.at);
    let run = 0;
    a.rSeries = a.resolved.map((c) => (run += c.r, Math.round(run * 100) / 100));
    a.regime = regimeBuckets(a.regimeRows);
    a.regimeEdges = {
      trend: regimeEdge(a.regime, "trend"),
      vol: regimeEdge(a.regime, "vol"),
      align: regimeEdge(a.regime, "align"),
    };
    a.plan = planSummary(a.planScored);
    a.regimeAttributed = a.regimeRows.length;
    // Expectancy-forward ranking + the conviction-calibration read.
    a.expectancy = expectancyStats(a.expRows);
    a.calibration = convictionCalibration(a.expRows);
    // Aggregate the macro record (null when the wallet has posted no event-driven calls).
    a.macro = a._macro.length ? {
      calls: a._macro.length,
      wins: a._macro.filter((x) => x.win).length,
      rSum: Math.round(a._macro.reduce((s, x) => s + x.r, 0) * 100) / 100,
      expectancy: expectancyStats(a._macro),
      categories: [...new Set(a._macro.map((x) => x.category).filter(Boolean))],
    } : null;
    if (wantContrarian) {
      a.contrarianRecord = aggregateSideRecord([a._contra]);
      a.withCrowdRecord = aggregateSideRecord([a._crowd]);
      a.contrarian = contrarianEdgeScore(a.contrarianRecord, a.withCrowdRecord); // ranked score or null
    }
    delete a.resolved; delete a.regimeRows; delete a.planScored; delete a.expRows; delete a._macro; delete a._contra; delete a._crowd; // internal only
  }
  return byWallet;
}

// Bare coin (BTC) from any thesis symbol shape — the join key for stance history.
const bareCoin = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

// Merit weight per earned tier — a standoff between two Apex callers should outrank
// two anonymous wallets. Shared by every surface that weights live stances.
const MERIT_WEIGHT = { APEX: 3, SHARP: 2, SIGNAL: 1 };

// Gather every current directional STANCE across the platform — open positions
// (agents + opted-in humans) and active (unresolved, fresh) public calls — each
// weighted by the wallet's EARNED merit tier. Extracted so the disagreement board
// (/theses/contested) and the per-symbol consensus lean (/theses/consensus) read
// the SAME universe of stances and can never drift. Symbols are returned BARE
// (BTC, not PERP_BTC_USDC) so they join the mispriced board's coin key.
// Returns { entries, byWallet } — byWallet is the graded record (reused for merit
// enrichment by the caller).
export async function gatherStanceEntries(env, { freshMs = 14 * 86400 * 1000, contrarian = false } = {}) {
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");
  // contrarian is opt-in (only the contested board wants it) so the consensus poll path
  // doesn't pay the extra stance-history reads.
  const byWallet = await computeCallerStats(env, 30 * 86400, { contrarian });
  const weightOf = (w) => {
    const r = rankCaller(byWallet[w?.toLowerCase?.()] || byWallet[w] || null);
    return r ? (MERIT_WEIGHT[r.tier] || 1) : 1;
  };
  const entries = [];
  const now = Date.now();

  // 1) Open positions (agents + opted-in humans) → directional stances.
  try {
    const usersRaw = await AGENT_KV.get("agent:users");
    const users = usersRaw ? JSON.parse(usersRaw) : [];
    const states = await Promise.all(users.map(async (w) => {
      const s = await AGENT_KV.get(`agent:state:${w}`);
      return { w, p: s ? (JSON.parse(s).current_position || null) : null };
    }));
    for (const { w, p } of states) {
      if (p && !p.paper && p.symbol && p.direction) entries.push({ wallet: w, symbol: bare(p.symbol), direction: p.direction, weight: weightOf(w), source: "position" });
    }
    const humanList = await AGENT_KV.list({ prefix: "live:human:", limit: 1000 });
    const snaps = await Promise.all(humanList.keys.map(async (k) => {
      const raw = await AGENT_KV.get(k.name);
      return raw ? { wallet: k.name.slice("live:human:".length), ...JSON.parse(raw) } : null;
    }));
    for (const sn of snaps) {
      for (const p of (sn?.positions || [])) {
        if (p.symbol && p.direction) entries.push({ wallet: sn.wallet, symbol: bare(p.symbol), direction: p.direction, weight: weightOf(sn.wallet), source: "position" });
      }
    }
  } catch (e) { console.error("[stances] live positions", e.message); }

  // 2) Active (unresolved, fresh) public calls → directional stances.
  try {
    const listed = await env.LAB_STORE.list({ prefix: "lab:" });
    for (const key of listed.keys) {
      const raw = await env.LAB_STORE.get(key.name);
      if (!raw) continue;
      let data; try { data = JSON.parse(raw); } catch { continue; }
      const wallet = key.name.replace("lab:", "");
      for (const t of (data.theses || [])) {
        if (!t.isPublic || !t.symbol || !t.direction) continue;
        if (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS") continue; // resolved → no longer a live stance
        if (t.status === "HIT_TP" || t.status === "STOPPED_OUT" || t.status === "INVALIDATED") continue;
        if ((now - (t.createdAt || 0)) > freshMs) continue; // stale
        entries.push({ wallet, symbol: bare(t.symbol), direction: t.direction, weight: weightOf(wallet), source: "thesis" });
      }
    }
  } catch (e) { console.error("[stances] active theses", e.message); }

  return { entries, byWallet };
}
