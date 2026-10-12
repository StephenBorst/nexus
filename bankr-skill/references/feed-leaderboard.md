# Feed, Leaderboard & Thesis Reference

## Public Feed

```
GET https://og.nexustradinglabs.com/feed
```

Returns all public theses. Each object:
- `id`, `wallet`, `symbol`, `direction` ("LONG"/"SHORT")
- `entry`, `sl`, `tp1`, `tp2`, `tp3`
- `status` — "ACTIVE", "HIT_TP", "STOPPED_OUT", "CLOSED"
- `copyCount`, `onChainId`, `onChainTxHash`, `timestamp`

---

## Trader Lab

```
GET  /lab/:walletAddress          // all theses for wallet
PUT  /lab/:walletAddress          // body: { theses: ThesisTrade[] }
GET  /profile/:walletAddress      // { pfp, displayName }
PUT  /profile/:walletAddress      // body: { pfp?, displayName? }
```

---

## Rep Score

Composite 0–100 on-chain credibility score:

```
repScore = winRate + min(avgRR * 10, 20) - samplePenalty
```

- `winRate` = (wins / (wins + losses)) * 80
- `avgRR` = average (tp1 - entry) / (entry - sl) on closed winning theses
- `samplePenalty` = 0 if ≥5 closed trades, else (5 - closed) * 4
- Clamped to [0, 100]

On-chain stats: call `getTraderStats(walletAddress)` on ThesisRegistry returns `(wins, losses, activeTrades)`.

---

## Build the Leaderboard

1. `GET https://og.nexustradinglabs.com/feed` → all public theses
2. Group by wallet
3. Compute per wallet:
   - `wins` = count of `HIT_TP` theses
   - `losses` = count of `STOPPED_OUT` theses
   - `avgRR` = mean of `(tp1 - entry) / (entry - sl)` for winning theses
   - `repScore` using formula above
4. Sort by `repScore` desc, then total theses desc
5. For verified on-chain stats: call `getTraderStats(wallet)` on ThesisRegistry (shows ⛓ badge)

---

## ThesisRegistry Contract

**Address:** `0x2F4EdA890f96a7979d6f26bCB210cEDAD68346Bc` (Arbitrum One)
**Verified:** https://arbiscan.io/address/0x2F4EdA890f96a7979d6f26bCB210cEDAD68346Bc

Key functions:
```solidity
registerThesis(string symbol, string direction, uint256 entry, uint256 sl, uint256 tp) → thesisId
closeThesis(uint256 thesisId, string outcome, string settlementTxHash)
getTraderStats(address trader) → (wins, losses, activeTrades)
getThesis(uint256 thesisId) → ThesisData
```

Price encoding: `Math.round(price * 1e6)` — e.g. BTC at $65,432.10 → `65432100000` (contract uses 6 decimal scaling, NOT 8)

Events: `ThesisRegistered(thesisId, trader, symbol)`, `ThesisClosed(thesisId, trader, outcome)`

---

## Copy Trading Flow

1. `GET https://og.nexustradinglabs.com/feed` → find thesis by trader/symbol/direction
2. Prompt user: account size (USDC), risk % (e.g. 2%), optional max loss cap
3. Compute position size: `accountSize * riskPct / (entry - sl)` (longs); adjust for shorts
4. `GET /lab/:userWallet` → fetch user's theses
5. Append new thesis:
   - All levels from source
   - `copiedFromWallet: sourceWallet`, `copiedThesisId: sourceId`
   - Notes: "Copied from [sourceWallet] via Nexus"
   - `isPublic: false` (user decides)
6. `PUT /lab/:userWallet`
7. Optionally: `POST /notifications/:sourceWallet` to alert them

---

## Publish a Thesis On-Chain

Use `POST https://og.nexustradinglabs.com/proxy/thesis-register` — the Worker handles ABI encoding and Bankr submission. Pass raw USD prices; server scales automatically.

```
POST https://og.nexustradinglabs.com/proxy/thesis-register
{
  "walletAddress": "<wallet>",
  "bankrApiKey":   "<Bankr API key>",
  "symbol":        "PERP_BTC_USDC",
  "direction":     "LONG",
  "entryPrice":    65000.50,
  "stopLoss":      62000,
  "takeProfit1":   70000,
  "takeProfit2":   0,
  "isPublic":      true,
  "notes":         "BTC breakout thesis",
  "exitPlan":      "SPLIT_50"            // optional, see below
}
```

**How a call is graded.** First touch on public 1h candles: TP1 before the stop = WIN at the R of the
posted levels; stop first (or both in one hour) = LOSS, −1R. A `takeProfit2` on its own is a note; it
is NOT graded.

**Split exit (`exitPlan: "SPLIT_50"`, optional).** Declares half closed at TP1 and half at TP2, both
on the ORIGINAL stop (no move to breakeven). Graded total = 0.5·R1 + 0.5·R2 if the runner reaches
TP2, or 0.5·R1 − 0.5 if the runner is stopped (WIN when the total is above zero); the call stays
PENDING until the runner closes. Requires `takeProfit2` beyond `takeProfit1`, or the route answers
400 `bad_split` before any transaction. Set it when the call is first published: it is frozen with
the call and can't be added, removed or changed later. The same field works on a call saved through
`PUT /lab/:address`.

Returns `{ ok, txHash, thesisId, riskReward, hint }`. The thesis is automatically indexed in `/feed` — no separate PUT required. `thesisId` is the KV record ID. `txHash` links to Arbiscan. To also capture the on-chain `onChainId` (ThesisRegistry's integer ID), parse the `ThesisRegistered` event from the tx receipt.

---

## Notifications

```
GET    /notifications/:wallet
GET    /notifications/:wallet?unreadOnly=true
POST   /notifications/:wallet      { type, message, fromWallet? }
PUT    /notifications/:wallet       { markAllRead: true }
DELETE /notifications/:wallet/:id
```

---

## Comments & Reactions

```
GET    /comments/:thesisId
POST   /comments/:thesisId         { wallet, text }
DELETE /comments/:thesisId/:commentId
GET    /reactions/:thesisId
PUT    /reactions/:thesisId/:emoji  { wallet }   // toggle
```

Allowed emojis: 🔥 💎 📉 ✅ ❌

---

## On-Chain Wallet Registry

```
GET https://og.nexustradinglabs.com/wallets/onchain
```

Returns `{ wallets: string[], fromCache: bool }` — all wallets that have ever registered a thesis on Arbitrum.

---

## Example Prompts

**"Show me the top 5 traders by Rep Score"**
→ GET https://og.nexustradinglabs.com/feed → group by wallet → compute repScore → sort desc → return top 5

**"Who has the highest win rate with ≥5 closed trades?"**
→ GET https://og.nexustradinglabs.com/feed → filter wallets where (HIT_TP + STOPPED_OUT) >= 5 → sort by wins/(wins+losses) desc

**"Copy the #1 trader's latest active BTC thesis with 2% of my $10k stack"**
→ build leaderboard → top wallet → find PERP_BTC_USDC ACTIVE thesis → size: $10k * 0.02 / (entry - sl) → GET /lab/:userWallet → append → PUT /lab/:userWallet

**"Publish my ETH short: entry 3200, SL 3350, TP 2800"**
→ GET /lab/:wallet → create thesis object → registerThesis("PERP_ETH_USDC", "SHORT", 320000000000, 335000000000, 280000000000) → parse ThesisRegistered event → update thesis with onChainId → PUT /lab/:wallet
