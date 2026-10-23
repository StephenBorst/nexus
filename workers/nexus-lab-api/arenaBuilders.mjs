// ── Arena builder groups — pure rules (no KV, no I/O) ──
// A builder slot on the Arena board is the set of registered wallets that have
// each SIGNED a claim to one builder name. A typed `builder` string on a
// registration never groups wallets by itself: anyone can type anyone's name.
//
// Claim rules (enforced by the route, which calls these):
//   - every wallet in the claim signs builderMessage(name) with its own key;
//   - a name that already has wallets can only be re-claimed by a claim that
//     includes ALL of them (an outsider can't take over a name);
//   - a wallet already grouped under another name can't be moved.
// The slot's record = every member's record, summed. Nothing is dropped, so a
// builder can't hide losing wallets by leaving them off the board.
import { agentScore, agentStanding } from "./logic.mjs";

export const MAX_BUILDER_WALLETS = 10;
export const BUILDER_MSG_PREFIX = "nexus-arena-builder-v1:";

// Lowercase, single-spaced, 2–40 chars of [a-z0-9 ._-], alnum at both ends.
export function normBuilderName(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return /^[a-z0-9][a-z0-9 ._-]{0,38}[a-z0-9]$/.test(s) ? s : null;
}

export function builderMessage(norm) {
  return BUILDER_MSG_PREFIX + norm;
}

// body = { builder: "Display Name", claims: [{ wallet, sig }, ...] }
// recover(message, sig) → lowercase address | null (injected so tests need no chain).
export function validateBuilderClaim(body, recover) {
  const name = String(body?.builder ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const norm = normBuilderName(name);
  if (!norm) return { ok: false, error: "builder_name_invalid", hint: "2–40 characters: letters, numbers, space, dot, dash, underscore." };
  if (!Array.isArray(body?.claims) || body.claims.length < 1) return { ok: false, error: "claims_required" };
  if (body.claims.length > MAX_BUILDER_WALLETS) return { ok: false, error: "too_many_wallets", hint: `Max ${MAX_BUILDER_WALLETS} wallets per builder.` };

  const seen = new Set();
  const wallets = [];
  for (const c of body.claims) {
    const wallet = String(c?.wallet ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return { ok: false, error: "wallet_invalid" };
    if (seen.has(wallet)) return { ok: false, error: "duplicate_wallet", wallet };
    seen.add(wallet);
    const signer = typeof c.sig === "string" ? recover(builderMessage(norm), c.sig) : null;
    if (!signer || signer.toLowerCase() !== wallet) return { ok: false, error: "bad_sig", wallet, hint: "Each wallet must sign the claim message itself." };
    wallets.push(wallet);
  }
  return { ok: true, name, norm, wallets };
}

// Sum per-wallet stat blocks into one slot block. Ratios are recomputed from the
// summed counts (never averaged). daysActive = the longest member's span: a lower
// bound, since per-wallet spans are not stored. A slot is "lifetime" only when every
// member is; a window member makes the slot a window too, and it cannot qualify.
function sumBlocks(blocks, paper) {
  const xs = blocks.filter(Boolean);
  if (!xs.length) return null;
  const s = (k) => xs.reduce((a, b) => a + (Number(b[k]) || 0), 0);
  const trades = s("trades"), wins = s("wins");
  const grossWin = s("grossWin"), grossLoss = s("grossLoss"), net = s("netPnl");
  const daysActive = Math.max(0, ...xs.map((b) => Number(b.daysActive) || 0));
  const { winRate, profitFactor, score } = agentScore({ trades, wins, grossWin, grossLoss, net, daysActive });
  const base = {
    trades, wins,
    winRate: Math.round(winRate * 1000) / 10,
    netPnl: Math.round(net * 100) / 100,
    profitFactor: Math.round(Math.min(profitFactor, 99) * 100) / 100,
    score, daysActive,
    grossWin: Math.round(grossWin * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
  };
  if (!paper) return base;
  const lifetime = xs.every((b) => b.lifetime);
  return {
    ...base,
    lifetime,
    resets: s("resets"),
    qualify: lifetime ? agentStanding({ trades, wins, grossWin, grossLoss, net, daysActive }) : null,
    ...(lifetime ? {} : { window: "last 50 trades (some wallets)" }),
  };
}

// Rank a member the way the board ranks rows: live records first, then score.
function memberRank(a, b) {
  return (b.live ? 1 : 0) - (a.live ? 1 : 0)
    || (b.live?.score ?? 0) - (a.live?.score ?? 0)
    || (b.paper?.score ?? 0) - (a.paper?.score ?? 0)
    || b.createdAt - a.createdAt;
}

// agents: per-wallet rows as the board builds them, each with `claim` = {norm, name}
// or null. Returns one slot per builder group (or per ungrouped wallet).
export function groupIntoSlots(agents) {
  const groups = new Map();
  for (const a of agents) {
    const key = a.claim?.norm ? `b:${a.claim.norm}` : `w:${a.wallet}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const slots = [];
  for (const members of groups.values()) {
    members.sort(memberRank);
    const lead = members[0];
    slots.push({
      wallet: lead.wallet,                 // representative: the detail page this links to
      name: lead.name,
      description: lead.description,
      builder: lead.claim?.name || lead.builder || "",
      wallets: members.map((m) => m.wallet),
      walletCount: members.length,
      createdAt: Math.min(...members.map((m) => m.createdAt || 0)),
      active: members.some((m) => m.active),
      mode: lead.mode,
      currentPosition: lead.currentPosition,
      paper: sumBlocks(members.map((m) => m.paper), true),
      live: sumBlocks(members.map((m) => m.live), false),
    });
  }
  slots.sort((a, b) => memberRank(a, b));
  return slots;
}
