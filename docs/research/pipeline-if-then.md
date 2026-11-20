# The read pipeline · what each stage triggers

Written 2026-10-23, before any registered read has reached a stage. **Signed off: borst, Oct 23, 2026.**

The five registered reads count events from 2026-10-17T00:00Z (`docs/research/read-pipeline.md`). At today's pace the
first two reach 30 out-of-sample events within about a week. This page fixes, before those numbers exist, what each
stage does on /proof, to paper wallets, to the paid x402 feed, to the house caller and to live money. It also covers
the graded-exit line for Basis × CVD (`docs/research/graded-exit-prereg.md`), whose first out-of-sample trades are due
now.

Nothing here changes a stage rule. The stages and their numbers are `PIPELINE_RULES` in `app/lib/readPipeline.mjs`.
After this page is signed, a changed trigger is a new page with a new date, never an edit to this one.

## Where it stands (`GET /intel/axis-backtest`, 2026-10-23 09:37 UTC)

Out-of-sample events only (after 2026-10-17T00:00Z). "vs random" is the pooled result for a two-sided read.

| read | side | events | mean R | halves agree | vs random | holdout events · mean R · vs random | stage · next |
|---|---|---|---|---|---|---|---|
| rsi_reset_deep | LONG | 9 | −0.06 | no | 74% | 5 · 0.00 · 54% | Registered · 21 more events |
| level_reclaim | both | 19 | +0.18 | no | 77.5% | 15 · 0.00 · 58.8% | Registered · 11 more events |
| oi_div_reversal | both | 7 | −0.07 | no | 33.5% | 0 · none | Registered · 23 more events |
| session_momentum | both | 31 | −0.76 | yes | 0% | 17 · −0.21 · 27.2% | Registered · failing: mean R ≤ 0 |
| confluence_follow | both | 16 | +0.38 | yes | 84.2% | 4 · −0.37 · none | Registered · 14 more events |

Basis × CVD, graded exit (stop 1.2× H4 ATR, target 1.5×, 168h): out of sample **0 trades**, because a trade is counted
168h after its entry and the line counts entries from 2026-10-16. In-sample, the same line reads +34.3 bps net over 48
trades. The read itself is PREDICTIVE (+0.11R, n83, stable) and its LONG side beats 95.3% of random entries. Those
numbers include the history it was picked on, so they don't count toward its bar. Paper wallet `0x9A30…cB28` (graded
exit): 6 trades, 2 wins and 4 losses, −$12.54, parity CLEAN.

## Words used below

- **Stage**: `pipeline.reads[].stage` as served by `GET /intel/axis-backtest`. Nobody declares a stage by hand. If the
  served stage and a reading of the numbers disagree, the served stage stands and the disagreement is a bug to fix in
  its own PR.
- **Clears**: a read at Tradeable or beyond. It's the only thing the words "edge", "proven" and "validated" may describe.

## What each stage does

**Registered (where all five are today)**
- /proof: "Being tested now", the read's name, its event count and what it still needs. Its grade on old data shows
  only on tap, labelled old data.
- Nothing else. No preset, no agent mode, no wallet, no copy beyond the row.

**Lead** (30+ events, mean R > 0, the two halves agree)
- /proof: the row moves to "Leads" and reads "A lead. Not an edge yet." with the events and mean R. The headline doesn't
  change.
- Nothing else. A Lead is a reason to keep watching, not to build anything.

**A Lead that doesn't repeat on the holdout coins**
- It stays a Lead, and /proof adds "Hasn't repeated on coins it was never picked on."
- That stays true until the holdout either passes the Edge bar or the read is retired. The main-card numbers are never
  used to excuse the holdout.

**Edge** (a Lead that beats 95% of random entries on its side and repeats on the holdout coins)
- /proof: "Beats random on new data and on coins it was never picked on. Not tested as a trade yet." The headline
  doesn't change.
- Work that may start, each as one reviewed PR: the agent rule for it, with a parity test proving the live gate equals
  the grader hour by hour (the way `basisStack.test.mjs` does for Basis × CVD). It stays off: no preset, no mode in the
  Lab, no wallet. The point is to have it ready to check the moment the exit line has its trades.

**Tradeable** (an Edge whose graded exit nets above 0 after fees over 30+ out-of-sample trades)
- /proof: the headline changes in the same PR, to the read, the number of trades and the date. Nothing more.
- Paper: borst sets up one paper wallet for it with the preset as registered, on the main coins only. Its record starts
  at that wallet's reset. Its parity must read CLEAN; a DRIFT stops every step below until it's explained.
- The paid x402 feed (`nexus-signals`) may switch to this read, as its own PR on borst's go, still carrying the live grade
  label. Until then it keeps today's feed and label.
- The house caller may publish this read only, as its own PR on borst's go, from a new house wallet so its record is its
  own. Until then it stays off (`enabled:false`).
- Live money: none.

**Paper** (a Tradeable read with a paper wallet)
- After 30 or more paper trades with parity CLEAN and net positive after fees: a written live plan (size, daily cap,
  kill switch, who signs) as its own dated PR. Arming stays borst's call, in person.
- If paper is net zero or below at 30 trades with parity CLEAN, the read stays Tradeable on the scoreboard and nothing
  goes live. The gap between graded and traded is the next question, written down before it's looked at.

**Retired** (100+ out-of-sample events, on the main card or the holdout, with mean R ≤ 0 or worse than random)
- /proof: the row moves to "Retired" with its name, its numbers and the date. It stays visible.
- Never re-tuned. A variant is a new read with a new name and a new registration date.
- No early retirement. session_momentum reads failing today (31 events, −0.76R, worse than all 300 random replays), but
  it is retired only when it reaches 100 events. Until then /proof shows "31 events · failing" with the reason.

**Backwards moves** (added 2026-11-15, borst; the day level_reclaim and oi_div_reversal_4h fell from Paper to
Registered, halves disagree, and this page had no rule for it)
- A backwards move is a served stage below the one recorded (Registered < Lead < Edge < Tradeable < Paper; Retired
  is final and isn't one). The watcher records the new stage and a promotion lock in `pipeline-stages.json` (`locks`:
  the stage lost, the date, the out-of-sample event count at that moment).
- The paper wallet keeps running. Its 30-trade judgment runs under its own signed page. Paper carries no capital, and
  its forward trades are the data that tell regime variance from decay.
- Promotion is locked. Nothing a higher stage licenses is applied: no live-plan signature (refused in code, also
  whenever the read isn't served Tradeable or Paper), no x402 or house-caller switch, no new wallet. A 30-trade PASS
  on a locked read waits. /proof follows the served stage as before.
- The lock clears only after two clean daily watcher reads that serve the lost stage or higher, at least 7 days apart,
  and at least 15 new out-of-sample events since the demotion. A daily read below the lost stage in between resets the
  count to 0. Hourly rebuilds don't count: two of them are the same data plus an hour. A second demotion while locked
  restarts the lock.
- When it clears, the watcher removes the lock and the served stage's own section applies again, one PR per trigger.
- Each lock change (set, a pass, a reset, cleared) is its own watcher PR, record only.

**Each side on its own** (added 2026-11-16, borst; after the 2026-11-16 engine review found level_reclaim and
oi_div_reversal_4h had reached Paper on one side while the other side trailed its own random entry)
- A two-sided read reaches Edge only if, on the main card, each side with 20 or more out-of-sample events also beats
  at least 50% of that side's own random replays. The pooled 95% bar stays as it was. One-sided reads already meet it.
- Why: in a trending market, a read that fires mostly on one side can beat a pooled random entry on that side alone
  while its other side does worse than a coin flip on the tide. Both reads above passed that way (shorts beat 13% and
  24% of random shorts).
- The rule lives in `PIPELINE_RULES` (`sideMinEvents`, `sidePct`) and `pipelineStage`; `read-pipeline.md` says it in
  words. No read was served Edge or higher when it was added, so no served stage moved.
- A Lead held back by it reads, under "next", which side trails and by how much.

**Weekly scorecard** (added 2026-11-16, borst; "a weekly scorecard for everyone on /proof", signed in session)
- Once a week, after Monday 00:00 UTC, lab-api writes one snapshot of the week that just closed and publishes its sha256.
  A written week is never rewritten. Anyone can hash `GET /proof/weekly/<week>` and match the published hash.
- It may show, for each registered read: events since registration and new this week, mean R, and each side against a
  random entry on that side, all on new data only and labelled "not a grade". It also shows stage moves. This is an
  exception to "What we say" for that one panel only. The read's row on the board stays as above.
- Paper runs appear as counts only: trades closed this week, targets, stops and time stops, n of 30, and the recorded
  verdict. No average or sum of R before the 30-trade judgment, as the judgment pages say.
- Graded calls appear with people and our engines apart: count, wins, net R, and the median of how far calls went
  against and for them (MAE / MFE in R), only from calls the grader stamped with a path. Never for paper runs.
- No split by regime until the trend-gate study's judge is built and has judged.
- It claims nothing beyond the numbers: no "edge", no "proven", no headline. If the board can't be read, no week is
  written and the panel says so.

**Engine overview** (added 2026-11-17, borst; "bring the Engine Review presentation onto /proof", signed in session)
- /proof may carry one live "Engine overview" panel, refreshed with the scoreboard: the market the reads ran in (what a
  random long and short earned, BTC's 30-day return, the regime window's day counts); for each registered read its
  new-data events and mean R, and each side against a random entry on that side, as a chart and a table, on the main
  coins or the holdout; each read's line in words by a fixed rule; and the paper wallets as cards.
- This extends the weekly scorecard's exception to that one panel. The board's rows stay as "What we say" fixes them.
  Every number is labelled new data, not a grade: the stage is.
- Paper cards show the count of 30, each closed trade's outcome (coin, side, how it closed), the open trade, the tape
  line and the judgment status. No sum or average of R and no dollar figure before the 30-trade judgment.
- It names a side that beats its own random entry on both coin sets as exactly that: one side, new data, not yet a stage.

**Board layout and the CLEARED badge** (added 2026-11-17, borst; "open paper mode to every read … the gate moves off
access and onto claims", with three decisions in session: the badge is CLEARED, it needs the full ladder, a tweak earns
it only by a signed registration)
- The /proof board reads top to bottom in four groups, best first: **Cleared**, **Leads**, **Still testing**, then the
  folded archive (reads graded on old data only, reads worse than random), **Retired** last.
- **CLEARED** = the full ladder: served Tradeable or Paper (each side beats random on new data, the halves agree, it
  repeats on the holdout coins, the graded exit nets above 0 after fees), no promotion lock, AND its 30-trade paper
  judgment recorded PASS (after fees, parity clean, fills on the public tape). A paper pass alone is never enough: a
  read with no edge clears "mean > 0 at 30 trades" about 4 times in 10. With nothing cleared the group says "Nothing
  has cleared yet." The word is CLEARED, never "proven".
- Only a CLEARED read may be marketed or promoted: the headline, the landing, share cards, posts, the paid feed and the
  house caller. Everything else shows its live record under its group's plain label.
- Leads = served Lead, Edge, Tradeable or Paper and not cleared. Still testing = still Registered.
- Inside Cleared, Leads and Still testing: the furthest stage first, then the share of random entries the read beat on
  new data (main coins), then events. Never an in-sample number. Each row shows that share beside its events, with
  "not a grade" in its tooltip. The stage lines under "What we say" stay as written.
- A user's tweak of a read is a new read: frozen when saved and counted only forward from then. It may earn CLEARED only
  after it is registered on its own signed page, counting from that date.

**Reads no longer retire** (added 2026-11-20, borst; signed Nov 20, 2026. The code in PR #402 is built to this section and deployed on merge)
- Why: under **Retired** above, one reading at 100+ events ended a read for good. On 2026-11-20 that retired
  level_reclaim at exactly 0.00R (118 events, longs still beating random longs) and confluence_follow (109 events,
  −0.11R), after session_momentum on 2026-11-13. A read that sits near zero can cross that line on one rebuild and
  back on the next, and "final" turned noise into a verdict. This section was written the day level_reclaim was
  retired, and that is said here so nobody has to find it.
- **Retired** above, and "Retired" under "What we say", no longer apply. Nothing retires. RETIRED is not a stage.
- The 100-event check stays, as a label: at 100+ out-of-sample events on the main card or the holdout, mean R ≤ 0 or
  worse than random (BELOW_RANDOM) on its side = **failing**, with the numbers. It is set from each build's numbers and
  goes when they recover. It moves no stage, licenses nothing and stops nothing. A failing read can't be served above
  Lead (Edge needs 95% vs random and a holdout with mean R > 0), and it never wears the CLEARED badge.
- Every registered read keeps running: graded on the scoreboard every hour, and on paper (its own wallet or its house
  run). /proof shows every read's numbers in its stage's group; a failing read sits last in its group with the label on
  its row and keeps its paper count. The stages are computed as before (`PIPELINE_RULES`, unchanged).
- **The CLEARED badge keeps the full ladder** ("Board layout and the CLEARED badge" above, unchanged), plus: not
  failing. It is re-checked on every build, so a read that falls back, locks or starts failing loses the badge, and
  the board says so: "Cleared reads are re-checked daily; a read that falls back loses the badge." Only a CLEARED read
  is a claim. The headline, the landing, share cards, posts, the paid feed and the house caller already follow the
  badge.
- **Archive, by hand only.** borst may archive a read to stop paying for it (scoreboard CPU, the brain's tick, its
  house run). An archive is its own PR by borst, written into `ARCHIVED_READS` (`app/lib/readPipeline.mjs`) with the
  day, the reason and the served numbers that day. The read stays on the board, last, with that record. Nothing
  archives automatically: no rule, job, watcher or label does it. An archive is for cost, not a verdict, and because
  the record prints the numbers on the day, an archive that hides a loser reads as one.
- **Registrations are frozen by fingerprint, not by a signature.** A read is registered by a PR that adds its rule on
  its own page (written before its counting date, which is always in the future), its entry in `readPipeline.mjs` and
  its fingerprint line in `app/lib/readFingerprints.mjs`: the sha256 of the events its generator fires on fixed seeded
  tapes (`workers/nexus-lab-api/readFingerprint.mjs`). A test recomputes every fingerprint. A rule whose events change
  is a new read with a new name and a new date, as before. A faster body that fires the same events keeps its
  fingerprint. The 17 reads registered before today were fingerprinted on 2026-11-20 as they run. A user's tweak (last
  point above) is registered the same way: its own page and fingerprint, no signed page needed.
- **What stays signed:** the badge bar (this section, the CLEARED rule above, each 30-trade paper judgment page, and
  a change to any of them, such as `docs/research/badge-bar-v2.md`). Unchanged and outside this section: everything
  that moves money (live plans, arming, the house rules in `live-money-review.md`) and the studies already signed
  (stress hours, trend gate, regime window, sealed reads). Their verdicts license only borst's reviewed PRs, as they say.
- What we say, added: a failing read's row says "Failing the 100-event check (…). Keeps running; re-checked daily." The
  board says once: "Nov 20: reads no longer retire. Every read keeps running; only CLEARED is a claim." Each of the
  three reads retired under the old rule says once on its row: "Retired <day> under the old rule (…); that rule ended
  Nov 20."
- Signed: borst, Nov 20, 2026

## Stacks

Two reads may be combined only once both are Leads, and only if the scoreboard's `overlap` block shows they aren't
the same bet (same coin and side within 24h no more often than chance). The stack is a new read: a new name, a new
registration date, its own 30 events. It inherits no stage from either part.

## Basis × CVD, graded exit (`docs/research/graded-exit-prereg.md`, bar unchanged)

- **Clears** (out-of-sample net > 0 over 30+ trades, the read still PREDICTIVE, LONG still beats 95% of random): Basis
  × CVD goes back on the /proof lead with the graded exit, the headline changes the same way as at Tradeable, and a
  paper-only preset trading it can be proposed. The x402 and house-caller steps follow the Tradeable rules above. Live
  money follows the Paper rules: the graded-exit paper wallet `0x9A30…cB28` is the one that counts.
- **Fails** (out-of-sample net ≤ 0 at 30+ trades, or the read drops below PREDICTIVE): the variant is retired and its
  wallet stays as a record.
- **Not yet** (fewer than 30): nothing changes. Today's 95.3% vs random is not a clear; it includes the history the read
  was picked on.

## What we say

- Registered: "N events · needs 30" (or "failing" with the reason).
- Lead: "A lead. Not an edge yet."
- Edge: "Beats random on new data and on new coins. Not tested as a trade yet."
- Tradeable or a clear: the read, the number of trades, the date.
- Retired: "Retired" with the numbers and the date.
- Until a read clears, the headline stays "Nothing has proven itself yet. Here's the public record."

## What this page doesn't do

It changes no code, no threshold, no preset, no wallet and no flag. Each trigger above is applied in its own PR when its
stage is served, and each PR names this page.
