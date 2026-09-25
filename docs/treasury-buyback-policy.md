# $NEXUS Treasury Buyback Policy — DRAFT for counsel

**Status:** draft · not adopted · no buyback happens until counsel signs off on the question in §7.
**Prompted by:** SEC Division of Corporation Finance staff FAQ, *Application of the Federal Securities Laws to
Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets* (issued Sept 25, 2026), building on
the Commission's March 2026 interpretation. Staff guidance — not law, not approved by the Commission, can be withdrawn.

---

## 1. What the FAQ says (the part that matters to us)

- When a crypto network is **already functional**, announcing a buyback of a **non-security** crypto asset does not,
  by itself, amount to a promise of essential managerial efforts under *Howey*.
- The analysis changes if a buyback is **presented as generating yield or returns** for holders.
- Continuing to build, maintain and fund a functional network is not, by itself, "essential managerial efforts."

## 2. The facts about $NEXUS

| | |
|---|---|
| Token | $NEXUS, ERC-20 on Base, `0x3D958634ab725B627919EF8F2Ed59227309fDba3`, 100B fixed supply |
| Origin | Launched as a community meme token. No sale by Nexus, no raise, no presale. |
| Holder rights | None. No revenue share, no yield, no dividend, no governance over treasury, no redemption. |
| Consumptive uses (live) | Unit of payment for Nexus x402 data endpoints (`nexus-signals`, `nexus-callers`, `nexus-agents-live`) · pay for PRO in $NEXUS at a discount · hold 100M to unlock PRO (access) · cosmetic holder tiers + Holders Room |
| Product | Nexus Trading Labs — live, functional, non-custodial trading terminal on Orderly (Arbitrum). Runs without $NEXUS. |
| Treasury | Safe `0x4Fe2c01bbeFaFFa35706C994646a3F8493B1C733` (Arbitrum + Base), public. |
| Treasury inflows | Earned revenue: PRO subscriptions (USDC / $NEXUS) and x402 data sales (paid in $NEXUS). |

## 3. The policy (if adopted)

1. **Discretionary only.** The treasury MAY buy $NEXUS on the open market when it judges the price attractive.
   No schedule, no trigger, no bot, no fixed percentage of revenue or fees. There is no obligation to buy, ever.
2. **Funded from earned revenue only.** Buys come from treasury revenue already received (subscriptions, data
   sales). Never from user funds, never from trading-fee skims promised in advance, never from new token issuance.
3. **Hold, don't burn.** Purchased $NEXUS stays in the Safe. No burn program. Treasury $NEXUS may later fund
   retroactive, merit-graded Season rewards (`docs/nexus-seasons.md`) or be used as working capital.
4. **Full onchain disclosure, after the fact.** Every buy is a public Safe transaction. The treasury counter shows
   "treasury holds X $NEXUS" and links the transactions. No pre-announcement of size or timing (avoids signalling
   a price floor and front-running).
5. **No holder entitlement.** Buys create no right, claim or expectation for any holder. Nexus may stop buying at
   any time without notice.
6. **Market conduct.** No wash trading, no coordinated buys with market makers, no buying around our own
   announcements, no buys while in possession of undisclosed material news (e.g. a pending listing or partnership).
   Size each buy to the pool's liquidity (~$63K today); no single buy intended to move price.
7. **Sign-off.** Each buy executed from the Safe by the signer of record; a one-line log entry (date, amount,
   tx hash, reason: "discretionary treasury accumulation") kept in the repo.

## 4. Language — what we say / never say

**Say (usage, earned, fact):**
- "The treasury holds X $NEXUS it earned from data sales and subscriptions."
- "$NEXUS is how you pay for Nexus data and PRO."
- "Every treasury transaction is onchain. Open the Safe and look."

**Never say (returns, promises, price):**
- "Buybacks support / pump the price." · "Revenue flows to holders." · "Fees → buyback → burn."
- "Holding $NEXUS earns you…" (anything) · "Treasury backing" / "price floor" · "Token demand from usage makes it go up."
- Any buyback size/percentage commitment, any APY/yield framing, any "number go up" tie to Nexus's growth.

## 5. What this policy is NOT

- Not an automated or marketed fee→buyback→burn machine. That design stays dropped — for legal reasons (the FAQ's
  "yield or returns" carve-out) AND market reasons (Danny/Bankr, June 2026: automated buybacks reward short-term
  traders; burning early signals no conviction).
- Not revenue share, staking, or yield of any kind. The FAQ does not bless those, and $NEXUS has none.

## 6. Existing copy that conflicts (fix before adopting)

- ~~`marketing/lab-article.md` line ~63: "fees → treasury → buyback → burn"~~ — rewritten Sept 25 to
  accumulation-from-revenue language (§4).
- `CLAUDE.md` x402 note "agents needing $NEXUS to pay = token demand from usage" — internal note, fine as analysis,
  but must never ship as public copy.

## 7. The one question for counsel

> $NEXUS is a community meme token (no sale, no holder rights) that is also the payment unit for Nexus's x402 data
> endpoints and a discount rail for PRO. Nexus's product is live and runs without it. Under the SEC staff FAQ of
> Sept 25, 2026, does a **discretionary, undisclosed-in-advance, revenue-funded, hold-not-burn** treasury buyback
> — disclosed onchain after the fact and never marketed as a return — keep $NEXUS outside the investment-contract
> analysis? What, if anything, in §3 or §4 should change?

Follow-ups worth asking in the same call: does the $NEXUS pay-for-PRO discount or the 100M hold-to-unlock create
any "expectation of profit" issue; and does paying Season rewards from treasury $NEXUS change the analysis.

---
*Draft by the Nexus team for discussion with counsel. Not legal advice.*
