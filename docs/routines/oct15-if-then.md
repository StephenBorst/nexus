# Oct 15 · what each result triggers

Written 2026-10-04, eleven days before the read. **Sign-off: borst, pending.**

The re-validation routine reports on 2026-10-15 at 15:00 UTC. This page fixes, before the numbers exist, what
each result does. Nothing here changes code before then. A threshold that needs to change changes before Oct 15,
in a dated commit. After Oct 15 a changed threshold is a new page with a new date, never an edit to this one.

## Where it stands (scoreboard as of 2026-10-04 01:15 UTC)

| read | verdict | mean R | n | vs random entries | preset exit, out of sample (net per trade) |
|---|---|---|---|---|---|
| Basis × CVD (the live paper preset) | PREDICTIVE | +0.19 | 53 | 88%, leans above | 12h −36 bps (n14) · 24h −36 bps (n14) |
| Basis Extreme (paused) | PREDICTIVE | +0.02 | 457 | 65%, not distinguishable | 12h −16 bps (n67) · 24h −25 bps (n55) |
| Two-sided basis × CVD (staged, off) | PROMISING | +0.14 | 40 | 82%, leans above | 12h +46 bps (n9) · 24h +46 bps (n9), with the preset's exits |
| Basis × Smart | NOISE | 0.00 | 193 | 45% | none |
| Basis × Liq-Flush | NOISE | −0.01 | 145 | 52% | none |

Paper A/B since the clean start (2026-09-26 00:04 UTC): 12h control 3 trades +$5.11 · 24h arm 2 trades −$7.69 ·
nine-market arm 8 trades +$6.22. Parity is CLEAN on all three: the agent traded exactly what the scoreboard graded.

## Three words used below

- **Clears**: PREDICTIVE on R, BEATS_RANDOM (95% or more) on the side it trades, and the preset's own exit positive
  out of sample over at least 30 trades.
- **Holds**: PREDICTIVE on R and at least LEANS_ABOVE random, without clearing.
- **Fails**: PROMISING, NOISE, ACCRUING, NOT_DISTINGUISHABLE or BELOW_RANDOM.

Out of sample = the scoreboard's `oos` line: trades entered after 2026-09-25 04:00 UTC. Each verdict is read from
`GET /intel/axis-backtest` as served on Oct 15.

## What each result does

**1. Basis × CVD Stack, the /proof lead (paper)**
- Clears: stays the lead.
- Holds: stays the lead on paper. /proof says "leans above random, not an edge yet".
- Fails: comes off the lead the way Basis Extreme Fade did (`AXIS_PAUSED`: Load hidden, still graded). The paper
  wallets keep running as the control.
- Also comes off the lead, whatever the R verdict: both out-of-sample exit lines (12h and 24h) negative with at
  least 20 trades each. A read whose traded form loses out of sample is not the thing to lead with.

**2. 12h or 24h hold**
`tools/oct15/holdDecision.mjs` decides, unedited. INSUFFICIENT means keep 12h and let the window grow.

**3. The staged switches. Each stays off unless its own bar is met.**
- Basis Extreme Fade (paused): comes back only if its preset exit is positive out of sample over at least 30 trades.
- Basis × Smart preset (`OCT15_BASIS_SMART_LIVE`): on only if basis_x_smart grades PREDICTIVE, stable, and at least
  LEANS_ABOVE random.
- Basis × Liq-Flush: stays a manual option unless it grades PREDICTIVE and stable.
- Two-sided basis (`BASIS_TWO_SIDED_LIVE`): on only if basis_dev_x_cvd grades PREDICTIVE with its shorts at 0R or
  better over at least 30 samples, through the reviewed PR its parity guard requires.

**4. Live money**
None on Oct 15, whatever the result. If a read clears, the next step is a written live plan (size, daily cap, kill
switch, who signs) as its own dated PR. Arming stays borst's call, in person.

**5. The paid x402 feed (`nexus-signals`)**
Switches to basis reads (`BASIS_SIGNALS_LIVE`) only if the read it would sell clears. Otherwise it keeps the
current feed and its live grade label.

**6. The house caller and the Lab's FADE**
The house caller publishes only a read that clears. Until one does, it stays off. The Lab Board keeps its
"ungraded" label until the scoreboard grades the Board's exact rule.

**7. What we say**
- Clears: the read, the number of trades, the date. Nothing more.
- Holds: "Leans above random. Not an edge yet."
- Fails: "Graded in public. Nothing has cleared the bar yet."
- "Edge", "proven" and "validated" are for a read that clears, and only that read.

**8. The freeze**
Lifts when borst has read the routine's report and applied this page. First PR after it: the brain/exec 429
handling (a rate-limited tick is lost silently today). Then whatever this page triggered, one reviewed PR each.
