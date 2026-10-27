# Nexus Trade Tracker (Bankr app `nexus-trade-tracker`) — data spec

Decided 2026-10-17 (borst), revised 2026-10-27 after Bankr's runtime answers on BankrBot/skills#794. Replaces the
tracker's reads of `GET /account-snapshot`, now retired (410): it answered for any wallet with no signature, using a
cached trading-key seed.

## Why the tracker shows public data only (Bankr runtime, 2026-10-26)
- A chat agent can write only its own wallet's drive. It can't write another user's `/apps/nexus-trade-tracker/`
  storage (400) or another app's appKV. So other users' agents can't put records in the hosted tracker.
- Record keys (`record:…`) in owner-mode apps are write-isolated, NOT read-isolated: any signed-in viewer can read any
  record by naming its key. Viewer mode would isolate reads, but it's closed to outside visitors.
- So no private data can live in the tracker's storage. A legacy `nexusauthsig.json` there held a trading signature;
  it was deleted 2026-10-26 and the wallet revoked (`docs/history.md`).

## The rules
- **Nothing private in the tracker's storage, ever.** Not orders, not liquidation prices, and no credential of any kind
  (no `walletSig`, Lab signature, token or key). The page is public data only.
- **Positions: public, live.** The page reads them itself. No signature.
- **Orders + liquidation prices: on request, in chat.** The agent signs as it does for a trade, reads, shows the result
  in chat, and saves a snapshot to the user's **own** Bankr drive. No scheduled refresh (a background script would have
  to hold `walletSig`).
- **Opt-in with disclosure** before the first save.

## 1. The page (public, live)

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
public settlement indexer, cached up to 5 minutes: label it "updated within 5 min". No leverage, no liquidation price.

Under the panel: "Your orders and liquidation prices: ask in chat, 'show my orders'." The page holds no orders and no
per-user state. Its `syncNexus` / `getNexusData` scripts and every `nexussnapshot*` key go.

Also public, if wanted: market data and the graded caller board (`GET /theses/leaderboard`).

## 2. Orders + liquidation prices (chat → the user's own drive)

When the user asks to refresh, the agent:

1. Signs `nexus-trading-key-v1` (personal_sign), the same signature it uses for trades.
2. Calls both, signature in the JSON body only:
   - `POST https://og.nexustradinglabs.com/order-history` `{ walletAddress, walletSig, limit: 50 }`
   - `POST https://og.nexustradinglabs.com/positions` `{ walletAddress, walletSig }`
3. Saves only if both succeeded:
   - `/order-history`: HTTP 200 and `ok === true`. A 502 `orderly_error` means the orders were NOT read; it never
     means the account has no orders.
   - `/positions`: HTTP 200 and `success === true` (it passes Orderly's reply through).
   If either failed: save nothing, keep the last snapshot, and tell the user which read failed.
4. Writes the snapshot to `/nexus/tracker-snapshot.json` in the user's own drive (wallet-scoped, permanent), replacing
   the last one, and shows the orders and liquidation prices in chat.

"Show my orders" reads that file and shows it with its `asOf` time; missing → offer a refresh.

### The snapshot (build it field by field)

Build a new object from the named fields. Never write the request, the tool call or a whole response: the request
carries `walletSig`.

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

## 3. The opt-in (first save only)

> This saves a copy of your open and recent Nexus orders, and your liquidation prices, to your own Bankr drive at
> /nexus/tracker-snapshot.json. Your agent and Bankr can see it. The Nexus tracker page and other users can't. It can't
> trade or withdraw. It updates only when you ask. Say yes to turn it on.

"Turn off my tracker" **deletes** `/nexus/tracker-snapshot.json` and stops refreshes. Delete, not an empty write (an
empty file stays listed).

## 4. Check with two wallets (A and B)
1. Refresh as A, then as B: each snapshot lands in its own wallet's drive.
2. Refresh A again: B's file is unchanged.
3. Turn off as A: A's file is gone, B's is still there.
4. Open the tracker page as A and as B: both show the same public data, neither shows the other's orders.

## 5. Skill text
Lives in BankrBot/skills#794 (`StephenBorst/skills:nexus-tracker-refresh`, `references/trading.md` "Refresh the Nexus
Trade Tracker"). Copy the folder back here once it merges.
