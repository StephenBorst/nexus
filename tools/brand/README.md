# Brand artwork (source)

`previews.html` draws the link-preview and PnL-poster images. The PNGs in `public/` (and the
landing's `preview.png`) are 1× renders of it. The rule they follow is in `docs/brand.md`.

Render (dev server on :5173, Playwright pointed at the preinstalled Chromium):

```js
// node render.mjs <embed|poster|landing> <out.png>
import { chromium } from "playwright";
const [,, card, out] = process.argv;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto(`http://127.0.0.1:5173/tools/brand/previews.html?card=${card}`, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.locator("#card").screenshot({ path: out });
await b.close();
```

| `card` | Writes | Size |
|---|---|---|
| `embed` | `public/embed-mini.png` (trade.* unfurl + Farcaster embed) | 1200×800 |
| `poster` | `public/pnl/poster_bg_1.png` and `.webp` (the PnL share poster) | 1104×620 |
| `landing` | `nexus-landing/preview.png` | 1200×630 |

The poster's left half stays dark and empty: Orderly draws its own title, %, stats and QR there.
The live poster is the `.webp` (`VITE_CUSTOM_PNL_POSTER_COUNT` = 1); encode it from the PNG
(e.g. a canvas `toDataURL("image/webp", 0.92)` in the same Chromium). After changing a preview,
bump the `?v=` on its URL in `index.html` so X and Farcaster re-fetch it.
