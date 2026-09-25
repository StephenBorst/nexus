// First-run welcome + onboarding checklist. Extracted from index.tsx.
import { useState } from "react";
import { cardStyle, navBtnStyle } from "./styles";

// ─── First-run Welcome (disconnected) ────────────────────
export function LabWelcome() {
  // Six, not five — a 3-column grid fills evenly at 6 and the second row no longer
  // looks like an afterthought. Ordered by the trader's lifecycle: scout → plan →
  // automate → validate → grade → record.
  const features = [
    { icon: "◆", title: "The Briefing · Live Signals", desc: "The market, the graded caller crowd and your own record, read together. It names the setups that fit you. Alerts in-app and on Telegram." },
    { icon: "◎", title: "Smart Money", desc: "What graded on-chain traders hold right now on Orderly and Hyperliquid. A Consistency Score on any wallet. Copy a move into a sized trade." },
    { icon: "◈", title: "The Nexus Thesis Engine", desc: "Size. R:R. Funding cost. Live P&L. Publish it and the call is timestamped on-chain." },
    { icon: "⬢", title: "Autonomous Trading Agent", desc: "Runs your strategy. Grades every close. Scale-outs, trailing exits, DCA, TradingView signals. Hard caps. Kill switch. Order-only keys." },
    { icon: "◇", title: "Strategy Workbench", desc: "Build by trading style. Backtest on recorded history. Publish it. Every result graded." },
    { icon: "▣", title: "Analytics & Journal", desc: "Trading score. Win rate and hold time. Leverage. A journal with a calendar heatmap." },
  ];
  return (
    <div style={{ padding: "32px 8px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#ededf0", letterSpacing: "0.3em", marginBottom: 12, textShadow: "0 0 12px rgba(237,237,240,0.5)" }}>THE LAB</div>
        <div style={{ fontFamily: "var(--nx-font-serif)", fontSize: 34, color: "#fff", fontWeight: 700, marginBottom: 14, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
          Plan it. Run it. <span style={{ fontStyle: "italic" }}>Prove it.</span>
        </div>
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13.5, color: "#a1a1aa", maxWidth: 580, margin: "0 auto", lineHeight: 1.6 }}>
          Plan the trade. Run it yourself or hand it to an agent. Every call graded from public price.
          Connect a wallet to load your data.
        </div>
      </div>
      {/* .nx-feature-grid carries grid-auto-rows:1fr so the 2-card second row can't
          render shorter than the 3-card first row — and drops it at single-column
          widths where it would just pad short cards. Media query => CSS, not inline. */}
      <div className="nx-feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "stretch", gap: 12, maxWidth: 760, margin: "0 auto 28px" }}>
        {features.map((f) => (
          <div key={f.title} style={{ ...cardStyle, padding: "16px 18px" }}>
            <div style={{ fontSize: 20, color: "#ededf0", marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12.5, color: "#fff", fontWeight: "bold", letterSpacing: "0.02em", marginBottom: 6 }}>{f.title}</div>
            <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#52525b", border: "1px solid #232327", borderRadius: 4, padding: "10px 18px", background: "#0a0a0b" }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ededf0", boxShadow: "0 0 8px #ededf0", animation: "pulse 2s infinite" }} />
          Connect your wallet (top right) to load your trades and activate The Lab
        </div>
        {/* This screen is only ever seen DISCONNECTED — so point at the one thing
            that needs no wallet at all. Best conversion surface we have here. */}
        <div style={{ marginTop: 12, fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#71717a" }}>
          Nothing to connect yet?{" "}
          <a href="/analyze" style={{ color: "#ededf0", textDecoration: "none", borderBottom: "1px solid #33333a" }}>
            X-ray any wallet free →
          </a>{" "}
          — read any trader&apos;s perp record on Hyperliquid and Orderly, no login.
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Activation Checklist ─────────────────────
export function OnboardingChecklist({
  hasThesis,
  hasTrade,
  hasAgent,
  onGoThesis,
  onGoAgent,
  onGoAnalytics,
}: {
  hasThesis: boolean;
  hasTrade: boolean;
  hasAgent: boolean;
  onGoThesis: () => void;
  onGoAgent: () => void;
  onGoAnalytics: () => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("lab_onboard_dismissed") === "1"
  );
  if (dismissed) return null;

  const steps = [
    { key: "connect", label: "Connect your wallet", hint: "Connected. Your data is loading.", done: true, action: null },
    { key: "thesis",  label: "Plan your first thesis", hint: "Size a trade. Stop, targets, funding cost.", done: hasThesis, action: onGoThesis, cta: "OPEN NEXUS THESIS ENGINE" },
    { key: "trade",   label: "Place your first trade", hint: "Trade anywhere on Nexus. It lands here.", done: hasTrade, action: null },
    // The flagship, and the lowest-friction "wow": PAPER needs no funds and no key, so a
    // brand-new user can watch the agent hunt funding edges hands-free on their first visit.
    { key: "agent",   label: "Run an agent in paper", hint: "No funds. No key. Your rules, on simulated fills.", done: hasAgent, action: onGoAgent, cta: "OPEN AGENT" },
    { key: "grade",   label: "Grade your performance", hint: "Trading score, breakdowns and journal.", done: hasTrade, action: onGoAnalytics, cta: "VIEW ANALYTICS" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round((doneCount / steps.length) * 100);

  const dismiss = () => {
    window.localStorage.setItem("lab_onboard_dismissed", "1");
    setDismissed(true);
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16, borderColor: allDone ? "#33333a" : "#232327" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#ededf0", letterSpacing: "0.12em" }}>
            {allDone ? "SET UP" : "GET STARTED"}
          </span>
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#52525b" }}>{doneCount}/{steps.length}</span>
        </div>
        <button onClick={dismiss} style={{ ...navBtnStyle, fontSize: 9, padding: "3px 10px", color: "#52525b" }}>
          {allDone ? "DISMISS" : "SKIP"}
        </button>
      </div>
      {/* Once every step is done the checklist has served its purpose — collapse to
          the single "you're set up" line. Rendering four struck-through rows forever
          is standing noise for an established trader (seen on prod: 136 closed
          trades, still carrying a 4/4 block). The DISMISS above still clears it. */}
      {allDone ? null : (
      <>
      <div style={{ height: 4, background: "#0a0a0b", borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#ededf0", transition: "width 0.4s", boxShadow: "0 0 8px rgba(237,237,240,0.5)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              border: `1px solid ${s.done ? "#ededf0" : "#33333a"}`,
              background: s.done ? "#ededf020" : "transparent",
              color: s.done ? "#ededf0" : "#33333a",
              fontFamily: "var(--nx-font-mono)", fontSize: 11, textAlign: "center", lineHeight: "17px",
            }}>{s.done ? "✓" : ""}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12.5, color: s.done ? "#a1a1aa" : "#fff", textDecoration: s.done ? "line-through" : "none" }}>{s.label}</div>
              <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11, color: "#52525b", marginTop: 1 }}>{s.hint}</div>
            </div>
            {!s.done && s.action && (
              <button onClick={s.action} style={{ ...navBtnStyle, fontSize: 9, padding: "5px 12px", color: "#ededf0", borderColor: "#33333a", flexShrink: 0 }}>
                {s.cta}
              </button>
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

