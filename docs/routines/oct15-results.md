# Oct 15 · the re-validation, read and applied

Read 2026-10-15 19:06 UTC. Applied the same day (borst: "apply the page").

The scheduled routine (`trig_01E1U5mnh4qcNMqFDxQKzJcx`) fired at 15:00 UTC and **failed after 37 seconds: usage limit
reached**. It wrote no report. The same checks were then run by hand, read-only, from the same public endpoints the
routine reads: `GET /intel/axis-backtest`, `GET /intel/evidence?axis=basis_x_cvd&hold=12|24`, `GET /agent/<addr>` and
`GET /agent/<addr>/parity?since=1790381056000` for the three paper wallets, `GET /signals/house` and
`GET /signals/catalyst-house`. The decisions below are the signed page (`oct15-if-then.md`, Oct 4), applied unedited.

## The reads

| read | R verdict | mean R | n | side | vs random | 12h exit, since Sep 25 | 24h exit, since Sep 25 | result |
|---|---|---|---|---|---|---|---|---|
| Basis × CVD (the /proof lead) | PREDICTIVE, stable | +0.19 | 62 | LONG | 97.3%, BEATS_RANDOM | −33.9 bps (n20) | −30.2 bps (n20) | HOLDS, off the lead (§1) |
| Basis Extreme (paused) | NOISE | −0.06 | 538 | LONG | 79.7%, not distinguishable | −47.6 bps (n121) | −56.6 bps (n101) | FAILS |
| Basis × Smart | NOISE | −0.03 | 204 | LONG | 56.3% | none | none | FAILS |
| Basis × Liq-Flush | NOISE | −0.07 | 179 | LONG | 70.7% | none | none | FAILS |
| Two-sided basis × CVD (staged, off) | PROMISING | +0.09 | 45 | L / S | L 96.3% · S 11.2% | +12.1 bps (n12, shadow) | +12.2 bps (n12, shadow) | FAILS |
| Two-sided basis | NOISE | −0.02 | 443 | L / S | L 79.5% · S 27.5% | none | none | FAILS |

How they moved: Sept 25 → Oct 15, mean R and n.
- Basis × CVD +0.31 (n35) → +0.19 (n62). Still PREDICTIVE and stable.
- Basis Extreme +0.13 (n315) → −0.06 (n538). PREDICTIVE → NOISE.
- Basis × Smart +0.14 (n141) → −0.03 (n204). PROMISING → NOISE.
- Basis × Liq-Flush +0.11 (n93) → −0.07 (n179). PREDICTIVE → NOISE.

Three of four basis reads did not hold as the sample grew. Basis × CVD is the one left standing, and its entries
beat random timing. The exits the preset trades (TP 2.5 / SL 2, 12h or 24h) lose that edge: its full exit grades are
NOISE at 12h (−7.2 bps, n48) and PROMISING at 24h (+20.4 bps, n47), and both are negative out of sample. The R grade
uses a different exit (1.2× H4 ATR stop, 1.5R target, 168h). Still long-only: 0 shorts in any basis × CVD event,
graded or paper. The tide was flat over the window (random long −0.01R, random short −0.02R), so this is not drift.

Evidence across 9 recorded markets (each on its own, pooled, correlated):
- 12h: −$4.38 · 56 trades · 48% win · PF 0.97 · beats 84.7% of random (leans above).
- 24h: +$43.94 · 55 trades · 56% win · PF 1.28 · beats 93.7% of random (leans above, ~9 more trades to separate).
- 24h is carried by XRP (+$48.65, 9T) and SOL (+$27.83, 5T). HYPE loses again (11T, 18% win, −$43.77, 9 of 11 stops).

## The paper wallets (since the clean start, 2026-09-26 00:04:16 UTC)

| wallet | hold | trades | win | net | exits | parity |
|---|---|---|---|---|---|---|
| 12h control `0x9A30…cB28` | 12h | 6 | 3/6 | +$5.50 | TP 2 · SL 1 · TIMEOUT 3 | CLEAN (6/6 matched) |
| 24h arm `0xa77c…a9a7` | 24h | 4 | 2/4 | −$15.19 | SL 2 · TIMEOUT 2 | CLEAN (2 misses, daily-loss cap) |
| 9-market 24h `0x325D…95DE` | 24h | 13 | 7/13 | +$10.05 | TP 5 · SL 5 · TIMEOUT 3 | CLEAN (14 misses, all explained) |

Configs match the preset on all three (PAPER, BASIS_FADE + CVD, TP 2.5 / SL 2, no `takeProfits`, watchlists set).
Every trade is LONG. Parity is CLEAN: the agent traded exactly what the scoreboard graded.

## What the page triggered

1. **Basis × CVD Stack comes off the /proof lead.** It holds (PREDICTIVE, beats random) but both out-of-sample
   exit lines are negative with ≥20 trades each (−33.9 bps n20, −30.2 bps n20). Done: `AXIS_PAUSED.basis_x_cvd`
   (Load hidden, still graded); the /proof hero now reads "Graded in public. Nothing has cleared the bar yet."
2. **Hold: INSUFFICIENT, keep 12h.** Exit lines have 20 / 20 out-of-sample trades (need 10), the 12h control has
   6 paper trades (need 5), the 24h arm has 4 (need 5). On the numbers it would not switch anyway: 24h leads by
   3.7 bps (needs 10) and its paper net per trade (−$3.80) trails the control's (+$0.92).
3. **Staged switches stay off.** Basis Extreme Fade stays paused (12h exit −47.6 bps over 121 out of sample). Basis ×
   Smart preset off (NOISE). Basis × Liq-Flush stays manual (NOISE). Two-sided basis off (PROMISING; shorts −0.25R
   over 18).
4. **Live money: none.**
5. **x402 feed keeps the current read and its live grade label.** Nothing cleared to sell.
6. **House and Catalyst callers: off, confirmed.** Both endpoints report `enabled: false`; the newest house call is
   2026-10-11 17:17:48 UTC.
7. **Words: "Graded in public. Nothing has cleared the bar yet."**
8. **The freeze lifts with this page applied.** First engine PR: the brain/exec 429 handling (#83).

Not run: the Lab clean-preset check (Test / Validate) needs a PRO wallet signature.

## Added 2026-10-16

**Lab clean-preset check (run by borst, Basis × CVD Stack as loaded, PRO signature).**
- Backtest, each market on its own: +$50.10, 63.2% win, 19 trades.
- As the agent trades it (one position at a time, daily caps): +$14.07 over 13 trades; 14 signals missed while the agent
  was busy or capped.
- vs random entries: beat 61.3% of replays. Not distinguishable from luck.
- Walk-forward: NOT ROBUST. 42% of folds positive; as traded −$9.37.

It agrees with the scoreboard: the preset as traded has no stable edge across time windows. It changes no decision here.
The graded-exit test (`docs/research/graded-exit-prereg.md`) is the open question.

**New-agent default: kept (borst).** New agents still start on the Basis × CVD Stack in PAPER. Revisit once the
graded-exit wallet has out-of-sample numbers.
