# Engine A vs Engine B · a dated note: Engine B's main-track calls declare a 4h time stop

Written 2026-11-06, before any call carries it. borst's decision. The registration (`engine-ab-prereg.md`) is not
edited. It says a change to any rule is a new dated page, and this is that page.

## What changes

From this PR on, a call can declare a **time stop** when it is published: `timeStopH: N`, whole hours 1–168.
- **Frozen with the call,** like the split (`exitPlan: "SPLIT_50"`). It can't be added or changed after the post.
- **Graded by the shared grader for any caller** (lab-api `gradeCall`, rule in `app/lib/callMath.mjs`
  `timeStopPlan`). No wallet is named anywhere in the grader. Engine B's bot simply starts declaring it on its
  main-track calls.
- **The rule:** a call that hits neither its target nor its stop by the close of the Nth hourly bar after entry
  settles at that bar's close.
  - R = the move from entry to that close ÷ the risk (entry to stop), 2dp.
  - WIN when R > 0, else LOSS (R exactly 0 is a LOSS, as a split's total is scored).
  - Exit reason `TIME`, shown on the cards, `/verify` and `/theses/status`.
- **Bars:**
  - Filled at the post: bar 0 is the posting hour, and bars 1–N are the next N hours.
  - A resting order: bar 0 is the hour the entry fills, and bars 1–N follow it.
  - TP and stop are checked first in every bar, bar N included, and a same-bar TP + stop is still a LOSS.
  - The window is counted in time, so a market that skips an hour settles at the last close printed before the
    deadline.
  - It settles only once bar N's hour has closed. The store's newest bar may be a partial hour, and a missing close
    keeps the call open.
- **Not allowed with a split:** a call that declares both is refused at publish.
- **On-chain registrations** carry it as `#TIMESTOP_<N>H` in the notes, the way `#SPLIT_50` declares a split, so a
  call rebuilt from the chain grades the same.

## Forward-only

- **Only calls published from 2026-11-06T00:00Z are read for it** (`TIME_STOP_FROM_MS`). An earlier call grades
  exactly as before, even if it carries the field.
- **No call published before this carries it.** Engine B's open calls on 2026-11-06 keep the old rule and are not
  re-graded: #33 ZEC SHORT @ 1,236.90, m12 HYPE SHORT @ 78.929, m13 ETH SHORT @ 2,266.22.
- `GRADE_V` is not bumped: no stored grade was made under another rule.

## Why (borst's backtest, Orderly tape, walk-forward; not re-run here)

- **53% of simulated trades end on the 4h timeout** (1,311 of 2,484).
- **Removing the timeout makes both tracks worse:**

  | Track | Sample | With the 4h timeout | Without it |
  |---|---|---|---|
  | Main track | in-sample | −1.65R | −15.00R |
  | Track M | out-of-sample | +0.24R | −10.00R |

- **The live grader had no time stop,** so the main track was graded on a different exit than it was tested on.
  Positions that stalled ran on to the full −1R stop.
- **A shorter single target was considered and dropped:** 1.0R and 1.2R targets are still negative out-of-sample.
  Exits are otherwise unchanged.
- **This aligns grading with the tested rule. It isn't an improvement in the engine.** The main track is negative
  in-sample with the timeout too. No copy may present the change as a better result.

## Track M stays untimed, by design

Track M keeps its split with a 3R runner and declares no time stop. borst's call: its runners are meant to ride. On
the record:
- **The same backtest scored Track M at +0.24R out-of-sample with the timeout and −10.00R without it.**
- **Track M as it runs is the untimed variant.** That is a deliberate design choice, not an oversight.
- **The grader stays neutral either way.** It grades what each call declares.

## How the registration reads Engine B from here

Nothing above "Results" in `engine-ab-prereg.md` changes: the window, the setup rule, the trigger, the two views, the
0.5R winner bar, and Engine A. Engine B's per-exit-shape breakdown gains one shape:

- **(d) time stop:** a single target at 1.5R with a declared `timeStopH` (Engine B's main track, from the first call
  that declares it).

Calls of shape (d) are counted in Engine B's pooled number as before. The per-shape line shows them on their own,
never folded into (b). Shape (d) is reported with its TIME exits counted and their mean R, beside TP and SL exits.

## Results

(Append below. Never edit above this line.)
