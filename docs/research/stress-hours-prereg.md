# stress_hours · a registered conditioner study

Registered 2026-10-30. borst reviewed the draft and its count-only check (`docs/research/stress-hours-draft.md`, PR
#201) and signed it as drafted:
- the rule as proposed;
- the 24h window;
- the 30/30 bar and the 2027-04-30 limit;
- the BTC-spike label dropped.

**Out-of-sample from 2026-10-31T00:00:00Z. Limit 2027-04-30.**

Everything above "Results" is fixed (sha256-pinned in `workers/nexus-lab-api/stressHours.test.mjs`). A changed rule is a
new registration under a new name.

## What it is, and what it is not

- **It is a conditioner, not a read.** It labels hours. It never fires a trade and changes no read. The seven reads
  below are graded exactly as the scoreboard grades them.
- **The question:** does a registered read grade differently in the 24h after the whole market delevers at once?
- **What a verdict can license:**
  - one reviewed PR proposing a per-read pause in stress windows;
  - or nothing: the manual live-entry switch (`/ops/halt`, PR #200) stays the only breaker.
- **What it can never license:**
  - trading only in stress;
  - inverting a read;
  - turning anything on by itself.

## Code

- **The rule:** `workers/nexus-lab-api/stressHours.mjs`. Constants `STRESS_RULE` and `STRESS_STUDY`; the stress hours
  come from `stressHours`, the labels from `stressLabel`. Moved unchanged from the draft. The two side variants counted
  in the draft (OI drop alone, BTC shock) are not registered.
- **Guards:**
  - `stressHours.test.mjs` pins this page and checks that the numbers here are the numbers in the code.
  - It checks for lookahead on a poisoned future.
  - It fails if the brain or exec import the study.
- **Count:** `node tools/explorers/stressCount.mjs <dir> [days]` (counts only).
- **The judging code** (the time-shift null below) is its own PR. It is built before any read reaches the bar, and it
  imports this rule unchanged.

## The rule

All decided at hour h from `oi:hist` on the nine main-card coins (`RECORDED_COINS`: BTC ETH SOL BNB XRP LINK DOGE AVAX
HYPE), using the rows in hour h and hour h−4. Same-hour semantics: the last row in an hour wins.

- **DELEVER:** at least **5 of the 9** coins have OI down **2% or more** over the last **4h**.
- **MOVE:** the median |4h return| across the coins ranks at or above the **90th percentile** of that same median over the
  prior 30 days. Mid-rank, ties count half; it needs 15 days of history (360 judged hours) first.
- **A stress hour = DELEVER and MOVE in the same hour.**
- The hour is judged only with at least 6 readable coins (a row at h and at h−4). An unjudged hour is never calm by
  default.
- A stress hour is stamped when its newest input row was written, never at the top of the hour.
- Stress hours closer than 24h apart form one **episode**. Episodes are reported; they are not used in the label.

## The labels

Each out-of-sample event of a read on the main card gets one label:

- **STRESS:** it lands within 24h after a stress hour, `[S, S + 24h)`.
- **CALM:** it is not STRESS, and at least 20 of those 24 hours (the 24 hours up to the event) were judged, so a stress
  hour couldn't have hidden in a gap.
- **UNJUDGED:** neither. Left out of the study.

## The population

- **The seven reads registered when this was signed:** `rsi_reset_deep`, `level_reclaim`, `oi_div_reversal`,
  `session_momentum`, `confluence_follow`, `oi_div_reversal_4h`, `oi_coil_break`. A read registered later is not in
  this study.
- **Out-of-sample events only:** after both the read's own registration and 2026-10-31T00:00:00Z.
- **Main card:** the 11 coins the scoreboard grades (SUI on its holdout line only).
- **Holdout line:** the holdout coins are labelled the same way, using the main-card stress hours, and shown beside the
  main line. They are never pooled into it.
- **Outcome:** the read's own graded R as the scoreboard serves it (stop 1.2× H4 ATR-14, target 1.5×, 168h).

## The test

- **Statistic, per read:** mean R of STRESS events minus mean R of CALM events.
- **Null:** shift the whole stress-hour series in time and relabel.
  - 1,000 shifts, seed 20261031, each at least 7 days, wrapping inside the study span (2026-10-31T00:00:00Z to the
    judging time).
  - Each event's judged/unjudged status stays fixed. Only STRESS vs CALM moves.
  - This keeps stress clustered the way it really comes. A plain label shuffle would treat 30 events from two episodes
    as 30 independent draws.
- **p-value:** two-sided, the share of shifts with a difference at least as far from 0 as the real one.
- **Many reads, one bar:** Holm correction at 0.05 across the reads judged.
- **When:**
  - Each read is judged once, the first time it has 30 STRESS and 30 CALM out-of-sample events.
  - At the limit (2027-04-30), a read with 20 or more STRESS events and 30 CALM events is judged as it stands.
  - A read with fewer than 20 STRESS events at the limit is **NOT_ENOUGH_STRESS**, with no verdict.
  - Holm runs over every read judged by the limit, in the order the p-values fall.

## Verdicts

- **WORSE_IN_STRESS:** significant after Holm, the STRESS mean R below the CALM mean R, **and** the STRESS mean R below 0.
  It licenses one reviewed PR proposing to pause that read's live entries in stress windows. Nothing switches on by
  itself.
- **NO_DIFFERENCE:** not significant. No automatic breaker for that read.
- **BETTER_IN_STRESS:** significant the other way. Nothing changes: it is never a licence to trade only in stress, which
  would be a new read, registered and graded first.
- **NOT_ENOUGH_STRESS:** see above.

## Count-only check at signing (2026-10-30, in-sample, decides nothing)

The last 45 days to 2026-10-30T18:00Z: 17 stress hours in 8 episodes, 228 hours inside a 24h window, of 783 judged.

| Read | Events | STRESS | CALM | UNJUDGED |
|---|---|---|---|---|
| `rsi_reset_deep` | 55 | 7 | 30 | 18 |
| `level_reclaim` | 95 | 32 | 61 | 2 |
| `oi_div_reversal` | 50 | 16 | 26 | 8 |
| `session_momentum` | 156 | 24 | 99 | 33 |
| `confluence_follow` | 104 | 21 | 63 | 20 |
| `oi_div_reversal_4h` | 96 | 28 | 54 | 14 |
| `oi_coil_break` | 67 | 10 | 56 | 1 |

- **Gaps.** UNJUDGED comes from gaps between older `oi:hist` rows. Since 2026-10-30, the brain writes one row per hour
  at the top of the hour (PR #199), so out-of-sample gaps should be rarer.
- **Expect some reads to finish without a verdict.** At this autumn's pace, `oi_coil_break` and `rsi_reset_deep` may
  not reach 30 STRESS events by the limit.
- **These counts are in-sample.** The cascade of 2026-10-29 is among them. Nothing here was graded, and none of it
  counts.

## Results

(Append below. Never edit above this line.)
