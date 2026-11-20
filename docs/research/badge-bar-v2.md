# The CLEARED bar, v2 · the paper step has to beat random too

Written 2026-11-20, before any read has reached the paper judgment under it. **Signed by borst in session 2026-11-20
("u sign it"), at 90%.** Nothing here is built yet. It is a change to the badge bar, signed on its own, apart from
"Reads no longer retire" (`docs/research/pipeline-if-then.md`, the same day). The text above Results is pinned
(`app/lib/badgeBar.test.mjs`): a change is a new dated page.

## Why

Since 2026-11-20 no read retires (`pipeline-if-then.md` "Reads no longer retire"). About 17 reads now run for good,
each on paper, and their stages are recomputed every hour. So each read gets unlimited tries at the badge, and the
more tries there are, the more of them luck can clear.

The ladder in front of the paper step is the real filter (95% vs random on new data, each side on its own, the holdout
repeats, the graded exit nets above 0). The paper step itself is weak: its bar is "mean net bps > 0 over the first 30
trades". A read with no edge passes that about 4 times in 10. The paper step should test what the ladder tests: did
these trades beat random entries, not just zero?

## The rule

A read is CLEARED only if everything the badge needs today holds (served Tradeable or Paper, no promotion lock, not
failing the 100-event check, its 30-trade paper judgment recorded PASS) **and** those same 30 trades beat matched random
entries:

1. **The replays.** 300 seeded replays (mulberry32, seed 20261120, the order fixed by the trade numbers). In each replay
   every one of the 30 judged trades is redrawn: same coin, same side, an entry hour drawn uniformly from the hours
   between the paper record's start and the 30th trade's exit, and the same graded exit contract (stop 1.2× H4 ATR-14,
   target 1.5×, 168h) walked on `candle:hist` with the scoreboard's fill rules (`stepExit`).
2. **The same costs.** 2.5 bps taker on each side for every replay trade, as for the judged trades. Funding: the
   judged trades' recorded funding is left out of this comparison, and the replays carry none, so both sides are
   compared on price and fees alone. (The judgment's own PASS keeps its funding, as signed.)
3. **The measure.** Mean net bps per trade. The judged trades' mean is set against the 300 replay means.
4. **PASS v2** = the judged mean beats at least **90%** of the replay means (and is > 0, which the PASS already says).
   Why 90%: this is a confirmation step after the 95% bar on new data, stricter than the holdout's 80%, and at 30
   trades a 95% bar would fail most reads that do have an edge. borst picked 90% before signing.
5. **Once.** The replays are computed once, when the judgment is recorded, and stored with the verdict (the 300 means,
   the seed, the window). They are never redrawn. A re-run from the stored inputs gives the same answer.
6. **Unread data.** A replay trade whose window isn't fully recorded is drawn again inside the replay (at most 10
   times, then the replay is left out). Fewer than 250 usable replays = UNREAD, and the badge waits.
7. **What it changes.** The badge only. The signed paper-judgment pages and their PASS / FAIL / RESET verdicts stand
   as written. A recorded PASS that fails v2 shows "Passed 30 paper trades after fees. Didn't beat random entries on
   the same coins and side (N% of 300)." and is not CLEARED.
8. **Live plans.** A live plan may be signed only for a CLEARED read under this bar (today `livePlanSign` needs a PASS
   and a served Tradeable / Paper stage; v2 adds this check).
9. **Scope.** Every badge from the day this page is signed, including reads already on paper.

## What it doesn't do

It changes no stage rule, no paper judgment page, no wallet, no flag and no trade. The code (replays at judgment time,
the stored result, the badge check, the row line, plan signing) is its own PR after this page is signed.

## Sign-off

- Signed: borst, in session, Nov 20, 2026 ("u sign it"). Rule 4: 90%.

## Results

_(empty until a read reaches its paper judgment under this bar)_
