// ── The web app manifest, as data — the ONE source for public/manifest.json ─────────────────────
// scripts/generate-manifest.ts writes this object to public/manifest.json and build/client/manifest.json
// on every build (deploy.yml runs it before and after `vite build`), so what ships is THIS, never a
// hand edit of the JSON. Hand edits used to be overwritten on deploy: production lost `id`, kept the
// off-brand #0a0e0a and named the plain icon as the maskable one. manifest.test.mjs pins the committed
// file to this object, the colours to the brand canvas, and every icon to a real PNG of its stated size.
import { BRAND } from "../../app/lib/brand.mjs";

const icon = (src, size, purpose) => ({ src, sizes: `${size}x${size}`, type: "image/png", ...(purpose ? { purpose } : {}) });
const shortcut = (name, short_name, description, url) => ({ name, short_name, description, url, icons: [icon("/icon-192.png", 192)] });

export const MANIFEST = Object.freeze({
  // A stable app identity: Chrome and the Play Store (TWA) key the installed app on it.
  id: "/",
  name: "Nexus Trading Labs",
  short_name: "Nexus",
  description: "An onchain trading terminal. Plan it. Run it. Prove it.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  // The page's own canvas (index.html theme-color, theme.ts C.canvas), so launch doesn't flash.
  background_color: BRAND.canvas,
  theme_color: BRAND.canvas,
  orientation: "any",
  icons: [
    icon("/icon-192.png", 192, "any"),
    icon("/icon-512.png", 512, "any"),
    icon("/icon-1024.png", 1024, "any"),
    // The mark sits inside the 80% safe circle, so a launcher's mask never crops it.
    icon("/icon-maskable-512.png", 512, "maskable"),
  ],
  categories: ["finance", "business"],
  shortcuts: [
    shortcut("The Lab", "Lab", "Plan, run and grade trades", "/lab"),
    shortcut("Trade", "Trade", "Perps on Orderly", "/perp"),
    shortcut("Feed", "Feed", "Graded calls, live", "/feed"),
    shortcut("Portfolio", "Portfolio", "Positions and balances", "/portfolio"),
  ],
  screenshots: [],
  related_applications: [],
  prefer_related_applications: false,
});

/** Exactly what the generator writes: 2-space JSON plus a final newline. */
export const manifestJson = () => JSON.stringify(MANIFEST, null, 2) + "\n";
