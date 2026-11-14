// Lab home: "What the Board is reading" as ONE card. A chip per lens, only the chosen one mounted.
// Replaced six stacked folds (five lenses + the deep market intel), 2026-11-14. Rules: app/lib/intelLenses.mjs.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { C, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { INTEL_LENSES, LENS_KEY, initialLens, nextLens } from "@/lib/intelLenses.mjs";

export function IntelLenses({ render }: { render: (id: string) => React.ReactNode }) {
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const [active, setActive] = useState<string | null>(() =>
    initialLens((k: string) => window.localStorage.getItem(k), params.get("lens")),
  );
  const tap = (id: string) => {
    const [next, store] = nextLens(active, id);
    setActive(next);
    try { window.localStorage.setItem(LENS_KEY, store); } catch { /* private mode */ }
  };
  const lens = INTEL_LENSES.find((l) => l.id === active) ?? null;

  return (
    <section aria-label="What the Board is reading" style={{ marginTop: isMobile ? 24 : 36 }}>
      <div style={{ fontFamily: UI, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: C.text.bright, lineHeight: 1.2 }}>
        What the Board is reading
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, marginTop: 4 }}>
        {lens ? lens.sub : "The deep reads behind each line on the Board. Pick one."}
      </div>
      {/* Chips scroll sideways on a phone instead of wrapping into a wall. */}
      <div role="group" aria-label="Lenses" style={{
        display: "flex", gap: 8, marginTop: 12, paddingBottom: 4,
        overflowX: isMobile ? "auto" : "visible", flexWrap: isMobile ? "nowrap" : "wrap", WebkitOverflowScrolling: "touch",
      }}>
        {INTEL_LENSES.map((l) => {
          const on = l.id === active;
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => tap(l.id)}
              className="nx-press"
              style={{
                flexShrink: 0, fontFamily: UI, fontSize: 14, fontWeight: on ? 600 : 500, cursor: "pointer",
                padding: "8px 14px", borderRadius: 999, background: on ? C.accent : "transparent",
                color: on ? C.canvas : C.text.fog, border: `1px solid ${on ? C.accent : C.borderStrong}`,
              }}
            >{l.label}</button>
          );
        })}
      </div>
      {lens && <div key={lens.id} className="nx-fade-in" style={{ marginTop: 12 }}>{render(lens.id)}</div>}
    </section>
  );
}
