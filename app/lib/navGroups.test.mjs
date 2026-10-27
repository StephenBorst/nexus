import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDrawer, NAV_GROUPS } from "./navGroups.mjs";

// The drawer as config.tsx builds it today (primary bar, then More's children).
const DRAWER = [
  { name: "Markets", href: "/markets" }, { name: "Trade", href: "/" }, { name: "Spot", href: "/token" },
  { name: "Lab", href: "/lab" }, { name: "Feed", href: "/feed" }, { name: "Proof", href: "/proof" },
  { name: "Portfolio", href: "/portfolio" }, { name: "Vaults", href: "/vaults" }, { name: "Arena", href: "/arena" },
  { name: "Wallet X-Ray", href: "/analyze" }, { name: "Leaderboard", href: "/leaderboard" }, { name: "Points", href: "/points" },
  { name: "Rewards", href: "/rewards" }, { name: "Campaigns", href: "https://app.orderly.network/campaigns", target: "_blank" },
];

test("drawer: four groups in the agreed order, each link once", () => {
  const g = groupDrawer(DRAWER);
  assert.deepEqual(g.map((x) => x.label), ["Trade", "Lab", "Social", "Rewards"]);
  assert.deepEqual(g.map((x) => x.items.map((i) => i.name)), [
    ["Markets", "Trade", "Spot", "Portfolio", "Vaults"],
    ["Lab", "Proof", "Wallet X-Ray"],
    ["Feed", "Arena", "Leaderboard"],
    ["Points", "Rewards", "Campaigns"],
  ]);
  assert.equal(g.flatMap((x) => x.items).length, DRAWER.length);
});

test("drawer: a link no group names goes to More, never dropped; empty groups are left out", () => {
  const g = groupDrawer([...DRAWER.filter((i) => !["/points", "/rewards", "Campaigns"].includes(i.href) && i.name !== "Campaigns"), { name: "Docs", href: "https://docs.example" }]);
  assert.deepEqual(g.map((x) => x.label), ["Trade", "Lab", "Social", "More"]);
  assert.deepEqual(g.at(-1).items.map((i) => i.name), ["Docs"]);
});

test("drawer: a duplicate href is placed once per entry, and junk input is safe", () => {
  const g = groupDrawer([{ name: "Lab", href: "/lab" }, { name: "Lab", href: "/lab" }, null, { name: "x" }]);
  assert.deepEqual(g, [{ label: "Lab", items: [{ name: "Lab", href: "/lab" }, { name: "Lab", href: "/lab" }] }]);
  assert.deepEqual(groupDrawer(undefined), []);
});

test("drawer: no href is claimed by two groups", () => {
  const all = NAV_GROUPS.flatMap((g) => g.hrefs);
  assert.equal(new Set(all).size, all.length);
});
