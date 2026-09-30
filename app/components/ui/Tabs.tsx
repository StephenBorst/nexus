import type { ReactNode } from "react";
import { C } from "@/config/theme";

// ── Tabs — switch between views of one thing ────────────────────────────────────
// UI face, sentence case, a 2px brand underline on the active tab over one hairline. Scrolls
// sideways on a narrow screen instead of wrapping. `right` holds a quiet note or control.
export type TabItem<T extends string> = { id: T; label: ReactNode; count?: number };

export function Tabs<T extends string>({ items, active, onChange, right, size = "md" }: {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  right?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="nx-noscrollbar" style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: `1px solid ${C.border}`, overflowX: "auto", scrollbarWidth: "none" }}>
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            style={{
              flexShrink: 0, fontFamily: "var(--nx-font-ui)", fontSize: size === "sm" ? 13 : 14, fontWeight: 600,
              color: on ? C.text.bright : C.text.muted, background: "none", border: "none",
              borderBottom: `2px solid ${on ? C.brand : "transparent"}`, padding: size === "sm" ? "8px 10px" : "10px 12px",
              marginBottom: -1, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            {t.label}{t.count ? <span style={{ color: C.text.faint, fontWeight: 400 }}> · {t.count}</span> : null}
          </button>
        );
      })}
      {right && <span style={{ marginLeft: "auto", flexShrink: 0, paddingLeft: 12, fontFamily: "var(--nx-font-ui)", fontSize: 12, color: C.text.faint }}>{right}</span>}
    </div>
  );
}
