// Market Intel tab (Intel + News sub-toggle). Extracted from index.tsx.
import { C } from "@/config/theme";
import { useState } from "react";
import { navBtnStyle } from "./styles";
import IntelPage from "@/pages/intel";
// NEWS = the shared wire (NewsWire.tsx): read by our server (GET /intel/news), coin-tagged. The old browser fetch via a
// third-party RSS relay (it saw every reader) is gone (2026-11-20); its Defiant clock-cluster guard lives on in
// app/lib/newsWire.mjs feedItems.
import { NewsWire } from "./NewsWire";

// ─── AgentView ───────────────────────────────────────────

// ─── Main Page ───────────────────────────────────────────
// ─── Market Intel (Intel + News merged) ──────────────────
export function MarketIntelView() {
  const [sub, setSub] = useState<"intel" | "news">("intel");
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 9, color: "#71717a", fontFamily: "var(--nx-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 5 }}>Scout</div>
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 24, fontWeight: 600, color: C.text.bright, lineHeight: 1.1, letterSpacing: "-0.02em" }}>The Market Terminal</div>
      </div>
      {/* MarketTape moved to the DECISION tabs (thesis/agent) as a thin regime strip —
          IntelPage below already leads with sentiment, so a second score here was
          redundant. Signal belongs where the decision is. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([
          { id: "intel" as const, label: "INTEL" },
          { id: "news" as const, label: "NEWS" },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setSub(id)} style={{
            ...navBtnStyle, fontSize: 10, padding: "5px 16px",
            color: sub === id ? "#ededf0" : "#52525b",
            borderColor: sub === id ? "#33333a" : "#232327",
            background: sub === id ? "#1a1a1e" : "transparent",
          }}>{label}</button>
        ))}
      </div>
      {sub === "intel" ? <IntelPage embedded /> : <NewsWire />}
    </div>
  );
}

