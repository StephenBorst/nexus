# trend_gate · a conditioner study (DRAFT, unsigned)

Drafted 2026-11-16 from borst's macro/micro note: "macro grants permission, micro times the trigger … when btc is under
its 4h 20 ema, macro hard-blocks longs." Before that gate gets power over a single entry, it is graded the way the
stress-hour study grades its conditioner (`stress-hours-prereg.md`).

**Unsigned. Nothing counts until borst signs.** Once signed, out-of-sample events count from the next 00:00 UTC, and the
limit is 6 months after that. Everything above "Results" is then pinned by sha256; a changed rule is a new registration
under a new name.

## What it is, and what it is not

- **It is a conditioner, not a read.** It labels events. It never fires a trade, changes no read, and no worker that
  trades imports it.
- **The question:** does a registered read grade worse when it trades against BTC's 4h trend than with it?
- **What a verdict can license:** one reviewed PR proposing that read's live entries be blocked against BTC's 4h trend.
  Or nothing.
- **What it can never license:** trading only against the trend, inverting a read, or switching anything on by itself.

## Code

- **The label:** `workers/nexus-lab-api/trendGate.mjs` (`btcTrendByHour`, `trendLabel`). It reads only BTC's recorded
  hourly tape (`candle:hist:PERP_BTC_USDC`), through `trend4hByHour`, the same rule `bb_rsi_momentum` and
  `shelf_breakdown_short` use.
- **Count:** `node tools/explorers/trendGateCount.mjs <dir> [days]` (counts only).
- **The judging code** (the time-shift null below) is its own PR, built before any read reaches the bar. It imports this
  label unchanged, the same way `stressGrading.mjs` imports the stress rule.

## The label

- **BTC's 4h trend at an event:** the last COMPLETE UTC 4h BTC bar (00, 04 … 20; all four hours present) that closed at
  or before the event's decision close. Its close is compared with the EMA-20 of complete 4h closes (seeded with the
  first 20 closes' average): above = UP, below = DOWN.
- **WITH:** a LONG while BTC trends UP, or a SHORT while it trends DOWN.
- **AGAINST:** the other way round.
- **UNLABELLED:** fewer than 20 complete 4h BTC bars, an exact tie, or BTC's tape missing at that hour. Left out of the
  study, never counted as either side.
- **Only BTC's trend, one variant.** The event coin's own 4h trend is not registered here: two variants would be two
  tests and a free choice between them after the fact.

## The population

- **Reads registered when this is signed, except four:**
  - `bb_rsi_momentum` and `shelf_breakdown_short` already require their own coin's 4h trend in the rule, so their split
    is mostly mechanical;
  - `session_fade_short` and `oi_div_reversal_4h_long` are one side of a parent already in the study, so they would be
    counted twice.
- **Out-of-sample events only:** after both the read's own registration and this study's start.
- **Main card** (`RECORDED_COINS`). The holdout coins are labelled the same way (with BTC's trend) and shown beside the
  main line, never pooled into it.
- **Outcome:** each event's own graded R as the scoreboard serves it (stop 1.2× H4 ATR-14, target 1.5×, 168h).

## The test

- **Statistic, per read:** mean R of WITH events minus mean R of AGAINST events.
- **Null:** shift BTC's whole trend series in time and relabel.
  - 1,000 shifts, at least 7 days each, wrapping inside the study span; seeded (mulberry32, as the stress judge).
  - Each event's side and R stay fixed; only the label moves.
  - This keeps trends lasting as long as they really do. A plain label shuffle would treat 30 events from one downtrend
    as 30 independent draws.
- **p-value:** two-sided, the share of shifts with a difference at least as far from 0 as the real one.
- **Many reads, one bar:** Holm correction at 0.05 across the reads judged.
- **When:**
  - Each read is judged once, the first time it has 30 WITH and 30 AGAINST out-of-sample events.
  - At the limit, a read with 20 or more events on its smaller side and 30 on the other is judged as it stands.
  - Fewer than 20 on either side at the limit = **NOT_ENOUGH**, with no verdict.

## Verdicts

- **AGAINST_WORSE:** significant after Holm, the AGAINST mean R below the WITH mean R, **and** the AGAINST mean R below 0.
  It licenses one reviewed PR proposing to block that read's live entries against BTC's 4h trend. Nothing switches on by
  itself.
- **LOWER_STILL_POSITIVE:** significantly lower against the trend, but its mean R is still ≥ 0. Licenses nothing (the
  stress study's ruling of 2026-11-04, carried over).
- **NO_DIFFERENCE:** not significant. No gate for that read.
- **WITH_WORSE:** significant the other way. Nothing changes. It is never a licence to trade only against the trend:
  that would be a new read, registered and graded first.
- **NOT_ENOUGH:** see above.

## Count-only check at drafting (2026-11-16, in-sample, decides nothing)

The last 60 days to 2026-11-16T07:00Z, main card, public `/agent/candle-history` + `/agent/oi-history`. BTC fell from
about 82k to about 64k in this window, so most hours were a BTC 4h downtrend.

| Read | Events | WITH | AGAINST |
|---|---|---|---|
| `level_reclaim` | 121 | 6 | 115 |
| `level_reclaim_tight` | 63 | 2 | 61 |
| `oi_div_reversal` | 75 | 17 | 58 |
| `oi_div_reversal_4h` | 147 | 67 | 80 |
| `session_momentum` | 194 | 88 | 106 |
| `session_fade` | 194 | 106 | 88 |
| `confluence_follow` | 145 | 56 | 89 |
| `oi_coil_break` | 89 | 51 | 38 |
| `btc_lead_lag` | 145 | 87 | 58 |

- **Not countable on the public series:** `rsi_reset_deep`, `spot_absorb` (starts 2026-11-20), `funding_basis_split`
  (basis) and `smart_consensus_2x` (smart-money rows). They are in the study; their counts arrive with the scoreboard.
- **What the count already says, before any grade:** `level_reclaim` traded against BTC's trend 95% of the time in a
  down market. That is the read whose longs graded well. A gate switched on by intuition would have turned most of it
  off. That is why this is a study first.
- **Expect some reads to finish without a verdict.** In a one-way market one side fills slowly: `level_reclaim` had 6
  WITH events in 60 days. A read can stay NOT_ENOUGH until the market turns.
- **These counts are in-sample.** Nothing here was graded, and none of it counts.

## Sign-off

- [ ] borst: the BTC-only label, the population (with its four exclusions), the 30/30 bar, the 6-month limit and the
  verdicts as written.

## Results

(Append below once signed. Never edit above this line after signing.)
