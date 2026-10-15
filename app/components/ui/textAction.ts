import type { CSSProperties } from "react";

// ── Text actions — the one style for header actions on the call page and the trader profile ───────
// Plain text, no box: UI face, fog → bright on hover (the .nx-text-action class in index.css). The
// visible text is small, but the tap target is 44px tall so it works under a thumb on a phone.
// Use it for page-level actions (Discuss, Follow, Message, Share, Link, Back); a form submit or a
// money action keeps <Button>.
export const TEXT_ACTION_CLASS = "nx-text-action";
export const TEXT_ACTION: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 44,
  background: "none", border: "none", padding: "0 2px", cursor: "pointer", textDecoration: "none",
  fontFamily: "var(--nx-font-ui)", fontSize: 13, fontWeight: 600, color: "#a1a1aa", whiteSpace: "nowrap",
};
// The action bar both pages share: one row on desktop, wraps on a phone.
export const TEXT_ACTION_BAR: CSSProperties = {
  display: "flex", alignItems: "center", gap: 18, padding: "2px 16px", borderBottom: "1px solid #232327",
  background: "#0f0f11", flexWrap: "wrap", rowGap: 0,
};
