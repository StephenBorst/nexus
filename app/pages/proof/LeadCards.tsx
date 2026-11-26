// The leads on /proof as cards (borst 2026-11-21; plain-words pass the same day; visual pass 2026-11-26: "a normie can
// scan the cards and understand what's working without reading the pipeline rules"). First view: the read, its stage,
// one word chip + one sentence (how often it beat random trades) and four tiles (new trades · beat random · its average
// · a random trade's average, the last two always side by side), each tile tapping open its exact definition. The
// checklist of bars still in the way and the sides sit behind one Details tap; the paper run is a small line. One card
// language with the Strategy Shelf (app/components/ReadCard.tsx). Rules in app/lib/proofLayout.mjs. Same numbers as
// the board. Display only: not a grade (the stage is).
import { Link } from "react-router-dom";
import { C } from "@/config/theme";
import { beatSentence, randomWord } from "@/lib/proofLayout.mjs";
import { splitLabel } from "@/lib/signalCard.mjs";
import { fmtR } from "@/lib/engineOverview.mjs";
import { CardHead, CardShell, Details, Tiles, WHY, WordChip } from "@/components/ReadCard";

export { WordChip };

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const tone = (v: number | null | undefined) => (v == null ? FOG : v > 0 ? C.pos : v < 0 ? C.neg : FOG);

type Vs = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Line = { key: string; text: string; nowText: string | null; met: boolean };
type Paper = { state: "none" | "unread" | "running"; text: string; count?: number; target?: number; open?: boolean };
export type LeadCard = { axis: string; label: string; stage: string | null; events: number; pooled: Vs; sides: { LONG: Vs; SHORT: Vs }; gates: Line[]; next: string | null; paper: Paper };

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

// The paper run, secondary: one small line, a count of 30, never R or dollars.
function PaperLine({ axis, p }: { axis: string; p: Paper }) {
  const style = { fontFamily: UI, fontSize: 12, color: MUTED, textDecoration: "none" };
  if (p.state !== "running") return <span style={style}>{p.text}</span>;
  return <Link to={`/proof/paper/${encodeURIComponent(axis)}`} style={style}>{p.text} →</Link>;
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
  const { main, aside } = splitLabel(c.label);
  const left = c.gates.filter((g) => !g.met).length;
  const p = c.pooled;
  const word = randomWord(p?.pct ?? null, p?.n ?? 0);
  return (
    <CardShell>
      <CardHead title={main} aside={aside} stage={c.stage} />

      {/* One sentence, then the numbers. Its average never stands alone: a random trade's sits next to it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <WordChip word={word} />
        <span style={{ fontFamily: UI, fontSize: 13.5, color: FOG }}>{beatSentence(p?.pct ?? null)}</span>
      </div>
      {p && (
        <Tiles tiles={[
          { key: "n", big: p.n, cap: "NEW TRADES", why: WHY.trades },
          { key: "pct", big: p.pct == null ? "—" : `${Math.round(p.pct)}%`, cap: "BEAT RANDOM", why: WHY.beat },
          { key: "avg", big: <span style={{ color: tone(p.meanR) }}>{fmtR(p.meanR)}</span>, cap: "ITS AVERAGE", why: WHY.avg },
          { key: "rnd", big: <span style={{ color: tone(p.randomR) }}>{p.randomR == null ? "—" : fmtR(p.randomR)}</span>, cap: "RANDOM AVERAGE", why: WHY.random },
        ]} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
        <PaperLine axis={c.axis} p={c.paper} />
      </div>

      {/* The depth: the bars still in the way as a checklist, then each side. */}
      <Details label={c.gates.length ? `Details · ${left} ${left === 1 ? "thing" : "things"} left to move up` : "Details"}>
        {c.gates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>TO MOVE UP · {left} {left === 1 ? "THING" : "THINGS"} LEFT</span>
            {c.gates.map((g) => <Check key={g.key} g={g} />)}
          </div>
        )}
        {!c.gates.length && c.next && <span style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.45 }}>Next: {c.next}</span>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>LONGS AND SHORTS</span>
          <SideLine label="LONGS" v={c.sides.LONG} />
          <SideLine label="SHORTS" v={c.sides.SHORT} />
        </div>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, overflowWrap: "anywhere" }}>{c.axis}</span>
      </Details>
    </CardShell>
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
