# Market stress hours · DRAFT, not registered

**Status (2026-10-30):** a draft for borst's review. Nothing here is registered, graded or traded. No outcome has been
computed: the check below counts hours and events only.

Code: `workers/nexus-lab-api/stressDraft.mjs` (nothing that trades or grades imports it; `stressDraft.test.mjs` fails if
the scoreboard, the brain, exec or lab-api do). Count: `node tools/explorers/stressCount.mjs <dir> [days]`.

## The question

Do the registered reads behave differently in the hours after the whole market delevers at once?

- **If some read does worse in stress,** an automatic per-read pause has a case. That pause would be a reviewed PR,
  never this page.
- **If none does,** the manual switch on `/ops/revenue` (PR #200) is all the breaker we need.
- **The answer must come from events after the registration date.** This week's cascade is already seen, so it decides
  nothing.

This is a **conditioner**, not a read. It never fires a trade. It labels hours, and the registered reads are graded in
and out of those hours as they are, unchanged.

## Why this definition

- **Recorded data only:** `oi:hist` (price, OI) and `candle:hist` on the nine main-card coins (`RECORDED_COINS`). We
  don't record exchange flows, cross-exchange spreads, stablecoin pegs, order-book depth or sub-hour bars, so none of
  those can be in it.
- **Market-wide, not per coin.** One coin's OI flush is already what `oi_div_reversal` reads. Stress is many coins doing
  it at once.
- **No news.** Headlines come late and can't be checked from here. The tape is the record.

## The rule, as frozen for review

All decided at hour h from data at or before h: the `oi:hist` row in hour h, and the candle that closed by h.

- **DELEVER:** at least **5 of the 9** coins have OI down **2% or more** over the last **4h**.
- **MOVE:** the median |4h return| across the coins ranks at or above the **90th percentile** of that same median over
  the prior 30 days. Mid-rank, ties count half, and it needs 15 days of history first.
- **A stress hour = DELEVER and MOVE in the same hour.**
- It needs at least 6 readable coins. An hour with fewer is not judged, and never counts as calm by default.
- It is stamped when its newest input row was written (a few minutes past h), never at the top of the hour. The
  no-lookahead test caught that once.
- **A read's event is "in stress"** if it lands within 24h after a stress hour: `[S, S + 24h)`.
- Stress hours closer than 24h apart are one **episode**. Episodes are reported, not used in the label.

**Counted beside the proposal, not part of it:**
- DELEVER alone.
- BTC shock: BTC's last closed hourly range at least 3× its 30-day median.

## Count-only check · 2026-10-30

The last 45 days to 2026-10-30T18:00Z. Judging starts 2026-09-15: the move rank needs 15 days of history and six
readable coins, and BNB, LINK and DOGE only started recording in late September. That gives **783 judged hours**.

**Read events** are the main card: the 11 coins the scoreboard grades, SUI on its holdout line only. They are counted
over the same 45 days. Each cell is events in a stress window / all events.

| Variant | Stress hours | Episodes | Hours in a 24h window | rsi_reset_deep | level_reclaim | oi_div_reversal | session_momentum | confluence_follow | oi_div_reversal_4h | oi_coil_break |
|---|---|---|---|---|---|---|---|---|---|---|
| **Proposed** (5/9 · OI −2% · move ≥ p90) | **17** | **8** | **228 (29%)** | 7/55 | 32/95 | 16/50 | 24/156 | 21/104 | 28/96 | 10/67 |
| OI −3% | 10 | 6 | 155 | 3/55 | 29/95 | 11/50 | 23/156 | 13/104 | 24/96 | 6/67 |
| Move ≥ p95 | 11 | 6 | 151 | 3/55 | 26/95 | 6/50 | 23/156 | 11/104 | 20/96 | 4/67 |
| Breadth 7/9 | 1 | 1 | 24 | 1/55 | 9/95 | 7/50 | 4/156 | 1/104 | 8/96 | 2/67 |
| DELEVER alone | 35 | 13 | 426 | 16/55 | 57/95 | 24/50 | 55/156 | 47/104 | 49/96 | 23/67 |
| BTC shock 3× alone | 31 | 10 | 399 | 15/55 | 54/95 | 34/50 | 111/156 | 51/104 | 63/96 | 34/67 |

**Proposed episodes** (start, UTC; stress hours in brackets): 09-24 17h (2) · 09-29 08h (1) · 10-11 17h (2) · 10-13 00h
(3) · 10-15 03h (2) · 10-19 00h (2) · 10-22 03h (1) · 10-29 16h (4).

**What the counts say:**
- **The proposal is not rare.** About 1.3 episodes a week, and 29% of judged hours sit in a window. This autumn was
  rough; a quiet stretch would cut both.
- **Breadth 7/9 is too strict.** One episode in 45 days can't be studied.
- **DELEVER alone is too loose.** About half of every read's events land in it, so "stress" stops meaning much.
- **BTC shock alone mostly marks the NY open.** 111 of 156 `session_momentum` events land in it. It reads the clock,
  not stress. I'd leave it out.
- **Time to 30 in-stress events,** at this autumn's pace, from the registration date:
  - `level_reclaim` ~6 weeks, `oi_div_reversal_4h` ~7;
  - `session_momentum` ~8, `confluence_follow` ~9;
  - `oi_div_reversal` ~12, `oi_coil_break` ~19;
  - `rsi_reset_deep` ~27 weeks, past the limit below. Expect no verdict for it.

## The study, if signed

- **Population:** each registered read's out-of-sample events on the main card that fall after both its own
  registration and this study's start date. The holdout coins form a separate line, shown and never pooled.
- **Label:** in stress or calm, by the rule above, frozen.
- **Outcome:** the read's own graded R as the scoreboard serves it (stop 1.2× H4 ATR-14, target 1.5×, 168h). The reads
  are not changed.
- **Statistic:** mean R in stress minus mean R in calm, per read.
- **Null:** shift the whole stress-hour series in time, 1,000 seeded shifts of at least 7 days each, wrapping inside the
  study span, and recompute. This keeps stress clustered the way it really comes. A plain label shuffle would treat 30
  events from two episodes as 30 independent draws. The p-value is two-sided.
- **Many reads, one bar:** Holm correction at 0.05 across the reads that get judged.
- **When:** each read is judged once, when it has 30 in-stress and 30 calm out-of-sample events. The limit is
  2027-04-30. A read short of 20 in-stress events at the limit gets **NOT ENOUGH STRESS**, with no verdict.
- **Verdicts:**
  - **WORSE IN STRESS:** Holm-significant, and its in-stress mean R is below 0. This licenses one reviewed PR that
    proposes pausing that read's live entries inside stress windows. Nothing switches on by itself.
  - **NO DIFFERENCE:** no automatic breaker for that read. The manual switch stays.
  - **BETTER IN STRESS:** nothing changes. It is never a licence to trade only in stress; that would be a new read,
    registered and graded first.
- **Append-only:** text above "Results" is pinned once registered, as for every study.

## What this can't tell us

- **Not why a read fails in stress.** It only says whether it does, on our nine coins, at hourly resolution.
- **Not fills.** R is graded from hourly prices. In a real cascade, slippage and gaps would be worse than that, so a
  read that looks fine in stress could still lose live. A breaker licensed here should lean safe.
- **Not the next crash.** Eight episodes a season isn't many. A verdict is about stress that looks like this autumn's.

## Decisions for borst before anything is dated

1. **The rule.** Sign the proposal (5/9 · OI −2% · move ≥ p90), or pick a row above. I'd sign the proposal. OI −3% and
   p95 halve the in-stress counts on the slower reads.
2. **The window after a stress hour.** 24h is proposed. 12h is sharper but slower to fill; 48h is the reverse.
3. **The bar.** 30 in-stress and 30 calm, judged once, limit 2027-04-30, Holm at 0.05.
4. **BTC shock:** drop it (it marks the NY open), or keep it as a second, separately registered label.
5. **Once signed,** it gets its own dated registration PR, with the rule moved unchanged into a registered module, and
   counts from the next UTC midnight.

## Results

(Append below once registered. Never edit above this line after that.)
