# Minute grading: calls fill and settle in about a minute

Decided by borst, 2026-11-12. Built in one PR: Phase 1 (live hint on the cards) and Phase 2 (the minute grader).
Phase 3 (a Durable Object holding Orderly's websocket, to trigger a market's re-grade the second a level
trades) is held until we see whether about a minute is fast enough.

## The problem

The hourly pass (`grading.mjs gradePublicTheses`, cron `17 * * * *`) graded every call on 1-hour candles.
A call whose entry or target traded at :18 showed WORKING or ACTIVE until the next :17, so up to an hour.

## The rule

- **Calls published from `MINUTE_GRADE_FROM_MS` (2026-11-13T00:00Z, server clock) are graded on public
  1-minute bars** (`app/lib/minuteGrade.mjs`). Everything else about the grade is unchanged and lives in
  ONE function, `logic.mjs gradeCall`, which now reads the bar length from `cd.step` (60, or the hour by
  default):
  - the entry must trade (at the post within 0.3% of `publishMark`, else the first later bar that reaches it);
  - first touch of the target or the stop decides it; a bar that touches both is a LOSS;
  - a declared split and a declared time stop work as before. The time stop is still counted in **hours**
    (bar 1 = the hour after the fill's hour) and settles at the close of the minute before the window ends,
    which is the same price the hourly bar closes at.
- **Forward-only.** A call published before the cutoff keeps its hourly grade. No stored stamp was made under
  another rule, so `GRADE_V` doesn't move and no record changes. (Same pattern as the time stop's
  `TIME_STOP_FROM_MS`.)
- What changes in outcomes: a minute is a finer bar, so fewer calls hit "both levels in one bar". Under the
  hourly rule a call whose target traded at 11:20 and stop at 11:40 is a LOSS; on minutes it is a WIN. That
  is the reason for the cutoff: it would rewrite old records.

## Why not grade on the websocket mark

A tick we saw on our socket can't be re-checked by anyone else, and the mark is an index price, not a
trade (it smooths over wicks that really traded). The grade stays a fact about **public traded bars** that
anyone can re-run. The live mark is used only for the "confirming" hint on cards, which grades nothing.

## How it runs

| Piece | File | What it does |
|---|---|---|
| Archive | `workers/nexus-lab-api/minuteCandles.mjs` | `m1:{SYMBOL}:{YYYY-MM-DD}` in LAB_STORE, 1-minute OHLC from Orderly `/tv/history?resolution=1`, contiguous by construction, **no expiry**. |
| Open index | `workers/nexus-lab-api/minuteIndex.mjs` | `open1m:{wallet}:{id}`, one key per open call, frozen levels in the key's metadata. Written at publish (`labWrite.mjs commit`), re-built hourly by the hourly pass. |
| Grader | `workers/nexus-lab-api/minuteGrader.mjs` | lab-api cron `* * * * *`. Fetch each market's new minutes, re-grade only calls whose levels traded in minutes that are new or changed versus the archive (or that were never stamped, or whose time stop is due), stamp with the shared `applyGrade`, announce fills and grades. A NexusLock lease keeps one run at a time. |
| Safety sweep | same, `full: true` | After the hourly pass: re-grade every indexed call with no trigger. Covers a run that died between fetching bars and writing the grade. |
| Live hint | `app/lib/callLifecycle.mjs provisionalTouch`, `AwaitingFill.tsx` | The card says "ENTRY / TARGET / STOP REACHED ON THE MARK · CONFIRMING" from the live mark the browser already has. Display only. |

KV is eventually consistent: a read at another edge can be ~60 s behind a write. So a touch triggers once (a
re-read minute that came back unchanged is not news), and each fill or grade alert is claimed once in the
NexusLock Durable Object (`claimOnce`, strongly consistent, 10-minute lease never released) before it's sent. A
stamp lost to a save built on a stale copy is restored by the hourly full sweep.

Field ownership, so the two passes never write over each other: on a minute-graded call the minute grader
writes only `GRADE_FIELDS` (grade, fill, status) and the hourly pass writes only `PLAN_FIELDS` (plan
quality and regime, which read the hourly bars before the post).

The board (`computeCallerStats`) counts a minute-graded call's sealed stamp instead of re-grading it on
every read (the stamps are server-only fields; `/verify` re-runs them).

Latency: about one cron tick (≤ 60 s) plus the KV propagation of the write (up to ~60 s at other edges).
Sub-second is not possible on KV and wasn't the goal.

## Verify it yourself

- `GET /verify/:wallet/:id` re-runs `gradeCall` on the archived minutes. For a minute-graded call it answers
  `method: "orderly_1m_regrade"`, the public Orderly request (`source`) and every archived day (`archive`).
- `GET /candles/1m/:symbol/:YYYY-MM-DD` serves one archived day exactly as stored, with its Orderly source.
  A finished day never changes (cached a day); today's moves every minute.

## Cost

Per market with an open call: one Orderly request, one KV read and one KV write a minute (~43k writes a month a
market), plus one KV list a minute. Finished days are read once, not every minute (2026-11-13): today's chunk
carries `contigFrom`, where the gap-free archive behind it starts, so a call open for weeks doesn't cost a read
per day per minute. A new day, or a call older than the stamp, walks every day once and stamps again. The archive grows ~60 KB a market a day for markets with open calls.

## Not done here

- Phase 3 (websocket trigger in a Durable Object). The trigger only decides when to look; the settlement would
  still be `gradeCall` on archived minutes.
- Per-exit on-chain anchoring: the hourly call ledger anchor already commits every grade.
