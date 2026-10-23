# Engine A vs Engine B · pre-registered before the comparison

Written 2026-10-23, before the comparison exists. Decided by borst 2026-10-22 and 2026-10-23. Everything above
"Results" is fixed. A change to any rule or threshold = a new dated page, never an edit here.

## The question

Two caller engines post graded calls from their own wallets. Which one makes better calls, judged by the same grader
on the same market?

- Engine A = `0xd9f7b3273b504e1473c3faba6341299d0ec9b449`. It posts only at a conviction of 70 or more.
- Engine B = `0x3b2cd0961aec641fb9c821661d173eedf1bcfbe4`.

Engine A sitting out chop is how it was designed. A quiet stretch is not a gap, and its bar stays at 70 for this test.
Its calls carry no conviction field, so every Engine A call counts as 70+.

## The record

- **Window start:** 2026-10-12 00:54 UTC (`createdAt ≥ 1791766440000`).
- **Calls counted:** public calls only. Copies (`duplicateOf`) and holders-only calls are left out.
- **Grades:** the stored server grades (`gradedOutcome` WIN or LOSS, `gradedR`), written by the hourly grader
  (`gradeCall`, lab-api `logic.mjs`). The study never re-grades a call.
- **Exits:** a split whose TP2 equals its TP1 grades as a single target at TP1 (since #137).
- **Sources:** all public, no key needed: `og.nexustradinglabs.com` `/lab/:wallet`, `/theses/status/:wallet` and
  `/theses/process/:wallet`.

## The setup rule

A call is a **re-post**, not a new setup, when both of these are true:
- the same engine already has a call on the same coin and side, posted less than 24h earlier;
- that earlier call was still open (not yet exited, per `exitedAt`) when the new call was posted.

The first post counts and the re-post is dropped. A call posted after the earlier one closed is a new setup, even
within 24h. It is a re-entry after an exit, and it keeps its own result.

Applied on 2026-10-22, the rule drops exactly one call: `eng-b-18-hype-short-1792172083874`. It was posted 17 minutes
after `eng-b-18-hype-short-1792171043347`, which was still open. `eng-b-15` (HYPE SHORT, Oct 15 13:34 UTC) stays a
setup, because `eng-b-14` had already stopped out at 06:00.

The public board (`/theses/process`) counts every published call, so it will not match the study's setup count. That
is expected: the board is the grader's record, and this page is a study's view of it.

## Baseline (2026-10-22, before the trigger)

| Engine | Setups | Total R |
|---|---|---|
| A | 6 | +3.00 |
| B | 24 | −6.79 |

## The trigger

The comparison runs once Engine A has **20 graded setups** in the window, whenever that is. There is no date and the
bar is not lowered to get there. Until then, a weekly check reports each engine's setup count and total R, nothing else.

## Two views

1. **Headline:** each engine's setups over the whole window.
2. **Same market:** both engines restricted to the calendar span from Engine A's first graded setup to its 20th.

Each view shows fill rate, hit rate, avg R, profit factor and hold time, with n beside every number. Hold time =
`exitedAt − filledAt`, at hour precision; for a call filled at the post with no `filledAt`, use `createdAt`.

Engine B is reported pooled AND per exit shape:
- **(a) split:** a real split (`SPLIT_50`, TP2 beyond TP1). This covers its pre-v2.1 calls and Track M, which puts TP2
  at 3R.
- **(b) single target:** one target at 1.5R. This covers v2.1 (TP2 = TP1) and v2.1.1+ (no exit plan declared).
- **(c) early TP1-only:** the Oct 12 calls posted before split grading existed, graded at TP1 only.

## The winner bar

The bar applies to the **same-market view only**.

1. Split the same-market span at its calendar midpoint.
2. An engine wins only if all three are true:
   - its avg R beats the other engine's by **≥ 0.5R in each half**;
   - it is the same engine in both halves;
   - each engine has at least one setup in each half.
3. Anything else reads **"no winner: descriptive only"**, with the per-half numbers shown.

The headline view never decides a winner. Why 0.5R: at about a 40% hit rate with 1.5 to 2R targets, avg R at n ≈ 20
carries roughly ±0.3R of noise. A gap smaller than 0.5R, or one that only shows in one half, isn't readable at this
sample size.

## Results

_None yet._
