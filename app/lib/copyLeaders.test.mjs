// app/lib/copyLeaders.mjs. Run: node --test app/lib/copyLeaders.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyLeaders, mineLine } from "./copyLeaders.mjs";

const copy = (w, over = {}) => ({ copiedFromWallet: w, status: "ACTIVE", ...over });

test("copies group by caller, with the caller's whole record and why they aren't ranked", () => {
  const records = new Map([["0xaa", { graded: 43, wins: 15, netR: 1.47 }], ["0xbb", { graded: 3, wins: 2, netR: 2 }], ["0xcc", { graded: 9, wins: 2, netR: -3.1 }]]);
  const out = copyLeaders(
    [copy("0xAA"), copy("0xaa", { gradedOutcome: "WIN" }), copy("0xaa", { status: "STOPPED_OUT" }), copy("0xBB"), copy("0xcc", { status: "INVALIDATED" }), { status: "ACTIVE" }],
    records, new Set(["0xaa"]), new Map([["0xaa", "Banksy"]]),
  );
  assert.deepEqual(out.map((l) => l.wallet), ["0xaa", "0xcc", "0xbb"]);
  assert.equal(out[0].name, "Banksy");
  assert.equal(out[0].ranked, true);
  assert.equal(out[0].why, null);
  assert.equal(mineLine(out[0].mine, out[0].copies.length), "Your copies: 3 · 1 open · 1 won · 1 stopped");
  assert.equal(out[1].why, "Not ranked: net R is not positive.");
  assert.equal(out[2].why, "Not ranked: 3 of 5 graded calls so far.");
});

test("a caller with nothing graded in the feed reads as zero, never invented", () => {
  const [l] = copyLeaders([copy("0xdd")], new Map(), new Set());
  assert.deepEqual(l.record, { graded: 0, wins: 0, netR: 0 });
  assert.equal(l.why, "Not ranked: 0 of 5 graded calls so far.");
});

test("the tab groups by leader and keeps green/red for money only", () => {
  const src = readFileSync(new URL("../pages/lab/CopiesView.tsx", import.meta.url), "utf8");
  assert.match(src, /copyLeaders\(/);
  assert.match(src, /recordLine\(/);
  assert.doesNotMatch(src, /t\.direction === "LONG" \? "#3ecf8e"/);
});
