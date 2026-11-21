# Sealed reads: public proof, private rule

Drafted 2026-11-20 for borst ("one in-house signal, built to clear the bar … public proof, private edge"). Signed by borst
in session 2026-11-20 ("sign sealed reads"), with on-chain anchoring left off (his answer "no", same message).

## What a sealed read is

A read whose rule is kept private, while every call it makes is public and graded the same way as every other read.
The rule is fixed on day one by a fingerprint anyone can check later. The calls are fixed the moment they fire. So the
record can be checked by anyone, without the rule being given away.

## 1. The seal (the rule, fixed on day one)

1. The rule bundle is three files: the rule in plain words, the code that fires it, and its numbers (thresholds,
   coins, hours). They live in a private repository.
2. Its fingerprint is the sha256 of the three files joined in that order, each preceded by its file name and byte
   length. Before the first day that counts, the fingerprint is committed to this public repository (the commit's date
   on GitHub) and borst posts it from his public X account, so an outside party holds the date too. It is shown on
   /proof from then on. The read counts from the next 00:00 UTC after both. On-chain anchoring is off (borst,
   2026-11-20); if it is turned back on, the fingerprint is also written on Arbitrum, and nothing else changes.
3. The rule is revealed when the read CLEARS, or on a date borst sets and records under Results, whichever comes
   first. Anyone can hash the revealed files and compare. If the hash does not match, the whole record is void, and
   /proof says so in its first line.
4. A changed rule is a new sealed read: a new name, a new fingerprint, a new start. The old record stays on /proof as
   it stands.

## 2. The calls (fixed the moment they fire)

1. Every time the rule fires, the house signal's own wallet posts a public call at once, through the same publish path
   as any caller: server clock, permanent, sealed into the hash-chained call ledger (`/theses/ledger`). This is the
   same proof every call on Nexus has: the call is public from the minute it is posted, and anyone who saves the
   ledger hash can see a later rewrite. A fire that is not posted within 5 minutes is not counted, and the miss is
   listed on /proof.
2. Entry = the Orderly mark when the call is posted (`publishMark`). Stop = 1.2× the coin's H4 ATR-14, target = 1.5R,
   time stop = 168h: the frozen contract every read is graded on, so the comparison with random entries is like for
   like.
3. Calls are graded by the shared grader on 1-minute Orderly prices, exactly as any call.
4. The live call shows only inside the app: the feed, the Lab and the bell. It is not pushed to Telegram, X, x402 or
   any outside channel while it is open.

## 3. The bar (the same one every read must clear)

Only calls posted after the start count. Coins: the 9 main coins and the 8 holdout coins, kept apart as on the board.

1. LEAD, EDGE and TRADEABLE use the pipeline's own numbers (`PIPELINE_RULES`): 30 main-coin calls; each side judged
   against a random entry on the same coins, side and hours, never against zero; each side with 20+ calls beating at
   least half of its random replays; 30 holdout calls for TRADEABLE.
2. The paper step: the first 30 calls after TRADEABLE are judged by the paper-judgment rules already signed for
   level_reclaim: per call, net bps after 2.5 bps taker each side and the funding paid; mean above 0 = PASS.
3. CLEARED = TRADEABLE, a recorded PASS, and no promotion lock, as for every read.
4. 100 main-coin calls without reaching LEAD = RETIRED, as for every read.

## 4. /proof

1. Until it clears: a "House signal · testing" panel at the top of /proof, with the fingerprint, calls so far, each
   side against its random entry, and the paper count. The headline stays "Nothing has cleared yet."
2. Once CLEARED: the headline names it, as the signed headline rule already allows for any cleared read.
3. Never "proven". The badge word is CLEARED.

## 5. What this page does not do

It arms no live money, and it does not let the house signal trade. Trading it is a written live plan under the house
rules (`live-money-review.md`), signed separately.

## Sign-off

Signed by borst in session 2026-11-20 ("sign sealed reads"). On-chain anchoring: off, by his answer "no" in the same
message; section 1.2 says what changes if it is turned back on.

## Results

### 2026-11-21 · borst's ruling: the X post is waived for house-1

borst, in session 2026-11-21: "just seal the … sealed house signal (house-1) for me now. no one cares or will say
anything." The X post in §1.2 is waived for house-1. Its outside date is the fingerprint's merge into this public
repository on GitHub: PR #397, merged 2026-11-20, a time GitHub records and this repository can't rewrite. house-1
counts from **2026-11-22T00:00:00Z**, the next 00:00 UTC after this ruling; nothing fired before it counts. Everything
else on this page stands. A later sealed read follows §1.2 as written unless borst rules again here.
