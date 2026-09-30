# Pre-registration: does market structure improve the house funding fade?

**Registered 2026-09-30.** Status: registered. Replay not run.
Study id `structure-house-fade-v1`. Code: `app/lib/structure.mjs` (the structure read) and
`tools/structure-study/` (population, test, runner). The parameter block at the bottom is pinned to
that code by `tools/structure-study/prereg.test.mjs`. Change one without the other and CI fails.

Report only. Nothing live reads this study: no card, no stamp on calls, no gate, no agent, no worker.

## Why this exists

The house caller (Nexus Signals, `0xfc8c…3a52`) posts a funding fade. When a market's annualized
funding reaches 12%/yr, the market with the biggest stretch gets a call on the side the crowd is
paying against. Entry at mark, stop 3%, target 4% (1.33R). One call per market per 24h.

Its graded record: 163 calls, 64 wins (39%), −0.09R per call. Breakeven at 1.33R is 43%.

The proposal on the table: market structure (the weekly trend, 4H levels) could silence the fades
that fight it. This document fixes the question, the definitions and the decision rule before
anyone looks at structure on these calls. If the replay doesn't clear the bar written here,
structure does not gate the house caller. We don't fish a winner out of −0.09R.

This is not the Oct 15 re-validation. That routine tests the basis stack and is unchanged.

## The one question

Among graded house calls, do the fades that fight structure earn a different mean R from the fades
that don't, by enough to matter, reliably?

## Population

**Stage 1:** the 163 Nexus Signals house calls (`source: nexus-signal`, id `nexus-…`) posted before
**2026-09-30 00:00 UTC** and graded WIN or LOSS by the current grader (GRADE_V ≥ 3) when
snapshotted. Frozen in `tools/structure-study/population-stage1.json`; its sha256 is in the
parameters. The replay uses exactly these calls and these grades.

- Markets: ORDER 30, S 23, RAY 16, ETH 13, XMR 13, ENA 12, HYPE 9, ZEC 9, AVAX 6, PUMP 5, SOL 5,
  LINK 4, CL 3, 2 each POL, NEAR, WOO, USELESS, ONDO, 1 each XRP, TAO, INJ, XAG, JUP.
  75 longs, 88 shorts. Posted 22 Aug → 29 Sep 2026.
- Left out: the one manual call in that wallet (id `c7e0aab9…`, not a house call) and the 6 house
  calls still open at the snapshot (EURUSD 23 Aug, SPX500 24 Aug, USDJPY 5 Sep, NAS100 22 Sep,
  ETH 25 Sep, AVAX 29 Sep). They stay out even if they resolve later.
- Outcome = the graded R as stamped (+1.31 to +1.34 on a WIN, −1 on a LOSS). Nothing is re-graded.

## Definitions

Everything comes from the call's own market: Orderly perp 4H candles (public `/tv/history`,
resolution 240), the venue the calls are graded on. Only bars that had **closed** before the call
was posted are read: a 4H bar counts once its open + 4h ≤ the post time. Missing bars stay missing.
Nothing is interpolated.

**Weekly bias.** Weekly bars run Monday 00:00 UTC to Monday, built from the closed 4H bars. Only
weeks completed before the post count, and only the last 26 of them. A swing high is a week whose
high is strictly above the 2 weeks on each side (a swing low: low strictly below). It becomes the
reference level the week it is confirmed, 2 weeks later. Walking forward, a weekly close above the
reference high = BULL, a close below the reference low = BEAR; a reference is used up once broken.
No break in the 26 weeks = NEUTRAL. Fewer than 8 completed weeks = no weekly read.

**4H levels.** The same swing rule on 4H bars (2 bars each side, strict), over the last 180 closed
4H bars (30 days). Supply = the lowest swing high above the entry that no later 4H close has
cleared. Demand = the highest swing low below the entry that no later close has cleared.
ATR = the mean true range of the last 14 closed 4H bars.

**Counter-cycle** (the call fights structure) if either:
- **against the weekly bias:** a LONG under a BEAR week, a SHORT under a BULL week; or
- **into a 4H level:** a LONG whose entry sits within 1.0 × ATR below supply, or a SHORT whose
  entry sits within 1.0 × ATR above demand.

Everything else is **with structure**.

**Not classified** (left out of the test, counted in the report): fewer than 60 closed 4H bars
before the post (`h4_insufficient`), fewer than 8 completed weeks (`weekly_insufficient`), a zero
ATR (`flat_tape`), or the market's candles failed to load (`candles_unavailable`).

**Out of v1, on purpose:** EMA200 (Orderly's history is too short for a weekly one), order blocks,
fair-value gaps, 30m/1H/1D frames, basis or CVD overlays. Fewer knobs, fewer ways to find a winner
by accident.

## The test

gap = mean R (with structure) − mean R (counter-cycle).

Two-sided permutation test: shuffle the with/counter labels 10,000 times (mulberry32, seed 7, the
generator the backtest uses). p = (shuffles with a gap at least as large in size + 1) / 10,001.

## The decision rule

Structure may silence one side of the house fade only if **all** of these hold:

1. Each group has at least 30 classified calls.
2. |gap| ≥ 0.40R.
3. p ≤ 0.05.
4. The group that would be **kept** has a mean R above 0.
5. The gap has the same sign in the earlier and the later half of the calls (split at the median
   post time).
6. The gap keeps its sign with any one market left out.

gap ≥ +0.40R and all hold: stage 1 passes toward silencing counter-cycle fades.
gap ≤ −0.40R and all hold: it passes the other way. The fades **with** structure did worse, and
the counter-cycle ones would be kept. The test is two-sided because the record already hints at
that second case (see Disclosure).

Anything else is **NOT SHOWN**. A group under 30 is **INSUFFICIENT**. More than 10% of the calls on
markets whose candles failed to load is **VOID**: re-run, nothing decided.

Why 0.40R: on an even split of a −0.09R caller, a 0.40R gap is what lifts the kept half to about
+0.1R. Less than that doesn't change what the caller is.

## Power: what this sample can see

R here is almost binary (+1.33 / −1), standard deviation 1.14R. At 80% power and two-sided α 0.05,
this sample can see a true gap of about:

| split (with / counter) | smallest gap it sees | gap needed for p ≤ 0.05 |
|---|---|---|
| 82 / 81 | 0.50R | 0.35R |
| 50 / 113 | 0.54R | 0.38R |
| 40 / 123 | 0.58R | 0.41R |
| 30 / 133 | 0.65R | 0.45R |

A real effect smaller than that will most likely read NOT SHOWN. **NOT SHOWN means this sample can't
tell, not that structure is useless.** The report prints the figure for the split it actually gets.

The calls aren't independent. Markets move together, and the caller posts one call per pass. The
permutation test assumes exchangeable calls; the halves and leave-one-market-out checks are there
because that assumption is only approximately true.

## Stage 2: confirmation on new calls

Only a stage-1 pass gets a stage 2.

- Population: house calls posted **2026-09-30 00:00 → 2026-10-14 00:00 UTC**, graded when the
  replay reads them. Read on or after **2026-10-28 00:00 UTC**; the runner refuses earlier.
- Confirmed only if each group has at least 15 classified calls, the gap points the same way as
  stage 1 with |gap| ≥ 0.20R, and the kept group's mean R is above 0.
- If the house caller's rule changes inside that window, stage 2 is void.

## What happens after

- **NOT SHOWN, INSUFFICIENT, or stage 2 not confirmed:** structure does not gate the house caller.
  A structure map can still ship later as operator glass with no vote. That is a UI choice, not an
  edge claim.
- **Stage 1 pass and stage 2 confirmed:** a proposal, not a switch. A reviewed PR after the Oct 15
  freeze, dated here, built so a backtest can replay it (like the session and volatility filters,
  not like `respectRegime`, which the backtest skips).
- Either way: no stamp on calls, no overlay, no gate and no worker change before this report exists.

## Disclosure: what was already seen

Before registering, we saw the house record split by the grader's hourly regime stamp, a different
measurement from this one (164 calls in that wallet, the manual one included): against the trend
28 calls +0.25R, with the trend 15 calls −0.38R, chop 121 calls −0.13R. That is why the test is
two-sided. We also knew the per-market counts and the overall record above.

No structure read defined here has been computed on these calls. The code was written and tested on
synthetic tapes only, from a session that can't reach Orderly.

## Diagnostics (reported, never decisive)

The report also shows against-weekly-only, into-a-level-only, both and neither, and longs vs shorts
inside each group. No sub-split can pass this study. A sub-split that looks good becomes a new
dated registration, tested on calls posted after its own date.

## Running it

GitHub → Actions → **Structure study (report only)** → Run workflow → stage `1`. Run it once, after
this document is merged to main. The runner refuses if this block and the code disagree, or if the
population file changed.

The result (verdict, run link, commit, date) is appended under Results. Nothing above the Results
heading is edited after registration. New rules = a new document with a new date.

## Parameters

<!-- prereg-params -->
```json
{
  "id": "structure-house-fade-v1",
  "registered": "2026-09-30",
  "cutoffMs": 1790726400000,
  "population": {
    "wallet": "0xfc8c4f4e5ad8535571c199633aa1ec63e8f34a52",
    "source": "nexus-signal",
    "idPrefix": "nexus-",
    "minGradeV": 3,
    "outcomes": [
      "WIN",
      "LOSS"
    ]
  },
  "stage1": {
    "file": "tools/structure-study/population-stage1.json",
    "n": 163,
    "sha256": "8964d348345bdbd43b29931184723f74ca7b5343e17fd42c95cfb6c19a5686c0"
  },
  "candles": {
    "venue": "orderly-perp",
    "resolution": "240",
    "pageDays": 40,
    "weeksBefore": 28
  },
  "structure": {
    "fractalK": 2,
    "atrLen": 14,
    "zoneLookbackBars": 180,
    "zoneAtrMult": 1,
    "minH4Bars": 60,
    "weeklyWindow": 26,
    "weeklyMinWeeks": 8
  },
  "test": {
    "sided": "two",
    "permutations": 10000,
    "seed": 7,
    "alpha": 0.05,
    "minPerGroup": 30,
    "minGapR": 0.4,
    "survivorMeanAbove": 0,
    "halves": "same-sign",
    "leaveOneMarketOut": "same-sign",
    "maxFetchFailureShare": 0.1
  },
  "stage2": {
    "windowDays": 14,
    "readNotBeforeDays": 28,
    "minPerGroup": 15,
    "minGapR": 0.2,
    "survivorMeanAbove": 0
  }
}
```

## Results

_Not run yet._
