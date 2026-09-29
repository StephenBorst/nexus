// ── JUST RESOLVED — the moment the product exists to produce ──
// A call hitting its target or stop is the single most interesting event here, and it
// used to be completely invisible: the hourly cron stamped the grade and nothing said
// so. The author found out by scrolling their own profile, if ever.
//
// Rendered as a strip rather than interleaved into the thesis list: a resolution isn't
// thesis-shaped (no levels, no status), so mixing it into FeedCard's input would break
// the card and skew the "N traders" counts. It also reads better as a ticker.
import { StripHead } from "@/components/ui/StripHead";
import { useNavigate } from "react-router-dom";
import { C, MONO } from "@/config/theme";
import { pressKey } from "@/utils/a11y";

export type ResolutionEvent = {
  kind: "RESOLUTION";
  wallet: string;
  thesisId: string | null;
  symbol: string;
  direction: "LONG" | "SHORT" | null;
  outcome: "WIN" | "LOSS";
  r: number;
  message: string;
  createdAt: number;
};

const shortAddr = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const ago = (ms: number) => {
  const m = Math.max(0, (Date.now() - ms) / 60000);
  return m < 1 ? "now" : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default function Resolved({ events }: { events: ResolutionEvent[] }) {
  const navigate = useNavigate();
  if (!events?.length) return null;
  const shown = events.slice(0, 8);

  return (
    <div style={{ marginBottom: 20 }}>
      <StripHead title="Just resolved" sub="graded from public price, not self-reported" />

      <div style={{ display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        {shown.map((e, i) => {
          // Green/red here is P&L, which is the one place chroma is allowed.
          const tone = e.outcome === "WIN" ? C.pos : C.neg;
          return (
            // Land on the specific CALL permalink (it heroes the graded result + carries
            // the share buttons + conversion strip) rather than the general profile;
            // fall back to the trader page when there's no thesisId. ⚠️ Both routes are
            // CHILDREN of /feed — a bare /trader|/thesis hard-404s (verified on prod).
            <div role="link" tabIndex={0}
              key={`${e.wallet}-${e.thesisId ?? i}`}
              onClick={() => navigate(e.thesisId ? `/feed/thesis/${e.wallet}/${e.thesisId}` : `/feed/trader/${e.wallet}`)} onKeyDown={pressKey(() => navigate(e.thesisId ? `/feed/thesis/${e.wallet}/${e.thesisId}` : `/feed/trader/${e.wallet}`))}
              style={{ cursor: "pointer" }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "11px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
              }}>
                <span style={{ flexShrink: 0, fontFamily: "var(--nx-font-ui)", fontSize: 14, fontWeight: 600, color: C.text.bright }}>
                  {e.symbol}
                </span>
                <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 11, color: C.text.muted }}>{e.direction === "LONG" ? "↑ long" : "↓ short"}</span>
                <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: C.text.fog, minWidth: 0 }}>
                  {e.outcome === "WIN" ? "hit target" : "stopped out"}
                </span>
                <span style={{ flexShrink: 0, fontFamily: "var(--nx-font-ui)", fontSize: 14, fontWeight: 600, color: tone, fontVariantNumeric: "tabular-nums" }}>
                  {e.r > 0 ? "+" : ""}{e.r}R
                </span>
                <span style={{ marginLeft: "auto", flexShrink: 0, fontFamily: MONO, fontSize: 11, color: C.text.faint }}>
                  {shortAddr(e.wallet)} · {ago(e.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
