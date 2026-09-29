// Watch-only banner — shown to disconnected visitors so the public surfaces
// (LIVE NOW, ranks, desks, calls) read as an open "explore before you connect"
// experience instead of a wall. Kills cold-start friction: you see the value
// first, connect only when you want to act (trade / copy / join a desk).
// Dismissible (remembered), and the connect CTA defers to the app's own connect.
import { useState } from "react";
import { useWalletConnector } from "@orderly.network/hooks";
import { C } from "@/config/theme";

const DISMISS_KEY = "nexus_watch_dismissed";

export default function WatchOnlyBanner() {
  const [hidden, setHidden] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1");
  // The banner told people to "connect" but gave them no button — the connect
  // affordance lived only in the nav. This is the conversion moment for share-loop
  // traffic, so the CTA acts right here (triggers the app's own wallet modal).
  const { connect } = useWalletConnector();
  if (hidden) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderLeft: `2px solid ${C.brand}`, borderRadius: 8, padding: "12px 14px", marginBottom: 14, flexWrap: "wrap", rowGap: 10 }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 14, fontWeight: 600, color: C.text.bright }}>Watch-only. No wallet connected.</div>
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: C.text.fog, marginTop: 3, lineHeight: 1.5 }}>Live positions, verified callers and desks are public. Connect to trade, copy or join a desk.</div>
      </div>
      <button
        onClick={() => { try { connect(); } catch { /* SDK not ready */ } }}
        style={{ flexShrink: 0, background: C.accent, border: `1px solid ${C.accent}`, color: C.canvas, cursor: "pointer", fontFamily: "var(--nx-font-ui)", fontSize: 13, fontWeight: 600, height: 32, padding: "0 16px", borderRadius: 16 }}
      >Connect</button>
      <button
        onClick={() => { setHidden(true); try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } }}
        aria-label="Dismiss"
        style={{ flexShrink: 0, background: "none", border: "none", color: C.text.faint, cursor: "pointer", fontSize: 14 }}
        title="Dismiss"
      >✕</button>
    </div>
  );
}
