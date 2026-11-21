// ⌘K as a command line (borst 2026-11-20, terminal step 3): type a coin and go. Pure, tested (terminalCommand.test.mjs);
// the palette (app/pages/lab/CommandPalette.tsx) turns each intent into its action.
//   "eth" / "ETH" / "$eth"  → open ETH's drawer (every lens + its news), or trade it
//   "0x…40 hex"            → that wallet's X-Ray
//   "vitalik.eth"          → that name's X-Ray (resolved on the page, which grades the address it points to)
//   "news" / "wire"        → the news lens / the Wire
// A coin the terminal knows (the news wire's list) leads the results; any other ticker-shaped word is offered after
// the menu's own matches, so "agent" still finds the Trading Agent first.
import { NEWS_COINS } from "./newsWire.mjs";

const KNOWN = new Set(Object.keys(NEWS_COINS));
const TICKER = /^\$?([A-Za-z][A-Za-z0-9]{1,9})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ENS = /^(?:[a-z0-9_\-\u0080-\uffff]+\.)+eth$/i;

/**
 * @returns {{ lead: Array<{id,label,hint,intent}>, tail: Array<{id,label,hint,intent}> }}
 *   lead = shown before the menu's own matches; tail = after. intent: {kind:"market"|"trade"|"xray"|"news"|"wire", coin?, address?}
 */
export function terminalCommands(query) {
  const q = String(query ?? "").trim();
  const lead = [], tail = [];
  if (!q) return { lead, tail };
  if (ADDRESS.test(q)) {
    lead.push({ id: `xray:${q.toLowerCase()}`, label: `X-Ray ${q.slice(0, 6)}…${q.slice(-4)}`, hint: "wallet", intent: { kind: "xray", address: q } });
    return { lead, tail };
  }
  if (ENS.test(q)) {
    const name = q.toLowerCase();
    lead.push({ id: `xray:${name}`, label: `X-Ray ${name}`, hint: "ENS", intent: { kind: "xray", name } });
    return { lead, tail };
  }
  const lower = q.toLowerCase();
  if (lower === "news") lead.push({ id: "go:news", label: "News, tagged by coin", hint: "lens", intent: { kind: "news" } });
  if (lower === "wire") lead.push({ id: "go:wire", label: "The Wire", hint: "home", intent: { kind: "wire" } });
  const m = TICKER.exec(q);
  if (m) {
    const coin = m[1].toUpperCase();
    const rows = [
      { id: `market:${coin}`, label: `${coin}: every lens and its news`, hint: "coin", intent: { kind: "market", coin } },
      { id: `trade:${coin}`, label: `Trade ${coin}`, hint: "perp", intent: { kind: "trade", coin } },
    ];
    (KNOWN.has(coin) ? lead : tail).push(...rows);
  }
  return { lead, tail };
}

/** The route a trade intent opens. */
export const tradePath = (coin) => `/perp/PERP_${String(coin).toUpperCase()}_USDC`;
