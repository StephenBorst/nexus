// The leads on /proof as cards (borst 2026-11-21; plain-words pass the same day: "way too complicated for a normie").
// Each card reads like the paper wallet cards: the read, its stage, one sentence (how often it beat random trades), four
// number tiles (new trades · its average · a random trade's average · beat random %), the bars still in the way as a
// plain checklist with each number now, the paper run as a count of 30, and the sides under a tap. Rules in
// app/lib/proofLayout.mjs. Same numbers as the board. Display only: not a grade (the stage is).
import { useState } from "react";
import { Link } from "react-router-dom";
import { C, SIGNAL } from "@/config/theme";
import { beatSentence, randomWord } from "@/lib/proofLayout.mjs";
import { splitLabel } from "@/lib/signalCard.mjs";
import { fmtR } from "@/lib/engineOverview.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const tone = (v: number | null | undefined) => (v == null ? FOG : v > 0 ? C.pos : v < 0 ? C.neg : FOG);

type Vs = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Line = { key: string; text: string; nowText: string | null; met: boolean };
type Paper = { state: "none" | "unread" | "running"; text: string; count?: number; target?: number; open?: boolean };
export type LeadCard = { axis: string; label: string; stage: string | null; events: number; pooled: Vs; sides: { LONG: Vs; SHORT: Vs }; gates: Line[]; next: string | null; paper: Paper };

const stageChip = (stage: string | null) => stage && (
  <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", padding: "3px 6px", borderRadius: 3, whiteSpace: "nowrap", border: `1px solid ${C.accent}`, color: BRIGHT }}>{stage}</span>
);

// A word chip for "vs random": bone = beats random, ink for the middle, amber = worse than random. Never green/red
// (those are money).
const CHIP: Record<string, { border: string; color: string; dashed?: boolean }> = {
  BEATS: { border: C.accent, color: BRIGHT },
  LEANS: { border: C.borderStrong, color: FOG },
  SAME: { border: C.border, color: MUTED },
  WORSE: { border: SIGNAL.watch, color: SIGNAL.watch },
  FEW: { border: C.borderStrong, color: MUTED, dashed: true },
};
export function WordChip({ word }: { word: { key: string; text: string } }) {
  const s = CHIP[word.key] ?? CHIP.FEW;
  return (
    <span style={{ fontFamily: MONO, fontSize: 10.5, padding: "4px 7px", borderRadius: 3, whiteSpace: "nowrap", border: `1px ${s.dashed ? "dashed" : "solid"} ${s.border}`, color: s.color }}>{word.text}</span>
  );
}

// A big number over a small caps label, like the board's tiles.
const tile = (big: React.ReactNode, cap: string) => (
  <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: BRIGHT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{big}</span>
    <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>{cap}</span>
  </div>
);

// One bar still in the way: a filled dot when it passes, a ring when it doesn't, the sentence, and the number now.
function Check({ g }: { g: Line }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr) auto", gap: 8, alignItems: "baseline" }}>
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", alignSelf: "center", background: g.met ? FOG : "transparent", border: `2px solid ${g.met ? FOG : MUTED}` }} />
      <span style={{ fontFamily: UI, fontSize: 13, lineHeight: 1.45, color: g.met ? MUTED : FOG }}>{g.text}{g.met ? " · done" : ""}</span>
      {g.nowText && <span style={{ fontFamily: MONO, fontSize: 11.5, color: g.met ? MUTED : BRIGHT, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>now {g.nowText}</span>}
    </div>
  );
}

// The paper run as a count of 30: one segment per closed trade. A count, never R or dollars.
function PaperCount({ axis, p }: { axis: string; p: Paper }) {
  if (p.state !== "running") return <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED }}>{p.text}</div>;
  const target = p.target ?? 30, n = Math.min(p.count ?? 0, target);
  return (
    <Link to={`/proof/paper/${encodeURIComponent(axis)}`} style={{ display: "flex", flexDirection: "column", gap: 6, textDecoration: "none" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: UI, fontSize: 13, color: FOG }}>
        <span>{p.text}</span><span style={{ color: MUTED }}>→</span>
      </span>
      <span aria-hidden style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: target }, (_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 1, background: i < n ? C.accent : C.border }} />)}
      </span>
    </Link>
  );
}

// One side in words: trades, its average beside a random trade's, how often it beat random.
function SideLine({ label, v }: { label: string; v: Vs }) {
  const word = randomWord(v?.pct ?? null, v?.n ?? 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: BRIGHT, minWidth: 52 }}>{label}</span>
        <WordChip word={word} />
      </div>
      <span style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.45 }}>
        {v ? <>{v.n} trades · averaged <span style={{ color: tone(v.meanR) }}>{fmtR(v.meanR)}</span>, a random trade {v.randomR == null ? "—" : fmtR(v.randomR)}{v.pct == null ? "" : ` · beat random ${Math.round(v.pct)}%`}</> : "No new trades on this side."}
      </span>
    </div>
  );
}

function Card({ c }: { c: LeadCard }) {
  const [open, setOpen] = useState(false);
  const { main, aside } = splitLabel(c.label);
  const left = c.gates.filter((g) => !g.met).length;
  const p = c.pooled;
  const word = randomWord(p?.pct ?? null, p?.n ?? 0);
  return (
    <article style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: UI, fontSize: 15, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.01em" }}>{main}{aside && <span style={{ fontWeight: 400, color: MUTED }}> {aside}</span>}</span>
          <span style={{ display: "block", marginTop: 2, fontFamily: MONO, fontSize: 10.5, color: MUTED, overflowWrap: "anywhere" }}>{c.axis}</span>
        </span>
        {stageChip(c.stage)}
      </div>

      {/* One sentence, then the numbers. Its average never stands alone: a random trade's sits next to it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <WordChip word={word} />
        <span style={{ fontFamily: UI, fontSize: 13.5, color: FOG }}>{beatSentence(p?.pct ?? null)}</span>
      </div>
      {p && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {tile(p.n, "NEW TRADES")}
          {tile(p.pct == null ? "—" : `${Math.round(p.pct)}%`, "BEAT RANDOM")}
          {tile(<span style={{ color: tone(p.meanR) }}>{fmtR(p.meanR)}</span>, "ITS AVERAGE")}
          {tile(<span style={{ color: tone(p.randomR) }}>{p.randomR == null ? "—" : fmtR(p.randomR)}</span>, "RANDOM AVERAGE")}
        </div>
      )}

      {/* The bars still in the way, as a checklist. */}
      {c.gates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>TO MOVE UP · {left} {left === 1 ? "THING" : "THINGS"} LEFT</span>
          {c.gates.map((g) => <Check key={g.key} g={g} />)}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}><PaperCount axis={c.axis} p={c.paper} /></div>

      <div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ background: "none", border: "none", padding: "4px 0", minHeight: 28, cursor: "pointer", fontFamily: UI, fontSize: 12.5, color: MUTED }}>
          {open ? "Longs and shorts −" : "Longs and shorts +"}
        </button>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <SideLine label="LONGS" v={c.sides.LONG} />
            <SideLine label="SHORTS" v={c.sides.SHORT} />
          </div>
        )}
      </div>
    </article>
  );
}

export default function LeadCards({ cards, isMobile, onWords }: { cards: LeadCard[]; isMobile: boolean; onWords: () => void }) {
  return (
    <section id="proof-leads" style={{ marginTop: 32, scrollMarginTop: 120 }}>
      <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 22 : 26, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>Leads</h2>
      <p style={{ margin: "6px 0 14px", fontFamily: UI, fontSize: 13.5, lineHeight: 1.55, color: MUTED, maxWidth: 680 }}>
        Reads making money on new data, not cleared yet. Each one is checked against 300 random trades on the same coins and
        hours: it only counts if it beats them.{" "}
        <button type="button" onClick={onWords} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: UI, fontSize: 13.5, color: FOG, textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: C.borderStrong }}>What the words mean ↓</button>
      </p>
      {cards.length
        ? <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>{cards.map((c) => <Card key={c.axis} c={c} />)}</div>
        : <div style={{ fontFamily: UI, fontSize: 13.5, color: FOG, padding: "12px 4px", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>No read is a lead right now.</div>}
    </section>
  );
}
