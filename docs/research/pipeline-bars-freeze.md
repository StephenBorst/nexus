# The stage bars, frozen · what a read must show to move up

Written 2026-11-28. **DRAFT. Not signed. It binds nothing until borst signs it.** Once signed, the text above Results
is pinned by `app/lib/pipelineBarsFreeze.test.mjs`, and a change to any number below is a new dated page, signed on its
own, never an edit to this one.

## Why

The bars a read must clear live in code (`PIPELINE_RULES` and `PAPER_MIN_TRADES` in `app/lib/readPipeline.mjs`,
`BADGE_BAR` in `app/lib/badgeBar.mjs`, `LOCK_RULE` in `app/lib/promotionLock.mjs`) and in prose
(`docs/research/read-pipeline.md`, `badge-bar-v2.md`, `pipeline-if-then.md`). A test keeps the code and the prose
saying the same numbers, but one PR can still change both together, and the board would then promote reads against bars
that moved after the reads were seen. Freezing the numbers on one signed page means a promotion can only happen against
bars fixed before the data that clears them.

## The bars, as of 2026-11-28

Each stage is computed every hour from the served scoreboard (`pipelineStage`). Only out-of-sample events count: events
after a read's own `registeredAt`, on the main coins unless a bar says fresh coins (the holdout set,
`app/lib/recordedUniverse.mjs`).

1. **Still testing → Lead.** 30 out-of-sample events; mean R above 0 on the frozen contract (stop 1.2× H4 ATR-14,
   target 1.5R, 168h); both halves of the events agreeing.
2. **Lead → Edge.** At least 95% of 300 random entries finishing under its mean R. A two-sided read: each side with 20
   or more events also has at least 50% of its own side's random entries under it. Fresh coins: 30 events, mean R above
   0, and at least 80% of random entries under it.
3. **Edge → Tradeable.** A graded-exit line with 30 trades, net above 0 bps after fees.
4. **Tradeable → Paper.** Its own paper wallet, set up by borst.
5. **Paper → CLEARED.** The first 30 closed paper trades from the record start, judged once by the read's signed
   judgment page: mean net bps after 2.5 bps taker each side and the funding paid, above 0; parity clean over the 30;
   fills checked against the public tape. Then those 30 trades' mean at or above 90% of 300 matched random entries
   (badge bar v2: same coin, same side, same window, same exit, 2.5 bps each side; fewer than 250 usable replays =
   unread). Also: no promotion lock, and not failing.
6. **The failing label.** At 100 or more out-of-sample events on the main coins or on fresh coins: mean R at or below 0,
   or 5% or fewer of random entries finishing under it on its side. Set each build, never final. A failing read can't
   reach Lead and never wears CLEARED.
7. **A promotion lock.** A served stage below the recorded one locks the read. The lock clears after 2 clean daily
   watcher reads at the lost stage or higher, at least 7 days apart, plus 15 new out-of-sample events since it fell back.

CLEARED is the only passed state. Stage names are not claims: Lead and Edge are steps, not results.

## What the freeze covers

- Every number above, and which events count toward it.
- Once signed, `app/lib/pipelineBarsFreeze.test.mjs` pins the code's constants (`PIPELINE_RULES`, `PAPER_MIN_TRADES`,
  `BADGE_BAR.runs` / `beatPct` / `minUsable` / `feeBps`, `LOCK_RULE`) to the numbers on this page. A PR that changes one
  fails until a new dated page with the new number is signed and the test points at it.

## What it doesn't cover

- Measurement fixes that change no number here (a fill rule, a price spine, a data hole) stay logged under
  "Measurement changes" in `read-pipeline.md`, each its own PR, as now.
- New reads. Each registration is its own dated page and fingerprint, as now; this page says what every read must clear,
  not which reads exist.
- Live money. Signing a live plan, funding a wallet and arming it stay borst's, in person, under the house rules
  (`live-money-review.md`). CLEARED licenses none of it automatically.
- The paper-judgment pages already signed stand as signed.

## Sign-off

Signature: pending. borst signs this page in session; the signing PR records the line here and adds the pin.

## Results
