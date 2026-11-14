// Is the reader typing into this element? (pure; tests: typingTarget.test.mjs) On a phone the keyboard
// lifts fixed controls with the visible viewport, so the ◆ copilot orb lands on the very field being
// typed in (an amount, a size, an address). The orb steps aside while one of these has focus.
const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);

export function isTypingTarget(el) {
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable === true) return true;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUTS.has(String(el.type || "text").toLowerCase());
}
