// A swap error, said plainly, with the next step (rules: app/lib/swapNotice.mjs).
// A guard refusal reads as protection ("Stopped before your wallet signed. Nothing moved.") and offers
// the venue link right there; the precise reason stays underneath in small type. Other kinds show their
// own line. Renders nothing for an empty message.
import { swapNotice } from "@/lib/swapNotice.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", MUT = "#71717a";
const NEG = "#f7525f";

export function SwapNotice({ msg, href, label, compact = false }: {
  msg: string | null | undefined;
  href?: string | null;     // the venue link (Uniswap / Jupiter / …), when the ticket has one
  label?: string;           // its button text, e.g. "Buy AERO on Uniswap →"
  compact?: boolean;        // inside a modal: tighter spacing
}) {
  if (!msg) return null;
  const n = swapNotice(msg);
  const calm = n.kind === "guard" || n.kind === "unavailable" || n.kind === "cancelled";
  return (
    <div role="status" style={{ marginTop: compact ? 0 : 8, marginBottom: compact ? 10 : 0, textAlign: "center", overflowWrap: "anywhere" }}>
      <div style={{ fontFamily: UI, fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: calm ? BRIGHT : NEG }}>{n.headline}</div>
      {n.why && <div style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5, color: MUT, marginTop: 3 }}>{n.why}</div>}
      {n.venue && href && (
        <a href={href} target="_blank" rel="noopener noreferrer"
          style={{ display: "block", marginTop: 8, fontFamily: UI, fontSize: 13.5, fontWeight: 600, color: "#0a0a0b", background: BRIGHT, borderRadius: 9, padding: "11px 12px", textDecoration: "none", overflowWrap: "anywhere" }}>
          {label || "Open the swap in your wallet →"}
        </a>
      )}
    </div>
  );
}
