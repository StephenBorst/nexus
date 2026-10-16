# Explorer reads · definitions frozen, power-checked, four registered

**Status (2026-10-16):** borst signed off on four reads. level_reclaim, oi_div_reversal and session_momentum were
registered as written; confluence_follow was registered with a 24h cooldown. All four count from
2026-10-17T00:00:00Z and are registered in `docs/research/explorers-prereg.md`. **vol_breakout was dropped for v1**:
it would have fired 33 times in 60 days. session_momentum uses the same-window median. This page is the record of
how the five were defined and counted. It is not a registration.

The code is `workers/nexus-lab-api/explorerReads.mjs`. The count-only power check is `tools/explorers/powerCheck.mjs`.
`explorerReads.test.mjs` checks each rule on hand-built data, checks for lookahead on a poisoned tape, and fails if a
read is graded without being registered.

## Already graded (not re-registered)

| Ember's read | Graded as | Live grade, 2026-10-16 |
|---|---|---|
| Funding extreme fade | `funding_fade` | NOISE, −0.16R over 3,383 events; shorts worse than random |
| Liq cascade fade | `liq_flush` | NOISE, −0.03R over 3,532 events |
| CVD trend following | the mirror of `cvd_divergence` | NOISE, about 50% vs random on both sides |
| RSI mean reversion | `rsi_reset_deep` | registered 2026-10-16 (`rsi-reset-deep-prereg.md`) |
| Basis momentum | the mirror of `basis_extreme` | weak prior: the fade beats 84% of random longs |

## The five, as borst froze them

All five are graded on entries only, with the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h). Each
rule decides on the data up to and including its deciding bar. A candle read's event is stamped at that bar's close.

### 1 · `oi_div_reversal`
- Fires when the 24h move is extreme, meaning |24h return| is at or above the 90th percentile of |24h return| over
  the prior 30 days, **and** OI fell at least 3% over the same 24h.
- It fades the move: a rally on falling OI goes SHORT, a drop on falling OI goes LONG.
- A move with OI rising against it does not fire. Window 24h, cooldown 24h per coin.
- A 4h version would be a later registration.
- *How the code reads it:* 24h returns and OI change come from `oi:hist`, hour against the same hour a day earlier.
  The percentile is a mid-rank percentile, where tied values count as half below. The rule needs at least 15 of the 30
  prior days of returns.

### 2 · `vol_breakout`
- Compression is required: the hourly ATR-24 is in the bottom 20% of its own last 30 days.
- Breakout: an hourly close above the prior 24h high goes LONG, below the prior 24h low goes SHORT.
- No volume filter, entry on the close, cooldown 24h. A retest version would be a later registration.
- *How the code reads it:* compression is measured on the bar **before** the breakout bar, because the breakout bar's
  own range would inflate the ATR. The ATR is the mean true range over 24 contiguous bars. The percentile is mid-rank:
  a flat history ranks 0.5, so it counts as neither compressed nor extreme.

### 3 · `session_momentum`
- NY open drive only, 13:00–15:00 UTC.
- If the 2h move is larger than the coin's median 2h move over the prior 30 days, take that direction at the 15:00
  close. One event per coin per day.
- Not Asia, not London, and no session-range breakout in v1.
- *How the code reads it:* the move runs from the open of the 13:00 bar to the close of the 14:00 bar.
- **One open choice:** "the coin's median 2h move" can mean the same 13:00→15:00 window on each of the prior 30 days
  (`median: "same"`, the default) or every rolling 2h move over those 30 days (`"all"`). The NY open is livelier than
  an average 2h, so "all" sets a lower bar. Both counts are below.

### 4 · `level_reclaim`
- Uses the prior UTC day's high and low only.
- Sweep: price trades at least 0.4 × H4 ATR-14 beyond the level.
- Reclaim: an hourly close back through the level within 6h of the first breach. Entry is on that close.
- A reclaimed prior-day low goes LONG, a reclaimed prior-day high goes SHORT. One event per level per day.
- Not the weekly open, 4H swings, VWAP, round numbers, or a retest that holds, in v1.
- *How the code reads it:*
  - Only the day's **first** breach of each level is judged.
  - The ATR is the one known at the bar before the breach.
  - The 6h window is the breach bar plus the five after it, so a bar that sweeps and closes back counts.
  - The levels stay those of the day the breach happened, even if the window crosses midnight.

### 5 · `confluence_follow`
- The full CONFLUENCE rule (funding plus OI, at the brain's default thresholds: funding 0.01%, any OI move), traded the
  other way. Not funding alone, and not percentile extremes in v1.
- *How the code reads it:* it follows the brain's OI rule case by case, including that it *follows* when price and OI
  move together.
- One difference from live: price and OI change are measured row over row on `oi:hist` (hourly). The brain compares
  against a snapshot about 5 minutes old, which isn't recorded.
- **One open choice:** the definition has no cooldown, so every qualifying hour fires and a single funding episode is
  counted again and again. Both counts are below.

## Power check · 2026-10-16 (counts only)

The window is the last 60 days of recorded history. "Main" means the 11 main-card coins; SUI is now holdout-only.
"Gradeable today" is the number of events that land on an hour where the scoreboard has a price to grade from (an
`oi:hist` row).

| Read | Main: fired / gradeable today | Per coin per 60d | Holdout (8): fired | ~100 in 60d? |
|---|---|---|---|---|
| oi_div_reversal | 57 / 57 | 8.8 on coins with full OI history | 11 (only ZEC and PUMP have OI history yet) | **Borderline**: about 97 a period once all 11 main coins are recorded and warmed up |
| vol_breakout | 33 / 22 | 3.0 | 38 | **No**: about a third of the bar |
| session_momentum (same-window median) | 297 / 201 | 27 | 242 | **Yes** |
| session_momentum ("all" median) | 348 / 231 | 32 | 275 | Yes |
| level_reclaim | 108 / 65 | 9.8 | 128 | **Yes, just**, once the main coins' OI gaps are filled |
| confluence_follow (as written, no cooldown) | 898 / 898 | 82 | 75 | Counts pass, but runs of consecutive hours make the count overstate the evidence |
| confluence_follow (24h cooldown) | 134 / 134 | 12 | 17 | **Yes** |

What the counts say:
- **The main card was losing events.** The brain recorded `oi:hist` unconditionally for only 6 coins. ARB stopped on
  Sept 20 and WLD on Oct 13, DOGE, BNB and LINK only start in late September, and SUI on Oct 4. From this PR the brain
  records all 12 scorecard coins, so "gradeable" catches up with "fired" from now on. This is a recording-only change.
- `oi_div_reversal` needs at least 15 days of 24h returns, plus a day. Six of the 8 holdout coins started on Oct 16,
  so its holdout line can't fire before about Nov 1. At about 9 per coin per 60 days, it reaches 30 holdout events
  around late November.

## Decisions for borst before registering

1. **vol_breakout fails the check.** It reaches about a third of the bar. Drop it, or redefine it (for example a
   looser squeeze or a shorter range). A redefinition is a new definition, counted again.
2. **oi_div_reversal is borderline** at about 97 per 60 days, projected. Register it now and accept roughly 60–90 days
   to its first verdict, or wait two weeks for the recording to catch up and re-count.
3. **session_momentum:** same-window median (recommended, because it compares the NY open with itself) or every-2h
   median.
4. **confluence_follow:** a 24h cooldown (recommended, so one funding episode isn't counted as many events), or as
   written.
5. **level_reclaim passes**, and it was your first priority. It's ready to register once you sign it off.
