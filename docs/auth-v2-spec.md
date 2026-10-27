# Auth v2 — trading keys that don't come from a signature

Signed off by borst 2026-10-27 (decisions below). Nothing here is built yet; the build order is at the end.

## The problem

Today one signature does two jobs: `personal_sign("nexus-trading-key-v1")`.

1. **It proves who you are.** Routes recover the address from it.
2. **It IS your trading key.** Routes take `seed = SHA-256(signature)` as the ed25519 key registered at Orderly.

The message never changes, so the signature never changes or expires. Whoever holds a copy holds the trading key,
permanently: it can trade the account and drive its agent (it can't withdraw). Re-signing can't rotate it.
On 2026-10-26 a copy sat in the Trade Tracker's app storage (`docs/history.md`), and the only remedies were a revoke
list and removing the key at Orderly.

v2 splits the two jobs. **The trading key is random and registered once at Orderly with a native expiry. Proving who
you are uses a short-lived signature that derives nothing.**

## Where the static signature is used today

| Use | Routes | What it does with the signature |
|---|---|---|
| Derive the key, sign Orderly calls | `/trade`, `/close-position`, `/set-sl-tp`, `/cancel`, `/order-status`, `/order-history`, `/positions`, `/balance`, `/set-leverage`, `/settle-pnl`, `/withdraw/prepare`, `/twap`, `/derive-key` | SHA-256 → ed25519 seed |
| Derive the key server-side via Bankr | `/proxy/bankr-register`, `/proxy/bankr-withdraw`, `/proxy/bankr-deposit` | Bankr signs the same message, then SHA-256 |
| Store it as the agent key | `PUT /agent`, `bankr/activate`, `bankr/mode` (AUTONOMOUS) | SHA-256 → bs58 → AES-GCM → `agent:key:{addr}` |
| Prove the wallet only | agent mutations (`requireOwner`), backtest/sweep/validate, `wargame`, `creator/claim`, `live/publish`, `desks`, arena, smart-money writes | ecrecover |

Registration today (`/proxy/bankr-register`, the `/register-orderly-key` page): `AddOrderlyKey` with scope
`read,trading` and a **365-day** expiry.

**Not affected:** the web app's trading. The Orderly SDK in the browser already generates its own random key and
registers it with the user's wallet. That is the v2 model already. v2 brings the server-side paths (Bankr chat,
agents, the register page) up to it.

## Design

### A. Trading keys: random, registered once, expiring at Orderly

- **Generate:** the server generates a random 32-byte ed25519 seed (`crypto.getRandomValues`). It is never derived from
  anything.
- **Register:** the wallet signs Orderly's `AddOrderlyKey` EIP-712 (MetaMask, or Bankr `eth_signTypedData_v4`):
  - scope **`read,trading`** (never `asset`, so a key can't withdraw);
  - expiration **now + 30 days** (**Q1**).
  - Orderly enforces the expiry itself, so it holds even if Nexus is compromised.
- **Store:** the key is encrypted at rest under `AGENT_ENC_KEY`, in the record exec already reads
  (`agent:key:{addr}`). The format gains three fields: `{ v: 2, tradingKey: <AES-GCM bs58 seed>, accountId, orderlyKey,
  expiresAt, registeredAt, enc: "v1" }`. Exec's signing path doesn't change.
- **Use:** every "derive" route in the table loads this record instead of hashing a signature. No route accepts a
  trading key or seed in a request.
- **One key per wallet** for Nexus's server paths (chat trading and the agent share it, **Q2**).

### B. Proving who you are: a 24-hour session signature

A new message, separate from the Lab signature (the Lab message says "No funds move. No trades." and must stay true):

```
Nexus trading: sign in with this wallet
Lets Nexus use this wallet's Nexus trading key for orders, positions and your agent.
It can't withdraw.
Address: 0x…
Session: <random id>
Issued: <ms timestamp>
Expires: <ms timestamp, ≤ Issued + 24h>
Domain: og.nexustradinglabs.com
```

- **Where it goes:** body only, never in a URL, never stored.
- **Verification:** ecrecover equals the address; `Issued ≤ now ≤ Expires`; lifetime ≤ 24h; domain matches.
- **Kill switch:** `auth:sessions-after:{addr}` holds a timestamp; any session issued before it is refused, so the owner
  can end every open session at once.
- **What a leaked copy does:** proves the wallet for at most 24 hours, derives nothing, registers nothing. Registering
  a key needs the EIP-712 signature in A.
- **Where it's checked:** every row of the table above, in place of the static signature.

### C. Moving money or arming the agent: a per-request challenge

These steps also need the existing `AUTH_V2` challenge (`GET /auth/challenge`, 120 s, single-use nonce, bound to
action + amount; `logic.mjs verifyV2`), on top of a session:
- withdraw;
- registering or rotating a key;
- arming AUTONOMOUS;
- raising `capitalPerTrade` or leverage.

The challenge already exists, flag-gated, and v2 turns it on for these steps. Withdrawal itself is unchanged: Orderly
still needs the wallet's own EIP-712 `Withdraw` signature, and the receiver is the wallet.

## Flows

**Register (Bankr chat, the register page):**
1. `POST /v2/key/begin {wallet, session}` → the server makes a random key and holds it pending (encrypted, 10 min,
   under a NexusLock lease so two begins can't race) → returns the `AddOrderlyKey` typed data.
2. The wallet signs.
3. `POST /v2/key/complete {wallet, session, nonce, v2Sig, eip712Sig}` → the server relays to Orderly
   `/v1/orderly_key`, and on `success === true` stores the key as active. Anything else: the pending key is deleted
   and Orderly's answer is passed through.

**Trade / read:** `{wallet, session}`, and the server signs with the stored key. No stored key, or an expired one →
409 `key_required` with the begin step to call.

**Rotate:** same as register, then remove the old key at Orderly (`/v1/client/remove_orderly_key`, signed by the new
key). From 3 days before expiry, every response carries `keyExpiresInDays` so the client can rotate in time.

**Agent:** activation needs an active stored key; it doesn't make one. Exec already reads the key; it gains one
check. It opens no position whose `maxHoldHours` would run past `expiresAt`, so a key never expires under an open
position the agent could no longer close. From 3 days out it alerts the owner to rotate. **Q3:** agent keys may need
longer than 30 days.

**Disconnect:** `POST /v2/key/remove {wallet, session, nonce, v2Sig}` removes the key at Orderly and deletes the record.
DEACTIVATE stops the agent but keeps the key (today it deletes the KV record and leaves the key live at Orderly).

## Migration

1. **Ship v2 beside v1.** New registrations are v2. v1 still works. The skill and the register page move to v2.
2. **Migrate on the next sign-in.** A wallet that registers a v2 key while presenting its v1 signature (or via Bankr,
   which can produce it) gets its v1 key removed at Orderly, and the wallet is marked v1-off: the revoke gate refuses
   its v1 signature from then on.
3. **Turn v1 off for everyone** on a dated cut-over (**Q4**), after the Bankr skill PR is merged. v1 keys nobody
   migrated stay live at Orderly until their 365-day expiry; Nexus refuses their signature from the cut-over.

**0xd9f7…b449:** on the revoke list, v1 key removed (or being removed with `bankr-remove-key`). It's the first v2
registration through Bankr. Then withdraw the $1.76 with the v2 key, then drop it from `REVOKED_TRADING_WALLETS` (the
v1 signature stays refused through the v1-off mark).

## What each leak costs, before and after

| Leaked | v1 (today) | v2 |
|---|---|---|
| The wallet's Nexus signature | trading key forever, agent control | ≤ 24h of identity, no key, can't register one |
| A stored trading key (worker breach) | n/a (derived on demand) | trading only, until expiry (≤ 30 days) or removal; no withdrawals |
| `AGENT_ENC_KEY` + KV | every agent key | every stored key, same bounds: no withdrawals, Orderly-side expiry, removable |
| The wallet's private key | everything | everything (out of scope) |

The trade-off: v2 **stores** a trading key per wallet (encrypted), where v1 derived it per request. That's the same
custody agents already have. In exchange, a leaked signature stops being a leaked key.

## Tests (one module per piece, like the rest of lab-api)

- **Session signatures:** expiry, lifetime cap, domain, kill switch, never in a URL.
- **Begin/complete:** a pending key expires; two begins race under the lock; Orderly's refusal stores nothing; the
  typed data says `read,trading` and the expiry.
- **Every derive route:** reads the stored key and refuses a v1 signature once the wallet is v1-off.
- **Exec:** an expired key ⇒ no entries.
- **Migration:** v1 key removed and wallet marked off; the old revoke list still honoured.
- **Parity:** the key a route signs with is the key Orderly lists (fake Orderly).

## Build order (each a PR)

1. Session signatures plus the kill switch: library + verifier, unused. **Shipped 2026-10-27:** `app/lib/tradingSession.mjs`
   (message, `newTradingSession`, `verifyTradingSession`), `routes-session.mjs` (`checkTradingSession`, `POST /v2/session/end-all`).
2. Begin/complete/remove + key storage behind `AUTH_V2_KEYS="true"`; Bankr register moves to it.
3. Derive routes read the stored key; exec expiry check.
4. Bankr skill PR (BankrBot/skills) with the new calls; copy back.
5. Migration step 2; then the dated cut-over.

## Decisions (borst, 2026-10-27)

- **Q1. Key lifetime: 30 days.**
- **Q2. One key per wallet**, shared by chat trading and the agent.
- **Q3. Agent keys: 30 days too.** The agent opens no position whose max hold would run past the key's expiry, and
  alerts the owner from 3 days out.
- **Q4. The v1 cut-over: 2 weeks after the Bankr skill PR merges.**
- **0xd9f7…b449's path back:** register a fresh v2 key through Bankr, withdraw the $1.76 with it, then drop the wallet
  from `REVOKED_TRADING_WALLETS` (its v1 signature stays refused through the v1-off mark).
