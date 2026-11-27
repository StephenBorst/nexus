// On-chain anchoring is OFF (ONCHAIN_ANCHOR_LIVE="false" in nexus-ledger-anchor + lab-api wrangler.toml; borst
// 2026-11-26 "keep it off, $0"). While it is off, no public copy may say the record is anchored on-chain: the ledger
// is hash-chained and recomputable, and that is what we say. The Arbitrum links that render only on a VERIFIED anchor
// (/proof footer, AgentView, Feed's call ledger) stay as they are. Turning anchoring back on = its own PR that
// flips both flags and can then restore the words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const flag = (p) => (read(p).match(/^ONCHAIN_ANCHOR_LIVE\s*=\s*"([^"]*)"/m) || [])[1];

test("anchoring off ⇒ no public copy claims the record is anchored on-chain", () => {
  const off = flag("workers/nexus-ledger-anchor/wrangler.toml") !== "true" && flag("workers/nexus-lab-api/wrangler.toml") !== "true";
  if (!off) return;
  const files = [
    "public/llms.txt", "workers/nexus-lab-api/ogCards.mjs", "app/pages/lab/SharePoster.tsx", "app/pages/lab/AgentView.tsx",
    "marketing/VOICE.md", "marketing/play-store/listing.md", "marketing/solana-dapp-store/listing.md", "marketing/distribution-kit.md",
  ];
  for (const f of files) assert.doesNotMatch(read(f), /anchored on[- ]?(arbitrum|chain)|on-?chain-anchored/, f);
  const proof = read("app/pages/proof/index.tsx");
  assert.doesNotMatch(proof, /Verify on Arbitrum/, "no Arbitrum link to an anchor that posts nothing");
  assert.match(proof, /onChain\?\.verified && \(/, "the Arbitrum link renders only on a verified anchor");
});
