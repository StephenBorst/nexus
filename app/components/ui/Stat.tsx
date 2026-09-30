import type { ReactNode } from "react";
import { C } from "@/config/theme";

// ── Stat — a value over its label ───────────────────────────────────────────────
// Value in the UI face (tabular numbers), label as a mono eyebrow below. `color` is for money and
// price only (P&L, a 24h move); counts, rates and scores stay bone.
export function Stat({ label, value, color, size = "md", align = "left" }: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right" | "center";
}) {
  const fs = size === "lg" ? 22 : size === "sm" ? 13.5 : 15;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, textAlign: align }}>
      <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: fs, fontWeight: 600, color: color || C.text.bright, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", letterSpacing: size === "lg" ? "-0.01em" : undefined }}>{value}</span>
      <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, letterSpacing: "0.08em", color: C.text.faint, textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
