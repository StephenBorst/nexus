// ◆ The Lab pulse: a thin strip on Trade and Spot. "Lab · 3 open calls · 2 graded this week" → /proof.
// The point is the graded loop on the first screen a trader sees. Counts come from GET /calls/pulse
// (lab-api routes-pulse.mjs, rule app/lib/callPulse.mjs): public human calls only, no copies, no house.
// Real numbers always; a quiet week reads "last graded 4d ago" instead of a bare 0. Unreadable = no
// numbers, just the method line. No wallet, no key, no money: a link and a GET.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pulseLine } from "@/lib/callPulse.mjs";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { C, MONO, UI } from "@/config/theme";

const PULSE_URL = "https://og.nexustradinglabs.com/calls/pulse";
const REFRESH_MS = 5 * 60000;

interface Pulse { open: number; gradedWeek: number; last: { at: number } | null }

export default function LabPulseChip() {
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

  const { parts, title } = pulseLine(pulse);
  const [head, ...rest] = parts;

  return (
    <Link
      to="/proof"
      title={title}
      aria-label={`${parts.join(", ")}. See the record.`}
      style={{
        display: "flex", alignItems: "center", gap: 8, height: isMobile ? 26 : 28,
        padding: isMobile ? "0 12px" : "0 16px", background: C.surfaceAlt,
        borderBottom: `1px solid ${C.border}`, fontFamily: UI, fontSize: 12,
        color: C.text.fog, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.text.bright, letterSpacing: "0.12em", fontWeight: 600, flexShrink: 0 }}>{head.toUpperCase()}</span>
      {rest.map((p) => (
        <span key={p} style={{ display: "flex", gap: 8, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: C.text.faint }}>·</span>
          <span>{p}</span>
        </span>
      ))}
      <span style={{ marginLeft: "auto", color: C.text.muted, flexShrink: 0 }}>{isMobile ? "→" : "See the record →"}</span>
    </Link>
  );
}
