# One-sided reads · session_fade_short and oi_div_reversal_4h_long (signed)

Written 2026-11-16 (borst: "yes do 1 and 2, write the rules pages and sign"). **Both signed by borst 2026-11-16**,
given in a Claude session. **Out-of-sample events for both start at 2026-11-17T00:00:00Z**, the next 00:00 UTC after
signing. Stages and bars are as in `docs/research/read-pipeline.md`, including the per-side rule added the same day
(`docs/research/pipeline-if-then.md`, "Each side on its own").

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why

From 17 Oct to 16 Nov 2026 the market fell (BTC −19.8% over the 30 days to 15 Nov). On the scoreboard of
2026-11-16 07:53 UTC a random short earned +0.20R a trade since 7 Aug and a random long lost 0.18R. Under that tide
most reads' shorts made money while trailing a random short, and most reads' longs lost money while beating a random
long. Two sides broke that pattern on both coin sets:

| Side | Main card, out-of-sample | Holdout, out-of-sample | Full history |
|---|---|---|---|
| session_fade, SHORT | 10 events, +1.50R, beat 98.5% of random shorts | 16 events, +1.19R, 97.3% | beat 100% |
| oi_div_reversal_4h, LONG | 48 events, −0.04R, beat 100% of random longs | 25 events, −0.10R, 98.8% | beat 98.3% |

**These were found by reading outcomes.** The pipeline lets counts, not outcomes, be looked at before registering.
So nothing above counts toward a stage: each read starts at zero on 2026-11-17 and earns every stage on new events
only. The table is why they were registered, not evidence for them.

**The multiple-testing cost, stated once.** 12 reads × 2 sides × 2 coin sets is 48 looks, and both coin sets share
the same weeks. Two sides holding on both sets is more than chance usually gives, not by a wide margin. The forward
count is the test.

## Shared terms

- **Grading.** The R contract every read uses: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. A one-sided read is
  judged on its own side's random result (random entries on the same coins, the same side, the same hours).
- **Universe.** Main card = `RECORDED_COINS`. Holdout = `HOLDOUT_COINS`, graded apart, never pooled.
- **In-sample history.** Whatever the scoreboard shows for these rules before 2026-11-17 decides nothing.

## A · `session_fade_short` — fade a NY-open rally

**Rule.** session_fade's exact event (session-fade-prereg.md): the move from the 13:00 UTC open to the 15:00 UTC
close (the 13:00 and 14:00 bars), larger than the median |move| of the same window over the prior 30 days (≥ 20 days
of history), traded against its direction at the 15:00 close. **Only the events where that move was UP, so the read
goes SHORT.** One event per coin per day, as the parent. A down move fires nothing.

**Body.** `sessionFadeShortEvents` in `workers/nexus-lab-api/explorerReads.mjs`: `sessionFadeEvents` filtered to
SHORT, so it can't drift from the parent.

## B · `oi_div_reversal_4h_long` — buy a sharp 4h drop on falling OI

**Rule.** oi_div_reversal_4h's exact event (oi-div-reversal-4h-prereg.md): an extreme 4h move against falling open
interest (OI −2%), faded, 12h cooldown per coin. **Only the events where the move was DOWN, so the read goes LONG.**
The cooldown runs on the parent's events of both sides, unchanged.

**Body.** `oiDivReversal4hLongEvents` in `workers/nexus-lab-api/explorerReads.mjs`: `oiDivReversal4hEvents` filtered
to LONG.

## Overlap

Every event of each read is one of its parent's: one bet, never stacked. At registration both join `OVERLAP_PAIRS`:
`session_fade × session_fade_short` and `oi_div_reversal_4h × oi_div_reversal_4h_long`.

## Count-only power check · 2026-11-16

Counted on the public series (`/agent/oi-history`, `/agent/candle-history`), last 60 days, no outcome computed.

| Read | Main card (11 coins) | Holdout (8 coins) |
|---|---|---|
| session_fade_short | 90 | 88 |
| oi_div_reversal_4h_long | 71 | 28 |

About 1.5 and 1.2 main-card events a day: 30 out-of-sample events in roughly 3 and 4 weeks. The holdout line for B is
thin: 30 holdout events take about 9 weeks.

**Scoreboard cost.** The parent runs once per input series and the side read reuses its events (`sharedRun`), so the
two reads add about 0.4 ms a scoreboard pass on 19 coins. session_momentum and session_fade share one run the same way.

## What this page doesn't do

Nothing trades either read: no brain mode, preset, wallet or money change. The parents keep their own registrations,
stages and paper wallets unchanged.

## Sign-off

- **A · `session_fade_short` and B · `oi_div_reversal_4h_long`: signed by borst, 2026-11-16** ("yes do 1 and 2, write
  the rules pages and sign", in a Claude session). Registered in `app/lib/readPipeline.mjs` from 2026-11-17T00:00:00Z,
  main card + holdout lines + the graded exit.

## Results

_None yet._
