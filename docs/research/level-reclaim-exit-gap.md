# level_reclaim · the read grades positive, the trade loses · a pre-registered look at the gap

Written 2026-10-31, before any per-trade number is pulled. **Signed off: borst, Oct 31, 2026.**

Docs only. This page changes no rule, threshold, bar, preset, wallet or flag. It fixes the question, the candidate
explanations and the exact measurements before anyone looks, so the answer can't be fitted to the data afterwards.

Everything above "Results" is fixed once signed. A new idea found while reading the results is a new dated page.

## Why now

`level_reclaim` is a LEAD and the closest read to EDGE. The signed stage page (`docs/research/pipeline-if-then.md`) says
an Edge becomes Tradeable only if its graded exit nets above 0 after fees over 30+ out-of-sample trades. Today the read
and its trade disagree:

| line | n | result |
|---|---|---|
| R grade (main card, out of sample) | 53 events | +0.23R, halves agree, beats 91.7% of random |
| holdout coins | 38 events | +0.21R, beats 88.8% of random |
| graded exit, as traded (net of fees) | 24 trades | **−72.3 bps** per trade |

Source: `GET /intel/axis-backtest`, `pipeline.reads[level_reclaim].numbers`, 2026-10-31 17:47 UTC.

**What has been seen:** only the numbers in that table. No per-trade row, exit mix, hold time, stop width, side split
or funding line has been looked at for this read.

If nothing changes, it reaches EDGE and stalls there. The page we'd then publish says "beats random, can't be traded",
and nobody would know why.

## The two grades, from the code

They grade the same entries with the same stop and target. These are the only differences
(`workers/nexus-lab-api/axisbt.mjs`):

| | R grade (`gradeEventR`) | as traded (`scoreGradedExit` → `tradeableExitTrades` → `gradeEventExit`) |
|---|---|---|
| events counted | every out-of-sample event | only events ≥168h before the candle end (resolved), **one position per market** (an event while the last trade is open is skipped) |
| unit | R (each trade weighted by 1 / its stop width) | bps of price (each trade weighted by its stop width) |
| touched neither level in 168h | **0R** | **closed at the market** at 168h |
| fees | none | **6 bps per trade** (3 bps a side, `DEFAULT_FEE_BPS`) |
| funding | none | none in the headline; a separate informational line (`exitGraded.funding`) |

Ruled out by code, so not tested:
- **Entry price.** Both use the same hourly price (`priceByHour`).
- **Stop and target.** Both use 1.2× the same H4 ATR-14 and 1.5×, from the same function (`R_CONTRACT`, `gradedExitLevels`).
- **Same-bar ties.** Both take the stop when a bar touches both levels.

## The candidate explanations

**H1 · Fee drag on a small R.** The edge is real in R but too thin to pay costs.
- From the code, before any number: this line's fee is a fixed 6 bps per trade, so the fee step moves the mean by
  exactly 6 bps. **It cannot explain a gap of tens of bps.** It stays on the list because it's the first thing anyone
  suspects; the bridge below will show it as a 6 bps step.
- Where it still matters: cost in R = 6 bps ÷ the stop width in bps. On a tight stop that's a real slice of +0.23R.
  That's H2's question.

**H2 · Stop width against fixed costs, and the weighting behind it.** The R grade gives every trade one vote; bps gives a
wide-stop trade a bigger one. If wide-stop setups (volatile coins or hours) lose and tight-stop setups win, the mean R
is positive while the mean bps is negative, before any fee.

**H3 · Hold-time decay.** The read's move comes early and fades. Trades that touch neither level score 0R on the R grade,
but as traded they close at the market after 168h, and that drift is negative.

**H4 · Which events got traded (added).** The 24 trades are a subset of the 53 events: the oldest ones (resolved), and
one per market at a time. If those 24 grade worse in R too, the exit isn't the problem: the early events are.

**H5 · One side carries the loss (a breakdown, not a cause).** It's a two-sided read judged pooled. Every step below is
also shown for LONG and SHORT separately.

## The measurement: one bridge, on the same trades

Let **T** = the exact trades the graded-exit line counts (out of sample, same cutoff, same one-per-market rule). Let
**s̄** = T's mean stop width in bps. Walk from the R grade to the as-traded number one change at a time, in this fixed
order. Every step is in bps; an R value is put on the bps scale by multiplying it by s̄, so the steps add up exactly.

| step | what changes | value (bps) | its delta = |
|---|---|---|---|
| S0 | mean R, all out-of-sample events, × s̄ | R₀ × s̄ | |
| S1 | mean R, only the events in T, × s̄ | R_T × s̄ | **H4** (which events) |
| S2 | T's R-grade outcomes in each trade's own bps: TP = +1.5 × its stop, SL = −its stop, untouched = 0 | mean(Rᵢ × stopᵢ) | **H2** (weighting) = the covariance of R with stop width, exactly |
| S3a | T's untouched trades: 0 → their market close at 168h | | **H3** (hold-time decay) |
| S3b | any other difference between the two walkers | | expected **0**; otherwise a bug |
| S4 | minus 6 bps per trade | | **H1** (fees), exactly −6 |

S0 and S1 are also shown in R. S4 must equal the served `exitGraded.netBps` to within 1 bps. If it doesn't, or S3b isn't
0, the measurement is wrong. Stop: find it, fix it in its own PR, log it under "Measurement changes" in
`docs/research/read-pipeline.md`, and only then name a cause.

The order could decide the answer, so each of H2, H3 and H1 is also reported **alone**, applied directly to S1.

Shown beside the bridge, none of it part of the bar:
- **Exit mix on T:** TP / SL / TIMEOUT counts, and the mean bps of each group.
- **Stop width:** T split at its median stop %. For each half: n, mean R, mean bps, and mean cost in R (6 ÷ stop bps).
  This is H2 made visible.
- **Decay curve:** the read's own 4h / 12h / 24h forward returns (scoreboard horizons, gross bps, out of sample) beside
  T's 168h result. Positive early and negative by 168h = H3's shape.
- **Hold:** average hold of winners, losers and timeouts.
- **Funding:** `exitGraded.funding` on T, compared with its own `feesNetBps`, never with the headline.
- **Sides:** S0–S4 for LONG and SHORT.
- **Holdout:** the same bridge on the holdout coins' graded-exit trades. It replicates or it doesn't; it decides
  nothing on its own.

## How a cause is named (fixed now)

- **Gap** = S0 − S4, which is the sum of the steps.
- A step is **a cause** only if it is ≥ one third of the gap, has the same sign as the gap, and keeps that sign when the
  single largest-|bps| trade in T is dropped. With ~24 trades, one 5% stop on a volatile coin moves the mean by ~20 bps;
  this is the guard against that.
- More than one step can be a cause. None qualifying = "no single cause at this n". Say so, and wait.
- **Two pulls:**
  - **First pull**, after signing: descriptive. It names no cause and moves nothing.
  - **Second pull**, when T reaches 30 trades (the Tradeable bar's own count): applies the rule above. Its answer goes
    under Results.

## What each answer licenses

Nothing here touches the read's rule, its stage or the Tradeable bar. Out-of-sample means the read stays as frozen.

- **H4 (which events):** nothing. The gap is the early events, and more trades decide it. The Tradeable bar runs as
  written.
- **H2 (weighting):** the read picks direction but loses its money on wide stops.
  - Licenses: a dated note to borst on whether the bps bar is the right bar. My view: it is. Money is what trades, and
    the R grade is the kinder grade by design.
  - Any variant (e.g. skip the widest stops) is a new read: a new name, a new registration date, its own 30 events.
- **H3 (hold decay):** the 168h contract gives the move back.
  - Licenses: registering the same read with a shorter hold as a new read, graded from its own date.
  - Never retrofitted onto this one.
- **H1 (fees):** fixed at 6 bps, so by the one-third rule it can only be a cause if the gap is 18 bps or less. Then the question is maker execution (as the
  carry engine found: taker fees ≈ breakeven), written as its own page.
- **Measurement bug (S3b ≠ 0, or no reconciliation):** fixed first, logged as a measurement change. No cause is named
  on a broken ruler.

The live paper wallets, the presets, the house caller, x402 and live money are not touched by any outcome.

## How the numbers get pulled

The scoreboard serves aggregates only (`exits`, `avgHoldH`, `avgSlPercent`, `bySide`, `funding`), not T's rows. The
bridge needs per-trade rows, so it needs a read-only script:
- under `tools/`, importing the deployed `tradeableExitTrades`, `gradeEventR` and `scoreGradedExit` (never copies);
- reading the recorded series;
- printing the bridge;
- changing nothing served.

That script is its own PR after this page is signed, not part of this one.

## Results

_Empty until the first pull._
