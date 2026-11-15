// app/lib/crossFunding.mjs. Run: node --test app/lib/crossFunding.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { annualize, hlFunding, okxFunding, venueRows, venueLine } from "./crossFunding.mjs";

test("every venue annualized the same way, from its own period", () => {
  assert.equal(annualize(0.0001, 8), 10.95);       // Orderly / OKX 8h: 0.01% → 10.95%/yr
  assert.equal(annualize(0.0000125, 1), 10.95);    // Hyperliquid hourly
  assert.equal(annualize("x", 8), null);
  assert.equal(annualize(0.0001, 0), null);
});

test("Hyperliquid metaAndAssetCtxs: hourly funding by asset name; delisted and junk left out", () => {
  const reply = [
    { universe: [{ name: "BTC" }, { name: "ETH" }, { name: "OLD", isDelisted: true }, { name: "JUNK" }] },
    [{ funding: "0.0000125" }, { funding: "-0.00001" }, { funding: "0.001" }, { funding: "nope" }],
  ];
  assert.deepEqual(hlFunding(reply), { BTC: 10.95, ETH: -8.76 });
  assert.deepEqual(hlFunding(null), {});
});

test("OKX funding-rate: from its own settlement interval, 8h when unread", () => {
  const t0 = 1_700_000_000_000;
  assert.equal(okxFunding({ code: "0", data: [{ fundingRate: "0.0001", fundingTime: String(t0), nextFundingTime: String(t0 + 8 * 3.6e6) }] }), 10.95);
  assert.equal(okxFunding({ code: "0", data: [{ fundingRate: "0.0001", fundingTime: String(t0), nextFundingTime: String(t0 + 4 * 3.6e6) }] }), 21.9);
  assert.equal(okxFunding({ code: "0", data: [{ fundingRate: "0.0001" }] }), 10.95);
  assert.equal(okxFunding({ code: "51001", data: [] }), null);
});

test("rows: Orderly vs the venues read, sorted by the gap; the plain line", () => {
  const rows = venueRows({ orderly: { ETH: 11, BTC: 10.9, XAU: -149 }, hyperliquid: { ETH: 8.8, BTC: 10.95 }, okx: { ETH: 9.6 } });
  assert.deepEqual(rows.map((r) => r.coin), ["ETH", "BTC", "XAU"]);
  assert.equal(rows[0].gap, 1.8);
  assert.equal(rows[2].gap, null, "a coin no other venue lists has no gap");
  assert.equal(venueLine(rows[0]), "Orderly longs pay 11.0%/yr · Hyperliquid 8.8% · OKX 9.6%. Longs pay 1.8 pts/yr more here than elsewhere.");
  assert.equal(venueLine(rows[1]), "Orderly longs pay 10.9%/yr · Hyperliquid 10.9%. In line with the other venues.");
  assert.equal(venueLine(rows[2]), "Orderly shorts pay 149.0%/yr.");
  for (const r of rows) assert.doesNotMatch(venueLine(r), /arbitrage|free money|edge|risk-free/i);
});

test("wired: a Venues lens on Lab home, a Funding elsewhere lens in the drawer (not graded)", async () => {
  const { readFileSync } = await import("node:fs");
  const { composeMarket } = await import("./marketRead.mjs");
  const { lensFromQuery } = await import("./intelLenses.mjs");
  assert.equal(lensFromQuery("venues"), "venues");
  const m = composeMarket({ coin: "ETH", venues: { row: { coin: "ETH", orderly: 11, hyperliquid: 8.8, okx: 9.6, gap: 1.8 } } });
  const l = m.lenses.find((x) => x.id === "venues");
  assert.match(l.line, /^Orderly longs pay 11\.0%\/yr · Hyperliquid 8\.8% · OKX 9\.6%\./);
  assert.equal(composeMarket({ coin: "ETH", venues: { row: { coin: "ETH", orderly: 11, hyperliquid: null, okx: null, gap: null } } }).lenses.some((x) => x.id === "venues"), false);
  assert.match(readFileSync(new URL("../../workers/nexus-lab-api/routes-market.mjs", import.meta.url), "utf8"), /venues: `\/intel\/funding-venues\/\$\{coin\}`/);
  assert.match(readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8"), /if \(id === "venues"\) return <FundingVenues \/>;/);
});
