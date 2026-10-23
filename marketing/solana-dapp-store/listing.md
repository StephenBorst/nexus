# Solana dApp Store listing — Nexus Trading Labs

Same app as Google Play (the live site in a Trusted Web Activity), listed on Solana Mobile's dApp Store
(Seeker / Saga). Runbook: `docs/android-app.md` step 6.

Assets in this folder:

| File | Slot | Spec |
|---|---|---|
| `icon-512.png` | App icon | 512×512 PNG. |
| `banner-1200x600.png` | Banner | 1200×600 PNG. Source: `graphic.html?w=1200&h=600`. |
| `feature-graphic-1200x1200.png` | Feature graphic (optional, for featured placement) | 1200×1200 PNG. Source: `graphic.html?w=1200&h=1200`. |
| `phone-1-feed.png` | Screenshot 1 | 1080×1920. The Feed, real calls. |
| `phone-2-proof.png` | Screenshot 2 | 1080×1920. The Proof page. |
| `phone-3-scoreboard.png` | Screenshot 3 | 1080×1920. The signal scoreboard, misses included. |
| `phone-4-spot.png` | Screenshot 4 | 1080×1920. Spot: Solana majors, cross-chain to SOL. |

The store asks for at least 4 screenshots, each at least 1080px on both sides, same orientation. Screenshots
1–3 are the Play set (2026-10-14); 4 was rendered 2026-10-23. `graphic.html` loads Manrope from
`public/fonts` and IBM Plex Mono from `node_modules/@fontsource`, so render it from a checkout with
dependencies installed.

## Short description

Trade perpetuals onchain. Plan it. Run it. Prove it.

## Full description

Nexus is a non-custodial perpetuals trading terminal built on Orderly Network. Connect a Solana or EVM
wallet and trade BTC, ETH, SOL and 90+ markets. Your keys never leave your wallet.

Plan it. Run it. Prove it.

• Write a trade thesis with entry, stop and target, and publish it to the feed.
• Every published call is graded against public price. The record is anchored on Arbitrum.
• Hand an agent your rules. It runs on paper first, and trades live only when you say so.
• Spot: Solana tokens route through Jupiter. Move USDC to Solana from Arbitrum, Base or Ethereum in one transfer.
• Live marks, funding rates and open positions in one terminal.
• No signup. Connect a wallet and trade.

Trading perpetuals is high risk. Leverage can liquidate your position. Nothing in this app is financial advice.

## Links

- Website: https://nexustradinglabs.com
- App: https://trade.nexustradinglabs.com
- Privacy policy: https://nexustradinglabs.com/privacy
- Support: nexustradinglabs@proton.me
