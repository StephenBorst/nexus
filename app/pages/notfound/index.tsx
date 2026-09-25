// ── 404 — a wrong turn, answered calmly, with a way back ──────────────────────────
// Rendered inside the app shell (nav stays) by the catch-all route. Before this, an unknown URL
// fell through to the router's crash screen ("An unexpected error occurred" + a stack trace).
import { Link, useLocation } from "react-router-dom";
import { PageMeta } from "@/components/PageMeta";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const LINKS: [string, string, string][] = [
  ["/lab", "The Lab", "Plan it. Run it. Prove it."],
  ["/perp/PERP_BTC_USDC", "Trade", "perps on Orderly"],
  ["/proof", "Proof", "graded track records"],
  ["/markets", "Markets", "every listed pair"],
];

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 16px", background: "#0a0a0b" }}>
      <PageMeta title="Not found" noindex />
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.22em", color: "#71717a", marginBottom: 14 }}>{"// 404"}</div>
        <h1 style={{ fontFamily: UI, fontSize: 28, fontWeight: 700, color: "#f4f4f5", margin: "0 0 10px", lineHeight: 1.2 }}>Nothing lives at this address.</h1>
        <p style={{ fontFamily: UI, fontSize: 14, color: "#a1a1aa", lineHeight: 1.6, margin: "0 0 24px", overflowWrap: "anywhere" }}>
          <span style={{ fontFamily: MONO, fontSize: 12.5, color: "#71717a" }}>{pathname}</span> is not a page on Nexus. It moved, or the link is wrong.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {LINKS.map(([to, label, sub]) => (
            <Link key={to} to={to} className="nx-press" style={{ display: "block", textDecoration: "none", border: "1px solid #232327", borderRadius: 6, background: "#141416", padding: "12px 14px" }}>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#ededf0", letterSpacing: "0.04em" }}>{label} →</div>
              <div style={{ fontFamily: UI, fontSize: 12, color: "#71717a", marginTop: 3 }}>{sub}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
