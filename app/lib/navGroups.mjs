// ── Phone nav drawer groups (2026-10-27, borst) ─────────────────────────────────────────────────────
// The drawer was one flat list of 14 links. It now reads in four groups: Trade / Lab / Social / Rewards.
// Phone drawer only: the desktop bar and its More dropdown are the SDK's and stay as they are.
// A link is placed by its href (Campaigns by name: its href is an external URL). A link no group names
// goes to a trailing "More" group, so a new menu item can never drop out of the drawer.

export const NAV_GROUPS = [
  { label: "Trade", hrefs: ["/markets", "/", "/token", "/portfolio", "/vaults"] },
  { label: "Lab", hrefs: ["/lab", "/proof", "/analyze"] },
  { label: "Social", hrefs: ["/feed", "/arena", "/leaderboard"] },
  { label: "Rewards", hrefs: ["/points", "/rewards"], names: ["Campaigns"] },
];

/**
 * @param {{ name: string, href: string }[]} items the drawer's links, in bar order
 * @returns {{ label: string, items: object[] }[]} non-empty groups; inside a group, the group's own order
 */
export function groupDrawer(items) {
  const list = Array.isArray(items) ? items.filter((i) => i && typeof i.href === "string") : [];
  const used = new Set();
  const out = [];
  for (const g of NAV_GROUPS) {
    const picked = [];
    for (const href of g.hrefs) {
      list.forEach((it, i) => { if (!used.has(i) && it.href === href) { used.add(i); picked.push(it); } });
    }
    for (const name of g.names || []) {
      list.forEach((it, i) => { if (!used.has(i) && it.name === name) { used.add(i); picked.push(it); } });
    }
    if (picked.length) out.push({ label: g.label, items: picked });
  }
  const rest = list.filter((_, i) => !used.has(i));
  if (rest.length) out.push({ label: "More", items: rest });
  return out;
}
