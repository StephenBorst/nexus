// One deep board, open under the market table (borst 2026-11-20: the lens strip folded into the Wire, the table and the
// coin drawer). The Wire and the table open it; one at a time; Close puts it away. Rules: app/lib/intelLenses.mjs.
import { useEffect, useRef } from "react";
import { C, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { boardById } from "@/lib/intelLenses.mjs";

export function DeepBoard({ id, onClose, render }: { id: string; onClose: () => void; render: (id: string) => React.ReactNode }) {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLElement | null>(null);
  const board = boardById(id);
  // the opener may sit far above (the Wire): bring the board into view when it opens
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [id]);
  if (!board) return null;
  return (
    <section ref={ref} aria-label={board.label} className="nx-fade-in" style={{ marginBottom: isMobile ? 24 : 32, scrollMarginTop: 72 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontFamily: UI, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: C.text.bright }}>{board.label}</div>
        <button type="button" onClick={onClose} className="nx-text-action"
          style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" }}>Close</button>
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, marginTop: 4, marginBottom: 12 }}>{board.sub}</div>
      {render(id)}
    </section>
  );
}

export default DeepBoard;
