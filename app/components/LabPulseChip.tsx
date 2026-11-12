// ◆ The Lab pulse: a thin strip on Trade and Spot → /proof.
//   "LAB · PEOPLE 2 open · last graded 21d ago · OUR ENGINES 0 open · 11 graded this week · See the record →"
// The point is the graded loop on the first screen a trader sees. Counts come from GET /calls/pulse
// (lab-api routes-pulse.mjs, rule app/lib/callPulse.mjs): people and our engine callers counted APART,
// never blended (borst, 2026-11-05); no copies, no house callers. Real numbers always; a quiet week reads
// "last graded 21d ago" instead of a bare 0. Unreadable = no numbers, just the method line. No wallet,
// no key, no money: a link and a GET. `trailing` (Trade only) = the "post your position as a call"
// button, a sibling of the link (never nested inside it).
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { pulseLine } from "@/lib/callPulse.mjs";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { C, MONO, UI } from "@/config/theme";

const PULSE_URL = "https://og.nexustradinglabs.com/calls/pulse";
const REFRESH_MS = 5 * 60000;

interface Block { open: number; gradedWeek: number; last: { at: number } | null }
interface Pulse extends Block { engines?: Block }

export default function LabPulseChip({ trailing }: { trailing?: ReactNode } = {}) {
  const isMobile = useIsMobile();
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(PULSE_URL);
        const j = r.ok ? await r.json() : null;
        if (alive && j && j.ok) setPulse(j as Pulse);
      } catch { /* keep the last good read; the line falls back on its own */ }
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const { segments, title } = pulseLine(pulse);
  const dot = <span style={{ color: C.text.faint }}>·</span>;

  return (
    <div style={{ display: "flex", alignItems: "stretch", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, height: isMobile ? 26 : 28 }}>
    <Link
      to="/proof"
      title={title}
      aria-label={segments ? `Lab. ${segments.map((s) => `${s.label}: ${s.text}`).join(". ")}. See the record.` : "Lab. Every call is scored from public price. See the record."}
      style={{
        display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0,
        padding: isMobile ? "0 12px" : "0 16px", fontFamily: UI, fontSize: 12,
        color: C.text.fog, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.text.bright, letterSpacing: "0.12em", fontWeight: 600, flexShrink: 0 }}>LAB</span>
      {segments ? segments.map((s) => (
        <span key={s.label} style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {dot}
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: C.text.muted, textTransform: "uppercase", flexShrink: 0 }}>{isMobile && s.label === "Our engines" ? "Engines" : s.label}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{isMobile ? s.short : s.text}</span>
        </span>
      )) : (
        <span style={{ display: "flex", gap: 8 }}>{dot}<span>every call scored from public price</span></span>
      )}
      <span style={{ marginLeft: "auto", color: C.text.muted, flexShrink: 0 }}>{isMobile ? "→" : "See the record →"}</span>
    </Link>
    {trailing}
    </div>
  );
}
