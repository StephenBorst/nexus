# Uniswap integration — feedback

Nexus Trading Labs is a non-custodial trading terminal. Perps settle on [Orderly](https://orderly.network); **spot** is where we lean on Uniswap. This is honest feedback from shipping that integration.

## Where we use Uniswap

The Nexus **Spot** terminal (`/token/:query`) prices and trades any EVM/Solana token from public data. Execution is a tiered, honest routing:

1. **In-app fill via Fabric** (a Uniswap-v4-aware router) when it quotes a route — 10 bps, exact-amount approve.
2. **Fallback: an honest Uniswap deep-link** when no aggregator quotes the pool. We never fake a fill — the button names the venue (Uniswap) and the exact chain + output token, or it shows a disabled "No route" state. Never a fake Buy.

Code:

- **Uniswap deep-link builder** (chain-param map + `outputCurrency`) — [`app/pages/token/Index.tsx:94-104`](app/pages/token/Index.tsx#L94-L104)
- **Route state machine** (`quote` → in-app · `deeplink` → named Uniswap link · `noroute` → disabled) — [`app/pages/token/Index.tsx:673-709`](app/pages/token/Index.tsx#L673-L709), rendered at [`:1684-1709`](app/pages/token/Index.tsx#L1684-L1709)
- **Our own token ($NEXUS) is a Uniswap v4 pool** — resolved for the terminal from GeckoTerminal (DexScreener doesn't index v4), then bought via the same Fabric/Uniswap path — [`app/pages/token/data.ts:161-187`](app/pages/token/data.ts#L161-L187), [`app/components/BuyNexusButton.tsx`](app/components/BuyNexusButton.tsx)

## What worked well

- **Deep-links are a reliable universal fallback.** `app.uniswap.org/swap?chain=<chain>&outputCurrency=<addr>` prefilled correctly for every EVM token we threw at it. When aggregators had no route, Uniswap always did — so "route via Uniswap" is our honest last mile.
- **v4 is where the deep liquidity is for launchpad-style tokens.** Our $NEXUS/WETH pool is a v4 pool with a custom hook + dynamic fee; the depth is real (~$50k).

## The one real pain point: v4-hook pools are invisible to indexers/aggregators

This cost us the most and is worth flagging:

- **DexScreener returns 0 pairs** for our v4-hooked $NEXUS token (`0x3D958634…`) even though the pool holds ~$50k. GeckoTerminal *does* index it, so we resolve the pair from there as a curated fallback — but a token terminal shouldn't have to special-case its own token because the standard indexer can't see a v4 pool.
- **Aggregators (LiFi, Fabric, etc.) return "No route found"** for the same v4-hooked pool while routing majors fine. It's not pool-specific — it's the v4-hook indexing gap. So we deep-link Uniswap (which *can* route it) as the honest fallback, and the in-app fill lights up automatically once an aggregator indexes the hook.
- **Ask:** first-class, documented indexing/quoting for **hooked v4 pools** (a public v4 quoter path or a subgraph that surfaces hooked pools by token) would let apps offer in-app v4 fills without per-pool special-casing.

## Net

Uniswap is our trust boundary for spot — when we can't route a token honestly ourselves, we hand the user a real Uniswap link rather than a fake button. Closing the v4-hook indexing gap is the single thing that would most improve the builder DX.
