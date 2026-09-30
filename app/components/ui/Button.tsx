import type { ButtonHTMLAttributes, ReactNode } from "react";
import { C } from "@/config/theme";

// ── Button — an action ─────────────────────────────────────────────────────────
// Buttons are bone (docs/brand.md): primary = bone fill, secondary = hairline, ghost = text.
// `side` is the ONE exception and is for the final step that moves money (Confirm swap, Confirm
// & sign, Long/Short): buy = green, sell = red, so a mis-tap between the two is visible before
// the wallet opens. Don't use `side` for anything that doesn't place, sign or send an order.
export type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({ children, variant = "secondary", side, full, size = "md", style, ...rest }: {
  children: ReactNode;
  variant?: ButtonVariant;
  side?: "buy" | "sell";
  full?: boolean;
  size?: "sm" | "md" | "lg";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const fill = side ? (side === "buy" ? C.pos : C.neg) : variant === "primary" ? C.accent : null;
  const pad = size === "lg" ? "13px 18px" : size === "sm" ? "6px 12px" : "10px 16px";
  const off = !!rest.disabled;
  return (
    <button type="button" {...rest} className={["nx-press", rest.className].filter(Boolean).join(" ")}
      style={{
        display: full ? "block" : "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: full ? "100%" : undefined, textAlign: "center", padding: pad,
        fontFamily: "var(--nx-font-ui)", fontSize: size === "lg" ? 14 : size === "sm" ? 12.5 : 13, fontWeight: 600,
        color: fill ? C.canvas : variant === "ghost" ? C.text.muted : C.text.fog,
        background: fill ?? "none",
        border: fill ? `1px solid ${fill}` : variant === "ghost" ? "1px solid transparent" : `1px solid ${C.border}`,
        borderRadius: size === "sm" ? 15 : 10,
        cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.55 : 1,
        ...style,
      }}>
      {children}
    </button>
  );
}
