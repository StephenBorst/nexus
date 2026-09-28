# The Nexus brand — the rule every surface follows

Decided 2026-09-28 (borst, via Ember): the whole DEX wears the black landing brand. One rule
for the app, every share card and every link preview.

## The rule

1. **Surfaces are black.** Canvas `#0a0a0b`, surface `#141416`, panel `#0f0f11`, hairline
   borders `#232327` / `#33333a`. Nothing tinted (no green-black, no blue-black).
2. **Type is bone.** Headlines `#f4f4f5`; secondary `#a1a1aa`; labels `#71717a`; hints `#52525b`.
3. **Amber is the accent mark: `#fbbf24`, the landing's `--amber`.** It marks things: the 3px rule
   across the top of every share card and link preview, the active tab (top nav and Lab tabs),
   a section marker, the hairline on the PnL poster. **It is never a button** (buttons are bone,
   like the landing's) **and never body text.** Warnings keep their own wording and ⚠ glyph; the
   landing uses one amber, so we do too.
4. **Green `#3ecf8e` and red `#f7525f` mean money and price, nothing else:**
   - realized or unrealized P&L, a WIN / LOSS result and its R, a W / L tally, expectancy;
   - a price move (24h %, up/down ticks);
   - the Buy / Long and Sell / Short sides on the trade page.

   Everything else is monochrome: a LONG / SHORT label on a call, an entry / stop / take-profit
   level, a count, a rate, a score, a status like ACTIVE, a live dot, an "agrees / against" stance.

## Where it lives

| Surface | Source of truth |
|---|---|
| App UI (React) | `app/config/theme.ts` (`C`, incl. `C.amber`) |
| Orderly SDK pages (Markets, Trade, Portfolio) | `app/styles/theme.css` (`--oui-color-*`) |
| Share cards (thesis, identity, trader, Board, funding read, X-Ray) | `app/lib/brand.mjs` → `workers/nexus-lab-api/ogCards.mjs` + `routes-xrayshare.mjs` |
| Link previews + PnL poster (`public/embed-mini.png`, `public/pnl/poster_bg_1.*`, landing `preview.png`) | `tools/brand/previews.html` (render steps in `tools/brand/README.md`) |
| Landing | `nexus-landing/index.html` `:root` |

## What enforces it

- `workers/nexus-lab-api/ogCards.test.mjs` renders every share card with fixtures and fails on
  (a) any colour not in `brand.mjs`, (b) a card without the amber top rule, (c) green or red on a
  card that shows no money figure. It also pins `brand.mjs` to `theme.ts` value for value.
- `tools/check-palette.mjs` (every PR) fails any new colour in `app/` that isn't a `theme.ts` token.
- A new colour needs a named job in `theme.ts` first. A new share card goes through `brand.mjs`
  and gets a fixture in `ogCards.test.mjs`.

## Changing a preview image

The PNGs are renders; edit `tools/brand/previews.html`, re-render, commit both, and bump the
`?v=` on the `og:image` / `twitter:image` URLs in `index.html` — X and Farcaster cache a preview
by its URL, so a new image at the same URL can keep showing the old card for days.
