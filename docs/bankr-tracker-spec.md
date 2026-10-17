# Nexus Trade Tracker (Bankr app) — data spec

Decided 2026-10-17 (borst). Replaces the tracker's reads of `GET /account-snapshot`, which is being retired
(it answered for any wallet with no signature, using a cached trading-key seed).

## The rules
- **No credential in `appkv`, ever.** `appkv` is not private: the app owner can read it, and values show up in
  logs, script returns and postMessage. So no `walletSig`, no Lab signature, no token, no Orderly key. Only data.
- **Positions: public, live.** The page reads them itself. No signature.
- **Orders: refreshed on demand, in chat.** The agent signs exactly as it does for a trade, reads, and writes a
  snapshot of the result. No scheduled refresh (a background script would have to hold `walletSig`).
- **Opt-in with disclosure.** The tracker is for all Bankr users, so the user agrees before the first snapshot.
- **Record-scoped storage only.** Bankr (2026-10-17): file-backed `appkv` is one bucket for the whole app with no user
  isolation; record-scoped storage isolates per viewer, though the owner keeps admin read. The snapshot goes in the
  user's own record.
  **⏳ Open with Bankr:** the exact record-scoped write call and key naming. `nexus-tracker-snapshot` is our proposal
  (BankrBot/skills PR from `StephenBorst:nexus-tracker-refresh`); until Bankr confirms it, the skill text is a proposal.

## 1. Positions panel (the page, live)

```
GET https://og.nexustradinglabs.com/smart/xray?address=<wallet>
```

Use only the venue whose `brokerId` is `"nexus_trading"`. That is the Nexus account. The other venues are the same
wallet on other Orderly brokers, and they don't belong in this panel.

| Case | What the page shows |
|---|---|
| `nexus_trading` in `brokersFailed` | "Positions unread. Try again shortly." Never an empty list. |
| no `nexus_trading` venue | "No positions on Nexus." |
| venue present | rows of `bySymbol` where `open === true` |

Per row: `sym`, `side` (`LONG`/`SHORT`), `szUsd` (position value, USD), `entry`, `unrealized` (USD). From Orderly's
public settlement indexer, cached up to 5 minutes: label it "updated within 5 min". There is no leverage and no
liquidation price here; those come from the chat snapshot below.

## 2. Orders + liquidation levels (chat refresh → `appkv`)

When the user asks to refresh the tracker, the agent:

1. Signs `nexus-trading-key-v1` (personal_sign), the same signature it uses for trades.
2. Calls both, signature in the JSON body only:
   - `POST https://og.nexustradinglabs.com/order-history` `{ walletAddress, walletSig, limit: 50 }`
   - `POST https://og.nexustradinglabs.com/positions` `{ walletAddress, walletSig }`
3. Writes the snapshot below to the **user's own record-scoped** `appkv` entry (isolated per viewer, not the app's
   shared file bucket, which every user of the app shares), key `nexus-tracker-snapshot`, **only if both calls
   succeeded**:
   - `/order-history` succeeded: HTTP 200 and `ok === true`. A 502 `orderly_error` means the orders were NOT
     read; it never means the account has no orders.
   - `/positions` succeeded: HTTP 200 and `success === true` (it passes Orderly's reply through).
4. If either failed: write nothing, keep the last snapshot, and tell the user which read failed.

### The snapshot (build it field by field)

Build a new object from the named fields. Never write the request, the tool call or a whole response: the
request carries `walletSig`.

```json
{
  "v": 1,
  "wallet": "0x…",
  "asOf": 1792000000000,
  "orders": [
    { "symbol": "PERP_BTC_USDC", "side": "BUY", "type": "LIMIT", "status": "NEW",
      "price": 60000, "quantity": 0.01, "executedQty": 0, "avgPrice": null, "createdAt": 1791990000000 }
  ],
  "positions": [
    { "symbol": "PERP_BTC_USDC", "qty": 0.01, "entry": 61000, "estLiqPrice": 48000 }
  ]
}
```

- `asOf` = `fetchedAt` from `/order-history`.
- `orders[]` = each `/order-history` order with exactly these 9 fields.
- `positions[]` = each `/positions` row in `data.rows` with `position_qty !== 0`:
  `symbol`, `qty` = `position_qty`, `entry` = `average_open_price`, `estLiqPrice` = `est_liq_price`.
  (Orderly rows have no flat unrealized-P&L field; the live panel above already shows P&L.)

### On the page
- Print the age next to the orders: "Orders as of 14:05 UTC · ask in chat to refresh."
- Over 24 hours old: show the age in amber.
- No snapshot yet: "Ask in chat: refresh my tracker."

## 3. The opt-in (first refresh only)

The agent asks before writing the first snapshot, and writes nothing without a yes:

> This saves a copy of your open and recent Nexus orders, and your liquidation prices, into the tracker. Nexus,
> the tracker's owner, and Bankr's logs can see that copy. It can't trade or withdraw. It updates only when you
> ask. Say yes to turn it on.

"Turn off my tracker" clears the user's snapshot from `appkv` (writes an empty value) and stops refreshes.

## 4. Skill text (goes to BankrBot/skills first, then copied back here)

New section in `nexus-trading-labs/references/trading.md`, under Order History:

> ### Refresh the Nexus Trade Tracker
> Only when the user asks ("refresh my tracker"). Never on a schedule.
>
> First time only: read them the opt-in in `docs/bankr-tracker-spec.md` §3, word for word, and wait for a yes.
>
> 1. Sign `nexus-trading-key-v1` as you do for a trade.
> 2. `POST /order-history { walletAddress, walletSig, limit: 50 }` and `POST /positions { walletAddress, walletSig }`,
>    signature in the body only.
> 3. If `/order-history` is not 200 with `ok: true`, or `/positions` is not 200 with `success: true`: write nothing,
>    and tell the user which read failed. A 502 `orderly_error` means the orders were not read, not that there are none.
> 4. Otherwise build the snapshot from the named fields in §2 and write only that object to `appkv`.
>
> Never write `walletSig`, the request, the tool call or a whole response to `appkv`. `appkv` is not private: the
> tracker's owner and Bankr's logs can read it.

Also in `/order-history`'s entry: the response now carries `ok` and `fetchedAt`, and a refused read is a 502
`{ ok: false, error: "orderly_error", upstreamStatus, code, message }`.
