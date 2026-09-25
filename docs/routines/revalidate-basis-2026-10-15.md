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
- basis_extreme → signalMode BASIS_FADE (preset "Basis Extreme Fade"). Rule lives once in app/lib/basisFade.mjs; the scoreboard grades it and the agent trades it.
- basis_x_cvd → BASIS_FADE + basisConfirm:"CVD" (preset "Basis × CVD Stack" — the current Proof-page lead). Rule lives once in app/lib/basisStack.mjs; parity tests prove the live gate fires on exactly the hours/sides the scoreboard grades.
- basis_x_smart → BASIS_FADE + basisConfirm:"SMART" — wired and parity-tested the same way, but deliberately a MANUAL option only (no preset, no one-tap load) pending this re-validation.
- basis_x_liqflush → BASIS_FADE + basisConfirm:"LIQ" — wired and parity-tested the same way (Sept 25), also a MANUAL option only (no preset, no one-tap load, not in the sweep) pending this re-validation.
- BASIS_FADE is backtestable, sweepable and walk-forwardable in the Lab off recorded history (same shared rules, no lookahead). Those routes need a PRO wallet signature, so this routine cannot run them.

STRATEGY BASELINE (clean preset run, Sept 25, "Basis × CVD Stack" unedited, 33d of recorded history, fees in):
- Backtest (BTC/ETH/SOL): +$22.62, 78.6% win, 14 trades.
- Walk-forward (6 markets × 4 folds): NOT ROBUST — +$32.06, 4/6 markets green, 42% of folds positive (BNB had no trades; LINK 0/4 folds). Sample-limited, not a clean fail.

KNOWN MISMATCH — HOLD HORIZON (found Sept 25, keep an eye on it):
- Both wired presets exit on TP 2.5% / SL 2% / maxHoldHours 12. The Sept 25 per-horizon breakdown for basis_x_cvd graded 4h PREDICTIVE (+23.4 bps, 52%, n29, stable), 12h NOISE (-4.6 bps, 56%, n32, NOT stable), 24h PREDICTIVE (+168.3 bps, 76%, n25, stable). basis_extreme: 4h PREDICTIVE (+17.3), 12h PROMISING (+17.0, not stable), 24h PREDICTIVE (+80.3). So the presets time out in the one window where basis_x_cvd grades NOISE. The shape (+23 / -5 / +168) is non-monotonic at n≈30 per bucket, so it may be sampling noise — but it is a real live/graded mismatch.
- The headline R verdict is graded on a DIFFERENT exit from the presets: the frozen R contract (stop 1.2× H4 ATR, target 1.5R, 168h time-stop). So "PREDICTIVE in R" does not by itself validate the presets' exit.
- Since Sept 25 the scorecard also carries, per axis a preset trades, an `exit` block: the read traded through the PRESET'S OWN exit (TP/SL/max hold, first touch along the logged hourly candles, a bar touching both = stop, net of 3 bps/side fee) → {verdict, samples, hitRate, netBps, stable, exits:{TP,SL,TIMEOUT}, avgHoldH}. This is the grade that measures what the agent actually trades.
- The live "Basis × CVD Stack" paper run is deliberately left on 12h as the control group. Do not change it; judge it.

TASK:
1. Fetch the scorecard twice: GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=20' and GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=10' (curl via Bash; if that fails, try WebFetch). Each returns JSON with an `axes` array; each axis has {name, verdict, r:{samples,meanR,hitRate,maxDdR,stable}, best:{h,meanBps,hitRate,samples,stable}, horizons:[{h,samples,hitRate,meanBps,stable,verdict}] (4/12/24h), and — for basis_extreme and basis_x_cvd — exit:{preset,tpPercent,slPercent,maxHoldHours,verdict,samples,hitRate,netBps,stable,exits,avgHoldH}}. Verdicts rank PREDICTIVE > PROMISING > NOISE > INSUFFICIENT.
   Fallback: if BOTH methods fail (network/egress block, non-200, or non-JSON), STOP. Your final message must start with "BLOCKED — could not reach og.nexustradinglabs.com", include the exact error, and note that the cloud environment's allowed domains should include og.nexustradinglabs.com. Do NOT estimate, recall, or invent any numbers.
2. For basis_extreme, basis_x_cvd, basis_x_smart, basis_x_liqflush: report the CURRENT verdict, n, meanR, maxDdR and stability, in a table next to the Sept 14 and Sept 25 values above.
2b. For basis_extreme and basis_x_cvd: print the full `horizons` array (4/12/24h) AND the `exit` block, next to the Sept 25 per-horizon values above. State plainly whether 12h is still NOISE/unstable for basis_x_cvd, and what the preset-exit grade says (verdict, net bps, n, and the TP/SL/TIMEOUT mix — a mostly-TIMEOUT mix means the 12h cap, not the TP, is deciding the trades).
3. Judge each: (a) did basis_extreme hold PREDICTIVE on the longer window? (b) did basis_x_cvd keep its meanR and stability as n grew — i.e. is the Proof-page lead trading a read that survived? (c) did basis_x_smart recover stability or keep slipping? (d) did basis_x_liqflush stay PREDICTIVE and stable?
4. Recommend clearly, one line each: (i) keep, pause or drop each wired preset (Basis Extreme Fade, Basis × CVD Stack); (ii) whether basis_x_smart has earned a one-tap preset or should stay manual; (iii) whether basis_x_liqflush has earned a one-tap preset or should stay manual; (iv) HOLD HORIZON: if the preset-exit grade is NOISE while the 24h horizon stays PREDICTIVE, recommend testing a 24h-hold variant of the preset in the Lab (Load → maxHoldHours 24 → Test + Validate) against the 12h control run — as a recommendation for borst, not a change; if the preset-exit grade is PREDICTIVE and stable, say the 12h mismatch did not bite; (v) whether anything is robust enough to discuss moving from PAPER toward live. If any read DECAYED like past in-sample mirages (the pct98 / RV-v5 lessons — a lucky short window that didn't hold), say so plainly. Discipline over hope.
5. End with this reminder for borst: re-run the clean preset check in the Lab (scoreboard → Load "Basis × CVD Stack" → confirm TESTED AS "Basis × CVD Stack" → Test, then Validate, no edits) and compare against the Sept 25 strategy baseline above — the routine cannot run those itself.
6. Output a concise, structured report as your FINAL message (borst reads the run log). Do NOT modify code, open PRs, or arm any capital — everything stays PAPER until borst signs off in person.

Be honest and specific with the numbers. A null or declining result is a valid and valuable outcome — report it straight.
