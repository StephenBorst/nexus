# The house paper runs · one 30-trade judgment page for all of them, locked before any trade closed

Drafted 2026-11-20 at borst's request ("draft it. keep the exact 30-trade rules, fee deduction, and parity checks from
oi_div_reversal_4h"). This page covers the 14 house paper runs (`app/lib/housePaper.mjs`, one per registered read),
each judged on its own by the same rules. Rules 2 to 7 are `paper-judgment-oi-div-reversal-4h.md`'s word for word, with
only the read's name written as `<read>` (each run's own read). Rule 1 names the runs. Rule 8 differs where the
oi_div_reversal_4h page said "the read stays Tradeable": these reads have not all reached Tradeable, so a verdict here
licenses no more than the read's own stage allows. **Signature: pending.** borst's signature is recorded under
Results, so the text above it never moves. The same rules go into `app/lib/paperJudge.mjs` as one entry per read in the
PR that records the signature; its test fails if this page and the code state different numbers.

## Where the bar comes from

The Paper gate was written before these runs existed (`pipeline-if-then.md`, signed 2026-10-23): "After 30 or more
paper trades with parity CLEAN and net positive after fees: a written live plan". This page adds nothing to that bar.
It fixes how each part of it is counted, so the answer at trade 30 is computed, not argued.

A paper run starts before its read has earned anything (borst 2026-11-17: "the record starts early, the claim still has
to be earned"). A PASS here is one gate. The scoreboard's stages are the others, and none of them is skipped. Fourteen
runs are judged side by side: with no edge at all, some of them will pass on luck. That is why a PASS licenses nothing
by itself (rule 8).

What was visible when this was written (2026-11-20, 01:56 UTC): every run started at 2026-11-20T01:17:22Z and none
had closed a trade. Three had their first paper trade open: spot_absorb short SOL (opened 01:21:45Z),
funding_basis_split long XRP (01:21:45Z), bb_rsi_momentum short WLD (01:21:47Z). Their marks were not looked at. Each
counts as its run's trade 1 when it closes, as rule 2 says. The rules are level_reclaim's, written before any of these
reads had a paper run.

## The runs

| Read | House id | Record start |
|---|---|---|
| rsi_reset_deep | `0x9a61b0888a84ed40f7b4d783400aec8ae1eedcbd` | 2026-11-20T01:17:22Z |
| oi_div_reversal | `0x41783694fa09bc07b31ca4f067dc09a4bde6802b` | 2026-11-20T01:17:22Z |
| confluence_follow | `0x3f326e6d1c6b71bc3ae64605d5045ef8ef847479` | 2026-11-20T01:17:22Z |
| oi_coil_break | `0xf94fc07c972f7a922150bcd7e347a3f4ef7c0ec0` | 2026-11-20T01:17:22Z |
| session_fade | `0xbaab05e8809ffd7706d9103647a74fe56739bdfc` | 2026-11-20T01:17:22Z |
| level_reclaim_tight | `0xe8dbf959e6b0f932b49caf99d06f3547ad22f663` | 2026-11-20T01:17:22Z |
| spot_absorb | `0x66a13127c59f36c97a9285df48cc56089adb1583` | 2026-11-20T01:17:22Z |
| btc_lead_lag | `0x97371cec6dc63aa0e9c0747110e5e3042b6217a5` | 2026-11-20T01:17:22Z |
| funding_basis_split | `0xbe07c41cb236e57a0bcdfc6a521a482187eae0c0` | 2026-11-20T01:17:22Z |
| smart_consensus_2x | `0xc84313955e8a30fc3e719df67248c2bfa610f896` | 2026-11-20T01:17:22Z |
| shelf_breakdown_short | `0x161d743f8a4557c76c9d5871dfe85f157619e555` | 2026-11-20T01:17:22Z |
| bb_rsi_momentum | `0x955010226b3a2124790aba173950cfa826569258` | 2026-11-20T01:17:22Z |
| session_fade_short | `0xccc0821fac9d5083006fc56322eddf4804407de5` | 2026-11-20T01:17:22Z |
| oi_div_reversal_4h_long | `0x8ab3611f863ce15295db684376bc1884abae738f` | 2026-11-20T01:17:22Z |

Not covered: level_reclaim and oi_div_reversal_4h (their own wallets and signed pages), session_momentum (retired).

## The rules

1. **Wallet.** Each run's house id above: `"0x"` + the first 40 hex of sha256("nexus/house-paper/v1/" + `<read>`), so
   no key exists for it and it trades on paper only. Each trades `housePaperConfig("<read>")` (graded exit, 11 main
   coins, fixed $50 margin at 3×; signal mode REGISTERED_READ, the scoreboard's own rule for `<read>`). Each run is
   judged on its own; one run's verdict says nothing about another's.
2. **The trades judged.** The first 30 paper trades closed after the record start (the later of the wallet's
   `started_at` and its `paper_reset_at`), numbered by close time as `/proof/paper/<read>` numbers them.
   Trade 31 and later never count toward this verdict.
3. **A reset ends the run.** If the wallet's paper record is reset after this page was written (`paper_reset_at`
   later than 2026-11-20T00:00:00Z) the verdict is RESET: final, shown, and the run it replaced is not judged. A
   new run needs a new dated page.
4. **The money bar.** Each trade's net, in bps of its entry notional:
   `net = move − fees − funding`, where
   - move = the price move in the trade's direction, from its judged entry to its judged exit (rule 5);
   - fees = 2.5 bps taker on the entry notional plus 2.5 bps on the exit notional (the account's Gold-tier rate on
     the day of writing; frozen here, a later change of rate doesn't move this run);
   - funding = what the position paid while held, from the recorded hourly rates (`heldFundingBps`); collected
     funding counts as a negative cost. A trade whose funding can't be read is judged without it and counted.
   The 30 trades weigh the same (the wallet trades a fixed notional). **Mean net above 0 bps = PASS. Mean net at or
   below 0 = FAIL.** No slippage is charged: paper fills at the mark, and live slippage is measured on its own
   (`GET /agent/:a/slippage`).
5. **Judged prices come from the public tape** (`paper-tape.md`, the stored check of each fill):
   - ON_TAPE or NEAR (within 10 bps of what traded): the paper price.
   - OFF (more than 10 bps outside what traded in that minute): the worse of the paper price and the nearest price
     that traded in the checked bar. A buy is judged at no less than the bar's low, a sell at no more than its high.
     A price that wasn't on the tape can only hurt the run, never help it.
   - NO_DATA or NO_TRADES (Orderly had no bar to check against): the paper price, and the count is printed with
     the verdict.
   - Not checked yet (PENDING): the verdict waits.
6. **Parity.** `paperParity` over the run's entries: from the record start to the 30th trade's entry (plus parity's
   10-minute clock slack). Each of the 30 entries must pair with a graded event, and every graded event the wallet
   was free to take before then must have an entry. Events while the 30th trade is held are its own (busy) and
   outside the run. Read once that window is settled (2 hours, parity's settle time) and the 30th trade has closed.
   CLEAN = the verdict is given. DRIFT or UNVERIFIABLE = HELD: no verdict until the drift is explained ("a DRIFT
   stops every step below until it's explained", pipeline-if-then.md). An explanation is a change to the parity
   rule in its own PR, never an edit here.
7. **Final once.** PASS, FAIL or RESET is recorded once in `pjudge:<read>` (LAB_STORE) with the 30
   trades as judged, and never rewritten. Served at `GET /signals/paper-judge/<read>` and on the paper
   run page. The verdict is then appended under Results in its own PR.
8. **What a verdict licenses.** Nothing automatic.
   - PASS: the run's paper gate is met. The read is CLEARED only when it is also served Tradeable or Paper with no
     promotion lock (`pipeline-if-then.md`, "Board layout and the CLEARED badge"); until then the PASS is shown and
     waits. Only then may a written live plan be drafted and signed (its own dated page and PR). The house rules
     (`live-money-review.md`) still bind: the $10 mechanics test first; arming and size are borst's, in person.
   - FAIL: the read keeps its served stage and nothing goes live. This run can't clear it; a new run needs a new dated
     page. The gap between graded and traded is the next question, written down before it is looked at.

## Results

### 2026-11-20 · signed

Signed by borst on 2026-11-20 ("signed"), after reading the rules above, at about 02:37 UTC. No run had closed a trade.
Five held an open first trade: the three named above, plus confluence_follow long BTC and oi_coil_break short SOL,
both opened after the draft. The other nine were flat. Their marks were not looked at. The text above Results is
unchanged from the draft borst read (sha256 f1aba54cec94221ad1fb1819a785b443e2588f1004be5634f71b05025e525fdc, pinned by
`paperJudge.test.mjs`). The 14 code entries in
`app/lib/paperJudge.mjs` (`HOUSE_JUDGMENTS`) are added in the same PR with `signature: "signed"`, so a PASS or FAIL at
each run's trade 30 is final and recorded once.
