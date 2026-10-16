# Explorer reads · DRAFT definitions (not registered)

**Status: DRAFT, written 2026-10-16. Nothing here is registered, built or graded.** borst weighs in on what each read
means from the trading side first ("that's my edge in this"). After that, each one becomes a registration under
`docs/research/read-pipeline.md`, with frozen parameters, a future `registeredAt`, and an entry in `REGISTERED_READS`.
Until then, editing this page freely is fine.

## Which of Ember's ten are new

Five are already on the scoreboard, graded on thousands of events (live grades, 2026-10-16):

| Ember's read | Already graded as | Live grade |
|---|---|---|
| Funding extreme fade | `funding_fade` | NOISE, −0.16R over 3,383 events; shorts worse than random (0%) |
| Liq cascade fade | `liq_flush` | NOISE, −0.03R over 3,532 events |
| CVD trend following | the mirror of `cvd_divergence` | NOISE, about 50% vs random on both sides, so the mirror is noise too |
| RSI mean reversion | `rsi_reset_deep` | PREDICTIVE (in-sample), **registered 2026-10-16** |
| Basis momentum | the mirror of `basis_extreme` | the fade beats 84% of random longs, so the mirror starts with a weak prior |

Re-registering these adds nothing unless borst means a different rule from the graded one. If so, say how it differs
and it gets its own name.

The five new ones are drafted below. Every one of them:
- uses only hourly data we already record (`oi:hist` price, OI and funding; `candle:hist` OHLCV),
- makes its decision on the bar's close, with no lookahead,
- fires at most once per coin per episode (a cooldown), so one move isn't counted many times,
- is graded on entries only, with the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h). Exits are a
  later stage.

## 1 · OI divergence reversal (`oi_div_reversal`)

**Draft.** Over the last 24h, price moved more than its own usual 24h move (above the 90th percentile of |24h
return| over the prior 30 days) **while OI fell at least 3%**. That move was positions closing, not new money. Fade it:
a rally on falling OI goes SHORT (shorts covering), a drop on falling OI goes LONG (longs capitulating). Cooldown 24h.

**For borst:**
- Is "divergence" OI falling into the move (above), or OI rising against it?
- The agent's own OI rule fades in two cases (price up with OI down, price down with OI up) but *follows* in the
  other two (both moving together), so "the agent's OI rule" isn't a reversal rule as written.
- Window: 24h, or 4h?
- How big must the OI drop be?

## 2 · Vol breakout momentum (`vol_breakout`)

**Draft.** Compression: the coin's hourly ATR-24 is in the bottom 20% of its own last 30 days. Breakout: an hourly
close above the highest high of the prior 24h goes LONG, or below the lowest low goes SHORT. Cooldown 24h.

**For borst:**
- Is "compression" required, or is any 24h breakout enough?
- Should a breakout need volume above normal?
- Is a close beyond the range the right trigger, or a retest of it?

## 3 · Session momentum (`session_momentum`)

**Draft.** NY open drive. If the move from 13:00 to 15:00 UTC is larger than the coin's median 2h move over the last 30
days, take that direction at the 15:00 close. One event per coin per day.

**For borst:**
- Which session: Asia (00–08 UTC), London (07–16) or NY (13–21)? Each one tested is a separate registration and adds
  to the family. Pick the one you believe in most.
- Is it the open drive (first 2h), or a continuation after a session high or low breaks?

## 4 · Level reclaim (`level_reclaim`)

**Draft.** The level is the prior UTC day's low (and high). If price trades below the prior-day low and an hourly bar
then *closes* back above it within 6h of the first breach, go LONG at that close. The mirror on the prior-day high
goes SHORT. One event per level per day.

**For borst (this is the one that needs your read the most):**
- Which levels: prior-day high/low, weekly open, 4H swing highs and lows, round numbers, or the weekly VWAP the
  scoreboard already computes?
- How far past the level must the sweep go (any trade through, or at least x% / x ATR)?
- How fast must the reclaim come?
- Is the entry on the reclaim close, or on a retest that holds?

## 5 · Confluence follow (`confluence_follow`)

**Draft.** The brain's own CONFLUENCE rule at its default thresholds (fundingThreshold 0.01%, oiChangeThreshold 0,
price and OI change measured hour over hour on `oi:hist`), traded the OTHER way: with the crowd, not against it.

The motive: the fade side of the funding read is worse than random on shorts (0% over 2,944 events). A read that is
reliably worse than random is **not** a licence to invert it. The inverse has its own fees and its own R asymmetry,
so it has to be graded as its own read. This registration is how that happens properly.

**For borst:**
- Should it follow the full CONFLUENCE rule, or funding alone?
- Is the default threshold right, or do you want extremes only (for example funding above its own 90th percentile)?

## Before any of these is registered

1. borst's definitions replace the drafts above.
2. **A count-only power check:** how often each rule *would have* fired over recorded history. Counts only, never
   outcomes. A rule that can't reach about 100 events in 60 days is pooled across more markets or dropped.
3. A registration doc, a future-dated `registeredAt`, and an entry in `REGISTERED_READS`, all in the same PR. The
   read's generator code goes in that PR too, and its first graded numbers are in-sample by construction.
