// The phone pass on the money screens (2026-11-13): rules + where they're wired. Source pins, because
// these are layout guarantees a later edit could quietly undo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTypingTarget } from "./typingTarget.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const SPOT = read("../pages/token/Index.tsx");

test("isTypingTarget: text fields yes, buttons and toggles no", () => {
  for (const el of [{ tagName: "INPUT" }, { tagName: "input", type: "text" }, { tagName: "INPUT", type: "number" }, { tagName: "INPUT", type: "search" },
    { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) assert.equal(isTypingTarget(el), true, JSON.stringify(el));
  for (const el of [null, undefined, {}, { tagName: "BUTTON" }, { tagName: "INPUT", type: "checkbox" }, { tagName: "INPUT", type: "radio" },
    { tagName: "INPUT", type: "button" }, { tagName: "INPUT", type: "range" }, { tagName: "A" }, { tagName: "BODY" }]) assert.equal(isTypingTarget(el), false, JSON.stringify(el));
});

test("the ◆ orb steps aside while a text field has focus (the keyboard would park it on the field)", () => {
  const a = read("../components/NexusAssistant.tsx");
  assert.match(a, /const typing = useTypingFocus\(isMobile && !open\);/);
  assert.match(a, /const orbHidden = useHideOnScrollDown\(isMobile && !open\) \|\| typing;/);
});

test("confirm dialogs can always reach their button: the backdrop scrolls, the dialog centers by margin", () => {
  const xc = read("../pages/token/CrossChainCard.tsx");
  for (const [src, label] of [[SPOT, 'aria-label="Confirm swap"'], [SPOT, 'aria-label="Confirm Solana swap"'], [xc, 'aria-labelledby="xc-review-title"']]) {
    const i = src.indexOf(label); assert.ok(i > 0, label);
    const around = src.slice(Math.max(0, i - 400), i + 450);
    assert.match(around, /overflowY: "auto"/, `${label}: the backdrop scrolls`);
    assert.match(around, /margin: "auto"/, `${label}: centered by margin, so a tall dialog starts at the top`);
    const fixedAt = around.lastIndexOf('position: "fixed"');
    const backdrop = around.slice(fixedAt, around.indexOf("}}", fixedAt));
    assert.doesNotMatch(backdrop, /alignItems: "center"/, `${label}: the backdrop doesn't center-clip`);
  }
});

test("ticker names in money buttons are capped, and the sticky buttons can't push past their half", () => {
  const sticky = SPOT.slice(SPOT.indexOf("isMobile && pair && !ticketInView"), SPOT.indexOf("isMobile && pair && !ticketInView") + 1200);
  assert.match(sticky, /minWidth: 0, height: 42, padding: "0 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"/);
  assert.match(sticky, /\{tickerLabel\(pair\.baseSymbol\)\}/);
  assert.equal((SPOT.match(/on \{swapState\.(completeVenue|venue)\} →/g) || []).length, 2);
  assert.equal((SPOT.match(/\{tickerLabel\(pair\.baseSymbol\)\} on \{swapState\.(completeVenue|venue)\} →/g) || []).length, 2, "both venue CTAs cap the ticker");
  assert.match(read("../pages/token/FlashSpotButton.tsx"), /\{tickerLabel\(symbol\)\} via Flash/);
});

test("every swap error spot on the ticket says it plainly with the next step (SwapNotice), none raw", () => {
  assert.equal((SPOT.match(/<SwapNotice /g) || []).length, 5);
  assert.doesNotMatch(SPOT, /color: NEG[^>]*>\{(swapErr|solErr)\}<\/div>/, "no raw red error line left");
});

test("a pasted address in the not-found heading wraps", () => {
  assert.match(SPOT, /overflowWrap: "anywhere" \}\}>No verified market for/);
});
