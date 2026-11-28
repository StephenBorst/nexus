// The Lab's deep boards say what they measure (Lab pass 2026-11-28). Run: node --test app/lib/deepBoards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const visible = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("Positioning: funding + wallets agreeing is 'same way', never confluence or conviction; sides in ink", () => {
  const s = visible(read("../pages/lab/PositioningBoard.tsx"));
  assert.doesNotMatch(s, /label: "◆ CONFLUENCE"|confluence tightens|High-conviction|◆ draft|◆ MY MARKETS|it’s <b[^>]*>confluence/);
  assert.doesNotMatch(s, /"#3ecf8e"|"#f7525f"/);
  assert.match(s, /not graded together/);
});

test("Funding board: the ungraded FADE verdict doesn't wear the scoreboard's ◆", () => {
  const s = visible(read("../pages/lab/MispricedBoard.tsx"));
  assert.doesNotMatch(s, /`◆ FADE \$\{m\.direction\}`|"◆ WATCHING"/);
});

test("Catalysts: the event→market mapping is a fixed rule, not 'a trade you can take'; sides in ink; fits a phone", () => {
  const s = visible(read("../pages/lab/CatalystBoard.tsx"));
  assert.doesNotMatch(s, /your trades|A TRADE YOU CAN TAKE|short CL|long NAS/);
  assert.doesNotMatch(s, /direction === "LONG" \? C\.pos : C\.neg|RISK_ON" \? C\.pos/);
  assert.match(s, /not graded/);
  assert.match(s, /minmax\(min\(340px, 100%\), 1fr\)/);
});

test("Q Signals: Quotient's conviction and model gap in ink, never money green", () => {
  const s = visible(read("../pages/lab/QSignals.tsx"));
  assert.doesNotMatch(s, /tier >= 3 \? POS/);
  assert.doesNotMatch(s, /upside <b style=\{\{ color: POS/);
  assert.doesNotMatch(s, /perp\.direction === "LONG" \? POS : NEG/);
  assert.doesNotMatch(s, /◆ Stake thesis/);
});
