import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { swapNotice, cleanReason } from "./swapNotice.mjs";
import { tickerLabel, TICKER_MAX } from "./tickerLabel.mjs";

// Every message the signers can throw, read from their source, so a new one can't slip past unsorted.
const SOURCES = ["../pages/token/swapExec.ts", "../pages/token/solSwapExec.ts", "./jupBuild.mjs", "./solSwapGuards.mjs"];
const thrown = () => {
  const out = new Set();
  for (const f of SOURCES) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/new Error\("([^"]+)"\)|return "([^"]+)";/g)) out.add(m[1] || m[2]);
  }
  return [...out].filter((s) => /[A-Z]/.test(s[0]) && s.length > 12);
};

test("every refusal a guard throws reads as 'stopped before your wallet signed' with the venue as the way on", () => {
  const guards = thrown().filter((s) => /— (refused|aborted|not signing)|refused\.|not signing/.test(s));
  assert.ok(guards.length >= 40, `found ${guards.length}`);
  for (const g of guards) {
    const n = swapNotice(g);
    assert.equal(n.kind, "guard", g);
    assert.equal(n.venue, true, g);
    assert.match(n.headline, /Nothing moved/);
    assert.ok(n.why && !/refused|deep-link/i.test(n.why), `why stays precise, minus the jargon: ${n.why}`);
  }
});

test("no in-app route → the venue; reverted → retry; cancelled → nothing; input → the message itself", () => {
  for (const m of ["No in-app route right now — use the deep-link.", "Route isn't executable — use the deep-link.", "In-app swap isn't available on this chain — use the deep-link.", "No Jupiter route right now — use the deep-link.", "Your wallet can't sign a Solana transaction here — use the deep-link."]) {
    const n = swapNotice(m); assert.equal(n.kind, "unavailable", m); assert.equal(n.venue, true); assert.doesNotMatch(n.why || "", /deep-link/);
  }
  assert.equal(swapNotice("No in-app route right now — use the deep-link.").why, null, "no echo of the headline");
  assert.equal(swapNotice("Route isn't executable — use the deep-link.").why, "Route isn't executable.");
  const r = swapNotice("Swap reverted on-chain (price moved past the min received). Nothing was spent beyond gas — try again.");
  assert.equal(r.kind, "reverted"); assert.equal(r.venue, false);
  assert.equal(swapNotice("Swap failed on-chain — nothing was swapped (only network fees).").kind, "reverted");
  for (const c of ["Cancelled in your wallet.", "MetaMask Tx Signature: User denied transaction signature."]) assert.equal(swapNotice(c).kind, "cancelled", c);
  for (const i of ["Enter at least $1 to swap.", "Connect a wallet to swap in-app.", "Wrong network — switch to complete the swap.", "You don't hold this token to sell."]) {
    const n = swapNotice(i); assert.equal(n.kind, "input", i); assert.equal(n.headline, i); assert.equal(n.venue, false);
  }
  assert.equal(swapNotice("").headline, "");
});

test("cleanReason drops the tail jargon, keeps the reason", () => {
  assert.equal(cleanReason("Route uses a contract we haven't verified — refused. Use the deep-link."), "Route uses a contract we haven't verified.");
  assert.equal(cleanReason("Couldn't verify the route's lookup tables — not signing."), "Couldn't verify the route's lookup tables.");
  assert.equal(cleanReason("Route isn't executable — use the deep-link."), "Route isn't executable.");
});

test("tickerLabel: whole up to 10 characters, else 9 and an ellipsis", () => {
  assert.equal(TICKER_MAX, 10);
  assert.equal(tickerLabel("AERO"), "AERO");
  assert.equal(tickerLabel("FARTCOIN"), "FARTCOIN");
  assert.equal(tickerLabel("ABCDEFGHIJ"), "ABCDEFGHIJ");
  assert.equal(tickerLabel("SUPERLONGTICKERNAME"), "SUPERLONG…");
  assert.equal(Array.from(tickerLabel("🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀")).length, 10, "counts characters, not UTF-16 units");
  assert.equal(tickerLabel(null), "");
});
