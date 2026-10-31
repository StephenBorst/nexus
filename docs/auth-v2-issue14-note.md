# Auth v2 and issue #14 · one design, not two

Design note, 2026-10-31. No code. For borst to rule on before step 2 of `docs/auth-v2-spec.md` is built.

## What's already true

- **Issue #14** asks for request-bound signing: a short-lived, single-use challenge per risky action.
- **Its server side was built in June,** in #15 and #17, and has been off ever since (`AUTH_V2` is unset in
  `wrangler.toml`). The pieces:
  - `buildChallenge` and `verifyV2` (`workers/nexus-lab-api/logic.mjs`);
  - `GET /auth/challenge`;
  - `requireOwnerV2` on `/trade`, withdraw, and agent kill, activate and mode (`index.js`).
- **The Auth v2 spec** (signed 2026-10-27) already contains #14 as its section C. The spec has three parts:
  - **A.** Random trading keys, registered once, expiring at Orderly in 30 days.
  - **B.** A 24-hour session signature that derives nothing. Step 1 shipped: `tradingSession.mjs` and
    `routes-session.mjs`.
  - **C.** The #14 challenge, on top of a session, for the riskiest steps.

So there is nothing to choose between. #14 is section C of v2, half built.

## Why #14 alone doesn't close the hole

Today the static signature *is* the trading key: `seed = SHA-256(signature)`. Someone holding a leaked copy doesn't
need our server at all. They derive the key and sign orders straight at Orderly. A challenge on our routes can't see
that.

| A leaked static signature can… | Stopped by #14 (C) alone? | Stopped by v2 (A+B+C)? |
|---|---|---|
| Trade the account directly at Orderly | **No** | Yes. The key is random and derives from nothing. |
| Drive the agent through our API (activate, mode, config) | Yes, where gated | Yes |
| Withdraw | Already no (the key's scope has no `asset`; Orderly needs the wallet's own EIP-712) | Same |

Flipping `AUTH_V2` on its own would feel like a fix and leave the main hole open. Only part A closes it.

## Two places where the June code and the spec disagree

1. **`/trade` is gated per request in the June code.** The spec's C list leaves it out: it covers withdraw,
   registering or rotating a key, arming AUTONOMOUS, and raising capital or leverage. Trades ride the session.
   - **Recommendation: follow the spec.** Once keys are random, a per-trade challenge protects nothing extra.
   - It would also put a wallet prompt on every chat trade, and friction on every trade trains people to sign without
     reading.
2. **Agent kill is gated in the June code.** Kill is the safety action. More friction on stopping an agent is the
   wrong way round. The worst a leaked identity can do with kill is close your positions and switch the agent off;
   it can't open anything or move funds.
   - **Recommendation: kill needs a session only, never a challenge.** The live-entry pause (`/ops/halt`) already
     follows the same rule: stopping is cheap, starting is guarded.

## Order of work

1. **Close #14 into the spec.** Leave a comment pointing here and at `auth-v2-spec.md` section C.
2. **Build v2 step 2:** begin, complete and remove, plus key storage, behind `AUTH_V2_KEYS="true"`. Bankr register
   moves to it.
3. **Build v2 step 3:** the derive routes read the stored key, and exec gains its expiry check. In the same PR, take
   the challenge off `/trade` and kill, so `requireOwnerV2` covers exactly the spec's C list.
4. **Never turn on `AUTH_V2` before the Bankr skill sends the challenge** (spec step 4). Today `requireOwnerV2`
   refuses a call without `{nonce, v2Sig}`, so switching it on early breaks every Bankr chat action on those routes.
5. Migration and the dated cut-over, as in the spec.

## Decisions for borst

1. Close #14 into the v2 spec? (Recommended.)
2. `/trade`: session only, no per-trade challenge? (Recommended.)
3. Agent kill: session only, no challenge? (Recommended.)
4. Then build step 2 next.
