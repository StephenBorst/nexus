// The leads on /proof as cards (borst 2026-11-21, visual-first pass; rules in app/lib/proofLayout.mjs).
// Each card: the read, its stage, its mean R ALWAYS beside a random entry on the same coins and hours (a dot and a ring
// on one R ruler), each remaining bar as a track (dot = now, tick = the bar), the paper run as a count of 30, and the
// served `next` sentence under a tap. Same numbers as the board. Display only: not a grade (the stage is).
import { useState } from "react";
import { Link } from "react-router-dom";
import { C } from "@/config/theme";
import { CHART, rPos, vsRandomText } from "@/lib/proofLayout.mjs";
import { splitLabel } from "@/lib/signalCard.mjs";
import { fmtR } from "@/lib/engineOverview.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const tone = (v: number | null | undefined) => (v == null ? FOG : v > 0 ? C.pos : v < 0 ? C.neg : FOG);

type Vs = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Track = { key: string; label: string; met: boolean; kind: "track" | "step"; nowPos: number | null; barPos: number | null; nowText: string | null; barText: string | null };
type Paper = { state: "none" | "unread" | "running"; text: string; count?: number; target?: number; open?: boolean };
export type LeadCard = { axis: string; label: string; stage: string | null; events: number; pooled: Vs; sides: { LONG: Vs; SHORT: Vs }; gates: Track[]; next: string | null; paper: Paper };

const stageChip = (stage: string | null) => stage && (
  <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", padding: "3px 6px", borderRadius: 3, whiteSpace: "nowrap", border: `1px solid ${C.accent}`, color: BRIGHT }}>{stage}</span>
);

// One row on the shared R ruler: the read's mean R (dot) and a random entry's (ring). Never one without the other.
function VsRuler({ label, v }: { label: string; v: Vs }) {
  if (!v) return (
    <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", gap: 8, alignItems: "center", minHeight: 26 }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>{label}</span>
      <span style={{ fontFamily: UI, fontSize: 12, color: FAINT }}>no new events</span>
    </div>
  );
  const me = rPos(v.meanR), rnd = rPos(v.randomR);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", gap: 8, alignItems: "center" }}
      title={`${label}: ${v.n} new events. Mean ${fmtR(v.meanR)}; a random entry on the same coins and hours ${fmtR(v.randomR)}. Beat ${v.pct == null ? "—" : Math.round(v.pct)}% of 300 replays. Not a grade.`}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>{label}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ position: "relative", height: 14 }}>
          {CHART.ticks.map((t: number) => <span key={t} style={{ position: "absolute", left: `${rPos(t)}%`, top: t === 0 ? 1 : 4, bottom: t === 0 ? 1 : 4, width: 1, background: t === 0 ? C.borderStrong : C.border }} />)}
          {rnd != null && <span style={{ position: "absolute", top: "50%", left: `${rnd}%`, width: 10, height: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", border: `2px solid ${MUTED}`, background: C.canvas }} />}
          {me != null && <span style={{ position: "absolute", top: "50%", left: `${me}%`, width: 10, height: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", background: BRIGHT, boxShadow: `0 0 0 2px ${C.canvas}` }} />}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: tone(v.meanR) }}>{fmtR(v.meanR)}</span> vs {fmtR(v.randomR)} random · {v.pct == null ? "too few" : `beat ${Math.round(v.pct)}%`} · n{v.n}
        </span>
      </span>
    </div>
  );
}

// One bar still in the way: a dot where the read is now, a tick at the bar. Not a progress bar: it moves both ways.
function GateTrack({ g }: { g: Track }) {
  if (g.kind === "step") {
    return <div style={{ fontFamily: UI, fontSize: 12, color: g.met ? MUTED : FOG }}>{g.label}{g.met ? " · passes" : ""}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: UI, fontSize: 12, color: g.met ? MUTED : FOG }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}{g.met ? " · passes" : ""}</span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: g.met ? MUTED : BRIGHT }}>{g.nowText}</span> · bar {g.barText}
        </span>
      </div>
      <span style={{ position: "relative", height: 10 }}>
        <span style={{ position: "absolute", left: 0, right: 0, top: 4, height: 2, borderRadius: 1, background: C.border }} />
        {g.barPos != null && <span style={{ position: "absolute", left: `${g.barPos}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: MUTED }} />}
        {g.nowPos != null && <span style={{ position: "absolute", top: "50%", left: `${g.nowPos}%`, width: 8, height: 8, margin: "-4px 0 0 -4px", borderRadius: "50%", background: g.met ? FOG : BRIGHT, boxShadow: `0 0 0 2px ${C.surfaceAlt}` }} />}
      </span>
    </div>
  );
}

// The paper run as a count of 30: one segment per closed trade. A count, never R or dollars.
function PaperCount({ axis, p }: { axis: string; p: Paper }) {
  if (p.state !== "running") return <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>{p.text}</div>;
  const target = p.target ?? 30, n = Math.min(p.count ?? 0, target);
  return (
    <Link to={`/proof/paper/${encodeURIComponent(axis)}`} style={{ display: "flex", flexDirection: "column", gap: 5, textDecoration: "none" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: UI, fontSize: 12, color: FOG }}>
        <span>{p.text}</span><span style={{ color: MUTED }}>→</span>
      </span>
      <span aria-hidden style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: target }, (_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 1, background: i < n ? C.accent : C.border }} />)}
      </span>
    </Link>
  );
}

function Card({ c }: { c: LeadCard }) {
  const [open, setOpen] = useState(false);
  const { main, aside } = splitLabel(c.label);
  const left = c.gates.filter((g) => !g.met).length;
  return (
    <article style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: UI, fontSize: 14.5, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.01em" }}>{main}{aside && <span style={{ fontWeight: 400, color: MUTED }}> {aside}</span>}</span>
          <span style={{ display: "block", marginTop: 2, fontFamily: MONO, fontSize: 10.5, color: MUTED, overflowWrap: "anywhere" }}>{c.axis} · {c.events} new events</span>
        </span>
        {stageChip(c.stage)}
      </div>

      {/* Mean R, never alone: beside a random entry on the same coins and hours, pooled and per side. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {c.pooled && <div title={`${vsRandomText(c.pooled)} of 300 replays. New data only. Not a grade: the stage is.`} style={{ fontFamily: MONO, fontSize: 12, color: FOG, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: tone(c.pooled.meanR) }}>{fmtR(c.pooled.meanR)}</span> vs {fmtR(c.pooled.randomR)} random · {c.pooled.pct == null ? "too few to compare" : `beat ${Math.round(c.pooled.pct)}% of 300`}
        </div>}
        <VsRuler label="Longs" v={c.sides.LONG} />
        <VsRuler label="Shorts" v={c.sides.SHORT} />
      </div>

      {/* The bars still in the way, as tracks. */}
      {c.gates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>NEXT STAGE · {left} {left === 1 ? "BAR" : "BARS"} LEFT</span>
          {c.gates.map((g) => <GateTrack key={g.key} g={g} />)}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}><PaperCount axis={c.axis} p={c.paper} /></div>

      {c.next && (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            style={{ background: "none", border: "none", padding: "4px 0", minHeight: 28, cursor: "pointer", fontFamily: UI, fontSize: 12, color: MUTED }}>
            {open ? "The bar, in words −" : "The bar, in words +"}
          </button>
          {open && <p style={{ margin: "2px 0 0", fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.5 }}>Next: {c.next}</p>}
        </div>
      )}
    </article>
  );
}

export default function LeadCards({ cards, isMobile, onWords }: { cards: LeadCard[]; isMobile: boolean; onWords: () => void }) {
  return (
    <section id="proof-leads" style={{ marginTop: 32, scrollMarginTop: 120 }}>
      <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 22 : 26, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>Leads</h2>
      <p style={{ margin: "6px 0 14px", fontFamily: UI, fontSize: 13, lineHeight: 1.5, color: MUTED, maxWidth: 680 }}>
        Positive on new data, not cleared. Each read beside a random entry on the same coins and hours, and the bars it still has to pass.{" "}
        <button type="button" onClick={onWords} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: UI, fontSize: 13, color: FOG, textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: C.borderStrong }}>What the words mean ↓</button>
      </p>
      {cards.length
        ? <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>{cards.map((c) => <Card key={c.axis} c={c} />)}</div>
        : <div style={{ fontFamily: UI, fontSize: 13.5, color: FOG, padding: "12px 4px", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>No read is a lead right now.</div>}
    </section>
  );
}
