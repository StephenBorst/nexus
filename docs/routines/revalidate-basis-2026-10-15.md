# Routine prompt — "Re-validate Nexus engine — basis + conditioner stack"

Routine: `trig_01E1U5mnh4qcNMqFDxQKzJcx` · fires 2026-10-15 15:00 UTC · edit at
https://claude.ai/code/routines/trig_01E1U5mnh4qcNMqFDxQKzJcx (only the owner can edit it —
it was created outside an agent session). Paste everything below the line as the prompt.

Network: `og.nexustradinglabs.com` is allowlisted in the cloud environment (verified 2026-09-25 —
a cloud container fetched the scorecard, HTTP 200). The prompt keeps a BLOCKED fallback in case
the policy ever changes.

---

Re-validate the Nexus trading engine's edge on now-matured data. You run in the cloud with no access to local files — everything you need is in this prompt.

HISTORY OF THE READS (from the public scorecard, GET /intel/axis-backtest?min=20):
- Sept 14 2026 (basis:hist ~3 weeks old): funding_fade = NOISE (meanR -0.27). basis_extreme = PREDICTIVE, meanR +0.07, n=209, maxDdR 42. basis_x_smart = PREDICTIVE, meanR +0.17, n=98, maxDdR 22. basis_x_cvd = PREDICTIVE, meanR +0.15, n=26 (thin), maxDdR 5.5. basis_x_liqflush = PROMISING, meanR +0.15, n=60, maxDdR 11.5.
- Sept 25 2026 checkpoint (same endpoint, R-graded): basis_extreme = PREDICTIVE, meanR +0.13, n=315, maxDdR 42, stable. basis_x_cvd = PREDICTIVE, meanR +0.31, n=35, maxDdR 5.5, stable. basis_x_liqflush = PREDICTIVE, meanR +0.11, n=93, maxDdR 13, stable. basis_x_smart = PROMISING (slipped), meanR +0.14, n=141, maxDdR 28, NOT stable.

WHAT IS WIRED TO THE AGENT (all PAPER — nothing live):
- basis_extreme → signalMode BASIS_FADE (preset "Basis Extreme Fade"). PAUSED Sept 25: its 12h preset exit graded NOISE (−10 bps, n148) and the 24h exit only PROMISING/unstable, so /proof no longer offers its one-tap Load (the scoreboard keeps grading it). Judge whether it has earned its way back. Rule lives once in app/lib/basisFade.mjs; the scoreboard grades it and the agent trades it.
- basis_x_cvd → BASIS_FADE + basisConfirm:"CVD" (preset "Basis × CVD Stack" — the current Proof-page lead). Rule lives once in app/lib/basisStack.mjs; parity tests prove the live gate fires on exactly the hours/sides the scoreboard grades.
- basis_x_smart → BASIS_FADE + basisConfirm:"SMART" — wired and parity-tested the same way, but deliberately a MANUAL option only (no preset, no one-tap load) pending this re-validation.
- basis_x_liqflush → BASIS_FADE + basisConfirm:"LIQ" — wired and parity-tested the same way (Sept 25), also a MANUAL option only (no preset, no one-tap load, not in the sweep) pending this re-validation.
- BASIS_FADE is backtestable, sweepable and walk-forwardable in the Lab off recorded history (same shared rules, no lookahead). Those routes need a PRO wallet signature, so this routine cannot run them.

STRATEGY BASELINE (clean preset run, Sept 25, "Basis × CVD Stack" unedited, 33d of recorded history, fees in) — PER-MARKET figures, SUPERSEDED for the backtest by the portfolio replay block below:
- Backtest (BTC/ETH/SOL): +$22.62, 78.6% win, 14 trades.
- Walk-forward (6 markets × 4 folds): NOT ROBUST — +$32.06, 4/6 markets green, 42% of folds positive (BNB had no trades; LINK 0/4 folds). Sample-limited, not a clean fail.

KNOWN MISMATCH — HOLD HORIZON (found Sept 25, keep an eye on it):
- Both wired presets exit on TP 2.5% / SL 2% / maxHoldHours 12. The Sept 25 per-horizon breakdown for basis_x_cvd graded 4h PREDICTIVE (+23.4 bps, 52%, n29, stable), 12h NOISE (-4.6 bps, 56%, n32, NOT stable), 24h PREDICTIVE (+168.3 bps, 76%, n25, stable). basis_extreme: 4h PREDICTIVE (+17.3), 12h PROMISING (+17.0, not stable), 24h PREDICTIVE (+80.3). So the presets time out in the one window where basis_x_cvd grades NOISE. The shape (+23 / -5 / +168) is non-monotonic at n≈30 per bucket, so it may be sampling noise — but it is a real live/graded mismatch.
- The headline R verdict is graded on a DIFFERENT exit from the presets: the frozen R contract (stop 1.2× H4 ATR, target 1.5R, 168h time-stop). So "PREDICTIVE in R" does not by itself validate the presets' exit.
- Since Sept 25 the scorecard also carries, per axis a preset trades, TWO exit blocks graded the way the agent trades (one position per market, first touch of TP/SL along the logged hourly candles, a bar touching both = stop, net of 3 bps/side fee, both on the same entry window): `exit` = the preset's own 12h exit, and `exit24h` = the same TP/SL with a 24h hold. Each is {verdict, samples, hitRate, netBps, stable, exits:{TP,SL,TIMEOUT}, avgHoldH, oos:{since, samples, hitRate, netBps}}. `oos` counts ONLY trades entered after 2026-09-25 04:00 UTC — the moment 24h was picked from this very data. The in-sample 24h grade flatters 24h by construction; the `oos` line is the honest test.
- Exit-grade baseline (Sept 25, 07:26 UTC, min=20, one position per market): basis_x_cvd — 12h preset exit PROMISING +11.9 bps net, 50% win, n28, NOT stable, TP4/SL5/TIMEOUT19; 24h exit PREDICTIVE +57.8 bps net, 63% win, n27, stable, TP11/SL8/TIMEOUT8. basis_extreme — 12h preset exit NOISE -10.0 bps, 45%, n148, TP25/SL33/TIMEOUT90; 24h exit PROMISING +6.4 bps, 52%, n127, NOT stable, TP41/SL45/TIMEOUT41. oos = 0 trades for all (cutoff was just set).
- 24h VARIANT LAB RUN (borst, Sept 25 — "Basis × CVD Stack" with ONLY maxHoldHours 12→24, 33d of recorded history, fees in):
  - Backtest (BTC/ETH/SOL): +$31.35 net, 84.6% win, 13 trades (BTC 2T/100%/+$5.43 · ETH 7T/71.4%/+$7.73 · SOL 4T/100%/+$18.19).
  - Walk-forward (6 markets × 4 folds): NOT ROBUST — +$45.46 net, 4/6 markets green, 42% of folds positive (BTC +$5.43 1/4 folds · ETH +$7.73 3/4 · SOL +$18.19 3/4 · BNB $0 0/4 · XRP +$14.59 3/4 · LINK −$0.48 0/4).
  - Read: better capture than the 12h baseline (backtest +$22.62 → +$31.35; walk-forward +$32.06 → +$45.46), but the robustness verdict is unchanged (still NOT ROBUST, same 4/6 markets, same 42% folds) and the sample is tiny (13 trades). It was run on the same in-sample window the 24h idea came from.
- FORWARD PAPER A/B (started Sept 25): two PAPER wallets, identical config (BASIS_FADE + basisConfirm CVD, BTC/ETH/SOL, TP 2.5 / SL 2) differing ONLY in maxHoldHours:
  - 12h control: 0x9A3012988d60D61b34660BE06a321F7BF7bCcB28
  - 24h variant: 0xa77ca113f39405b50617c2cc9ba5d6e3ced4a9a7
  - THIRD ARM (breadth, added Sept 25): 0x325da3ed024f533764407524918a847bcb3f95de — PAPER, BASIS_FADE + CVD, 24h
    hold, TP 2.5 / SL 2, 5x, $50, 3/day, $10 daily stop, intended to trade ALL nine mature markets (BTC ETH SOL XRP HYPE
    BNB DOGE AVAX LINK). Ledger reset 2026-09-25T23:09:29Z (`paper_reset_at` 1790377769735) — use THAT as its parity
    `since`, not the A/B's 07:35Z. ⚠️ At setup its `config.symbols` was EMPTY, and the brain only evaluates the listed
    symbols (empty = trades NOTHING, not "all"). If `symbols` is still empty on Oct 15, report "third arm never traded
    (empty watchlist)" — do NOT read its zero trades as the strategy sitting out.
  Both paper ledgers were RESET on Sept 25 so the forward record is clean (the prior CONFLUENCE-era ledgers are archived in the repo, docs/paper-archive/). Read them with the PUBLIC GET https://og.nexustradinglabs.com/agent/<address> (no signature needed): state.paper_agg = lifetime since reset {trades,wins,losses,grossWin,grossLoss,net,firstTradeAt,lastTradeAt}; state.paper_trades = last ≤50 trades (symbol, side, entry_price, exit_price, pnl, exit reason, opened_at, closed_at).
  Config note: the 12h control also carries fundingPercentileMin 95 — a leftover that the brain applies ONLY to FUNDING_ONLY / CONFLUENCE, so it is inert on BASIS_FADE. Both wallets carry maxSignalAgeSec 180 (latency guard, delays entries by minutes at most). Neither changes which trades are taken.
  LIVE-vs-GRADED PARITY: GET https://og.nexustradinglabs.com/agent/<address>/parity?since=2026-09-25T07:35:00Z (public, no signature). Pairs every paper entry with the scoreboard event it traded and lists every graded event the agent was free to take but didn't → verdict CLEAN / DRIFT / UNVERIFIABLE / NO_DATA, with counts {entries, events, matched, unmatchedTrades, missedExplained, missedUnexplained}, the matched pairs (lagMin), unmatchedTrades (with reason) and missed.explained (codes HOLDING / BUSY / COOLDOWN / DAILY_TRADES / DAILY_LOSS / OTHER_MARKET) vs missed.unexplained. Always pass since= explicitly (the ledgers were reset before the endpoint stamped reset times).
  Guard: if a wallet's paper_agg.firstTradeAt is before 2026-09-25T07:35:00Z, the reset did NOT happen — say so, and count only paper_trades with opened_at on/after that time (paper_agg is then contaminated and must not be used).
- PORTFOLIO REPLAY SUPERSEDES THE SEPT 25 BACKTEST BASELINES (Ember, Sept 25, "AS THE AGENT TRADES IT" — one position across markets, daily caps; same presets, same 33d, fees in):
  - 12h control: +$14.18, 80% win, 10 trades, PF 3.14. (Old per-market headline +$22.62 / 14 trades — the gap is phantom simultaneous trades: 9 signals arrived while already in a position, 1 lost to another market the same hour.)
  - 24h variant: +$14.36, 77.8% win, 9 trades, PF 3.39. (Old per-market headline +$31.35 / 13 trades; 11 signals un-takeable: 10 in-position, 1 lost to another market.)
  - 12h vs 24h is a WASH in backtest. The 24h's old edge was phantom overlap from longer holds. The hold decision rests on the forward paper A/B and the `oos` exit-grade lines, NOT the backtest.
  - Walk-forward verdict is still PER-MARKET (unchanged method, comparable): both NOT ROBUST — 12h +$32.06, 24h +$45.46 (per-market sums), 4/6 markets positive, 42% of folds positive. Since Sept 25 the walk-forward also reports a `portfolio` stream (the preset's own watchlist, one position at a time) with its own time folds; the Lab sweep is now RANKED by the portfolio net (per-market sum kept on hover).
- PORTFOLIO-RANKED BASIS SWEEP (Ember, Sept 25, 36 configs): Basis × CVD variants hold 5 of the top 8, green on 2–3 of 3 markets, winning across several TP settings. Top row is a Basis Extreme variant at +$21.85 but only 1/3 markets green (correctly ignored). Basis × Smart best is 9th. ⚠️ Read with care: all Basis × CVD rows share the SAME ~10 entry signals and differ only in the exit — "5 of the top 8" is mostly ONE fact (those entries were good over one 33d window). It proves the exits don't matter much; it does NOT by itself prove the entries carry an edge.
- RANDOM-ENTRY BASELINE (built Sept 25): the Lab backtest now reports "vs random entries: beat X% of 300 replays" — same markets, trade count, long/short mix and exits, only the entry TIMING random (seeded). BEATS_RANDOM ≥95% · LEANS_ABOVE ≥80% · else NOT_DISTINGUISHABLE; under 5 trades → TOO_FEW_TRADES. This is the test that separates "the signal picks good moments" from "the exits + market drift did the work".
- RANDOM-ENTRY BASELINE — FIRST READINGS (Sept 25, Lab, portfolio replay, BTC/ETH/SOL, 33d):
  - 12h control: beat 86.7% of 300 replays (random median $0.33) — LEANS_ABOVE; +$14.18 / 80% / 10T; walk-forward portfolio folds 3/4 positive; ~22 trades needed at this edge to reach 95%.
  - 24h variant: beat 79.3% (random median $1.13) — NOT_DISTINGUISHABLE (a hair under 80); +$14.36 / 77.8% / 9T; folds 4/4 positive; ~37 trades needed.
  - Read: neither decisive. The 24h's higher random median shows longer holds soak up drift any entry would catch — part of its P&L isn't timing. The 12h leaning further above random fits that.
- EVIDENCE ACROSS ALL RECORDED MARKETS (built Sept 25): public GET https://og.nexustradinglabs.com/intel/evidence?axis=basis_x_cvd&hold=12 (and &hold=24) — the preset's exact signal/exit replayed on EVERY market with mature recorded history (up to 12), each on its own, trades pooled, random-entry baseline on the pool. Returns {markets, marketsGreen, trades, netUsd, winRate, baseline:{verdict, pctBeaten, randomMedianUsd, tradesNeeded, moreTradesNeeded}, perMarket[], excludedSymbols}. ⚠️ Markets move together — the pool is an honest aggregate, not independent tests.
- EVIDENCE — FIRST READING (Sept 25, 9 markets with mature history, each on its own, 33d; ARB/SUI/WLD excluded as not yet mature):
  - 12h: +$8.13 · 30 trades · 53.3% win · PF 1.15 · green 5/7 traded · vs random 75.7% (NOT_DISTINGUISHABLE; random median −$13.37) · ~138 more trades needed.
  - 24h: +$52.27 · 29 trades · 62.1% win · PF 1.80 · green 6/7 traded · vs random 89.3% (LEANS_ABOVE; random median +$0.46) · ~22 more trades needed.
  - HYPE is the one consistent loser (8 trades, 25% win, −$28.83 at 12h / −$21.87 at 24h). Do NOT drop it from the set (that's curve-fitting) — note whether it keeps failing.
  - On the wider set the ranking FLIPS vs the 3-market reading (there 12h 86.7% > 24h 79.3%; here 24h 89.3% > 12h 75.7%). Noise still dominates the hold question. The 24h is the arm closest to a verdict (~22 more trades ≈ 3–4 weeks at the current pace across 9 markets).
- The live "Basis × CVD Stack" paper run is deliberately left on 12h as the control group. Do not change it; judge it.

TASK:
1. Fetch the scorecard twice: GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=20' and GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=10' (curl via Bash; if that fails, try WebFetch). Each returns JSON with an `axes` array; each axis has {name, verdict, r:{samples,meanR,hitRate,maxDdR,stable}, best:{h,meanBps,hitRate,samples,stable}, horizons:[{h,samples,hitRate,meanBps,stable,verdict}] (4/12/24h), and — for basis_extreme and basis_x_cvd — exit:{preset,tpPercent,slPercent,maxHoldHours,verdict,samples,hitRate,netBps,stable,exits,avgHoldH}}. Verdicts rank PREDICTIVE > PROMISING > NOISE > INSUFFICIENT.
   Fallback: if BOTH methods fail (network/egress block, non-200, or non-JSON), STOP. Your final message must start with "BLOCKED — could not reach og.nexustradinglabs.com", include the exact error, and note that the cloud environment's allowed domains should include og.nexustradinglabs.com. Do NOT estimate, recall, or invent any numbers.
2. For basis_extreme, basis_x_cvd, basis_x_smart, basis_x_liqflush: report the CURRENT verdict, n, meanR, maxDdR and stability, in a table next to the Sept 14 and Sept 25 values above.
2c. Fetch all THREE paper wallets (addresses above) and report side by side: trades, win rate, net P&L, exit mix (TP/SL/TIMEOUT), avg hold, and whether the config still matches (mode PAPER, BASIS_FADE, CVD, TP 2.5/SL 2, 12h vs 24h — flag ANY drift). Compare to the `oos` lines of `exit`/`exit24h`: paper fills and the graded exit should broadly agree; a large gap is a live/graded mismatch worth flagging. Expect few trades (the stack fires ~13×/month across 3 markets) — say how thin it is. For the third arm, also run `GET /agent/0x325da3ed024f533764407524918a847bcb3f95de/parity?since=1790377769000` and report
its per-market spread. ⚠️ EXIT CHECK: at setup all three wallets carried a leftover `takeProfits` scale-out
([1%×75%, 2%×25%]) which OVERRIDES `tpPercent` 2.5 in exec — so they traded a DIFFERENT exit than the graded contract
(single TP 2.5). If `takeProfits` is still set, say so and compare their exit mix against the graded exit with that caveat.
2d. Run the parity check on BOTH wallets (URL above, since=2026-09-25T07:35:00Z). Report verdict + counts for each. CLEAN = the live agent traded exactly what the scoreboard graded, so the paper A/B can be trusted. DRIFT = list every unmatched trade and every unexplained miss with timestamps — that is a live/graded mismatch and the 12h-vs-24h comparison must be read with it in mind (say which way it biases). Unmatched TRADES are the more serious kind (the agent traded something the grade never counted).
2e. Fetch the evidence endpoint for basis_x_cvd at hold=12 AND hold=24. Report for each: markets, marketsGreen, trades, netUsd, baseline verdict + pctBeaten + moreTradesNeeded, and which markets carry it (perMarket). Compare against the Sept 25 3-market readings above (12h 86.7%, 24h 79.3%). The question: does the signal beat random timing on the WIDER market set — i.e. does it work beyond BTC/ETH/SOL? If one or two markets carry the whole pool, say so (that's concentration, not breadth). Keep the correlation caveat in the verdict.
2b. For basis_extreme and basis_x_cvd: print the full `horizons` array (4/12/24h) AND both exit blocks (`exit` = 12h preset exit, `exit24h` = 24h exit), next to the Sept 25 baselines above. State plainly whether 12h is still NOISE/unstable for basis_x_cvd, what each exit grade says (verdict, net bps, n, TP/SL/TIMEOUT mix — a mostly-TIMEOUT mix means the hold cap, not the TP, is deciding the trades), and — most important — the `oos` line for each: how many trades since Sept 25 and their net bps. Weigh the 12h-vs-24h call on `oos` first; if `oos` n is under ~10, say the choice is still unproven rather than calling it.
3. Judge each: (a) did basis_extreme hold PREDICTIVE on the longer window? (b) did basis_x_cvd keep its meanR and stability as n grew — i.e. is the Proof-page lead trading a read that survived? (c) did basis_x_smart recover stability or keep slipping? (d) did basis_x_liqflush stay PREDICTIVE and stable?
4. Recommend clearly, one line each: (i) keep, pause or drop each wired preset (Basis × CVD Stack; and whether the PAUSED Basis Extreme Fade should stay paused, come back, or be dropped); (ii) whether basis_x_smart has earned a one-tap preset or should stay manual; (iii) whether basis_x_liqflush has earned a one-tap preset or should stay manual; (iv) HOLD HORIZON: the 24h Lab test has already been run (Sept 25 datapoint above) — do NOT recommend running it again. Note the portfolio replay made the backtest a WASH (+$14.18 vs +$14.36), so the backtest cannot decide this. Decide on: does basis_x_cvd's 24h horizon stay PREDICTIVE and 12h stay NOISE/unstable; does `exit24h` still beat `exit` on the full grade AND on the `oos` line (trades since Sept 25 — the only evidence the Sept 25 Lab run could not have seen); and what does the forward paper A/B (step 2c) show? Conclude one of: "24h edge held out of sample" (oos n ≥ ~10 and exit24h ahead on oos), "still unproven" (oos n too small), or "24h edge faded" (exit24h not ahead on oos) — a recommendation for borst, not a change; (v) whether anything is robust enough to discuss moving from PAPER toward live. If any read DECAYED like past in-sample mirages (the pct98 / RV-v5 lessons — a lucky short window that didn't hold), say so plainly. Discipline over hope.
5. End with this reminder for borst: re-run the clean preset check in the Lab (scoreboard → Load "Basis × CVD Stack" → confirm TESTED AS "Basis × CVD Stack" → Test, then Validate, no edits) and compare against the Sept 25 strategy baseline above — the routine cannot run those itself. Then repeat with ONLY maxHoldHours 12→24. Compare the "AS THE AGENT TRADES IT" block (not the per-market tiles) against the Sept 25 portfolio baselines: 12h +$14.18 / 10T, 24h +$14.36 / 9T; walk-forward verdict against NOT ROBUST (4/6 markets, 42% folds). Also read the "vs random entries" line on that block: Basis × CVD's lead only means something if it BEATS_RANDOM (≥95%) on the longer window — if it's NOT_DISTINGUISHABLE, the entries aren't adding information yet, whatever the P&L says.
6. Output a concise, structured report as your FINAL message (borst reads the run log). Do NOT modify code, open PRs, or arm any capital — everything stays PAPER until borst signs off in person.

Be honest and specific with the numbers. A null or declining result is a valid and valuable outcome — report it straight.


## Sept 25 finding — read before judging any basis number
- Every basis_x_cvd trade in the evidence replay (30/30, both holds) was LONG. The OKX perp trades at a persistent
  discount to spot, so the rule's "extreme" is always the deepest discount → always LONG. The short side never fires.
- So a PREDICTIVE basis read here means "buying the widest discount beats random longs", not a two-sided fade.
  If the market trended down between Sept 25 and Oct 15, expect the basis reads to weaken for THAT reason — say so.
- Check: in `GET /intel/evidence?axis=basis_x_cvd&hold=24`, `perMarket[].diag.longs/shorts`. If shorts is still 0,
  repeat this caveat in the recommendation.
- HYPE: data clean; it loses on stops (stop ≈ 2 typical hourly ranges). Don't drop it; note `diag.stopInRanges`.
- NEW axes since Sept 25 (graded only, no preset): `basis_dev` + `basis_dev_x_cvd` = the TWO-SIDED basis (extreme vs
  the market's usual level, so it can short). Report them beside basis_extreme / basis_x_cvd: verdict, samples, and
  whether both sides fired. If basis_dev_x_cvd grades PREDICTIVE with shorts in the sample, flag it as the candidate
  to wire next — don't recommend swapping the live preset on one read.
- FIRST READ (Sept 25 22:25 UTC, same data as the others, 12 coins):
  - basis_dev_x_cvd: PREDICTIVE (R +0.27, n32, stable) · 4h PREDICTIVE +23.7bps n27 stable · 12h PROMISING +18.7 n27 ·
    24h PROMISING +80.9 n22. (vs basis_x_cvd: R +0.27 n37 · 12h NOISE −4.6 · 24h PREDICTIVE +168.3 n25.)
  - basis_dev: PROMISING (R +0.05, n288, NOT stable) · 24h PREDICTIVE +59.2 n230 (vs basis_extreme R +0.15 n329 stable).
  - Sides (last 72h per coin, 9 coins with history): two-sided fired 10 LONG / 11 SHORT; the old rule 20 LONG / 0 SHORT.
    The short side is real. No exit grade on the new axes (no preset trades them).
- Since Sept 25 the scorecard carries LONG/SHORT splits on every axis (`sides`, `horizons[].bySide`, `exit.bySide`), and
  basis_dev_x_cvd has a SHADOW exit grade (`exit`/`exit24h` with `shadowOf:"basis-cvd-stack"`). Report, for basis_x_cvd vs
  basis_dev_x_cvd: shorts' R vs longs' R, and the 12h/24h exit grades + `oos` side by side. A candidate needs its SHORTS
  to hold up on their own, not just be carried by the longs.
- FIRST PER-SIDE READ (Sept 25 22:41 UTC):
  - basis_dev_x_cvd: longs R +0.50 (n18, 56%) · shorts R −0.04 (n14, 36%). The pooled PREDICTIVE is carried by the longs.
    Shadow exit 12h: L +18.4 n14 · S +27.3 n10 · 24h: L +120.1 n14 · S −75.6 n11.
  - basis_dev: longs R +0.19 (n139) · shorts R −0.07 (n149). Shorts negative at 4h/12h, ~flat at 24h (+6.0bps n119).
  - basis_extreme: 1 short in 437 events (R −1). basis_x_cvd: 0 shorts in 37.
  - Read: on this 33d window the SHORT side of basis has no edge; every basis "edge" so far is long-side. Unresolved:
    how much of the long edge is just the window's upward drift (no unconditional drift baseline on the board yet).
    Oct-15 check: if shorts are still ≤0 R on ≥30 samples, the two-sided rule is not a candidate — say so plainly.
- Since Sept 25 every horizon carries `drift.excessBps` (move above the coin's own average drift) + `drift.bySide`. For
  the basis axes, report EXCESS, not raw bps: an edge that is ~0 above drift is the market, not the read.
- FIRST DRIFT READ (Sept 25 22:51 UTC). The window drifted UP: an average long on these coins made +6 / +14 / +23 bps
  at 4 / 12 / 24h. Excess = the read's move minus that (raw → excess):
  - basis_extreme 24h +89.6 → **+67.0 stable** (n259) · 4h +9.1 / 12h +5.5 unstable.
  - basis_x_cvd 24h +168.3 → **+144.7 stable** (n25) · **12h −4.6 → −20.5** (the live preset's hold) · 4h +6.4.
  - basis_dev 24h +59.2 → **+58.8 stable** (n230); its SHORTS at 24h: raw ≈ +6 but baseline −19 → **excess +25.3 (n119)**
    — the shorts looked flat only because the market rose; above drift they add value at 24h (−5.3 at 12h).
  - basis_dev_x_cvd 4h **+24.9 stable**, 12h **+17.8 stable**, 24h +84.7 unstable (n22–27; shorts +82.8 / +18.1 / −75.0).
  - Sanity rows: rsi_reset_held 24h raw +20.8 → excess −18.1 (a long-only read that was mostly drift) · funding_fade,
    liq_flush, cvd_divergence negative excess (confirmed noise).
  - Read: basis survives the drift test at 24h on the big samples. The 12h hold the live preset uses is where basis_x_cvd
    goes negative above drift. Decide the hold at Oct-15 on oos + paper A/B + these excess numbers together.
