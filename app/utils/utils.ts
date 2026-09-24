import { getRuntimeConfig } from "./runtime-config";

export function generatePageTitle(title: string) {
  return `${title} | ${getRuntimeConfig("VITE_ORDERLY_BROKER_NAME")}`;
}

export function formatSymbol(symbol: string, format = "base-type") {
  const arr = symbol.split("_");
  const type = arr[0];
  const base = arr[1];
  const quote = arr[2];

  return format
    .replace("type", type)
    .replace("base", base)
    .replace("quote", quote);
}

/**
 * Strip an Orderly full symbol down to the bare base ticker for display.
 * Orderly appends a broker suffix to many markets (e.g. PERP_XLM_USDC_mythos,
 * PERP_ALPIX_USDC_alpix) — 60 of 133 markets carry one. The naive
 * .replace("PERP_", "").replace("_USDC", "") leaves "XLM_mythos" on screen
 * and breaks joins against feeds that emit bare symbols (the /signals API).
 */
export function bareTicker(symbol: string | null | undefined): string {
  if (!symbol) return "";
  const m = /^PERP_([^_]+)_USDC(?:_.*)?$/.exec(symbol);
  if (m) return m[1];
  return symbol.replace("PERP_", "").replace("_USDC", "");
}
