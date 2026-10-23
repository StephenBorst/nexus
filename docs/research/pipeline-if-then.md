# The read pipeline · what each stage triggers

Written 2026-10-23, before any registered read has reached a stage. **Signed off: _pending (borst)_.**

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
