// One card language for a read, shared by /proof's lead cards and the Agent's Strategy Shelf (borst 2026-11-26,
// visual pass: "a normie can scan the cards and understand what's working without reading the pipeline rules").
// The first view: the name, its stage, one word chip + one sentence, a few number tiles. Depth (the checklist, the
// sides, what it still needs) sits behind one Details tap; the simple numbers are never hidden. Each tile can carry
// its exact definition ("Why this number"): tapping it prints the definition under the tiles.
// Colour = state only: bone / ink / amber chips, never green/red (those are money and price).
import { useState, type ReactNode } from "react";
import { C, SIGNAL } from "@/config/theme";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;

/** The stage as served, in ink. */
export function StageChip({ word }: { word: string | null | undefined }) {
  if (!word) return null;
  return (
    <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 6px", borderRadius: 3, whiteSpace: "nowrap", border: `1px solid ${C.accent}`, color: BRIGHT }}>{word}</span>
  );
}

// "vs random" in one word: bone = beats random, ink for the middle, amber = worse than random.
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

/** The card itself: the same surface as the Quick-start presets. */
export function CardShell({ children }: { children: ReactNode }) {
  return (
    <article style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt, padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {children}
    </article>
  );
}

/** Name (+ a trailing aside) and the stage chip on one row. */
export function CardHead({ title, aside, stage }: { title: string; aside?: string; stage: string | null | undefined }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
      <span style={{ minWidth: 0, fontFamily: UI, fontSize: 15, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
        {title}{aside && <span style={{ fontWeight: 400, color: MUTED }}> {aside}</span>}
      </span>
      <StageChip word={stage} />
    </div>
  );
}

export type TileSpec = { key: string; big: ReactNode; cap: string; why?: string };

/** The number tiles, two a row. A tile with `why` is a button: its exact definition prints under the grid. */
export function Tiles({ tiles }: { tiles: TileSpec[] }) {
  const [why, setWhy] = useState<string | null>(null);
  const shown = tiles.find((t) => t.key === why && t.why);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {tiles.map((t) => {
          const on = why === t.key;
          const body = (
            <>
              <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: BRIGHT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.big}</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED }}>{t.cap}{t.why ? " ⓘ" : ""}</span>
            </>
          );
          const box = { border: `1px solid ${on ? C.borderStrong : C.border}`, borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" as const, gap: 4, minWidth: 0, textAlign: "left" as const, background: "transparent" };
          return t.why
            ? <button key={t.key} type="button" aria-expanded={on} title="Why this number" onClick={() => setWhy(on ? null : t.key)} style={{ ...box, cursor: "pointer", font: "inherit" }}>{body}</button>
            : <div key={t.key} style={box}>{body}</div>;
        })}
      </div>
      {shown && <div style={{ fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: FOG }}><span style={{ color: BRIGHT }}>{shown.cap.toLowerCase()}:</span> {shown.why}</div>}
    </div>
  );
}

/** One Details tap for the depth. */
export function Details({ label = "Details", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ background: "none", border: "none", padding: "4px 0", minHeight: 28, cursor: "pointer", fontFamily: UI, fontSize: 12.5, color: MUTED }}>
        {label} {open ? "−" : "+"}
      </button>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>{children}</div>}
    </div>
  );
}

/** The exact definitions the tiles carry. One copy, so /proof and the shelf define a number the same way. */
export const WHY = {
  trades: "Trades this read took after it was registered (new data only, main coins). Back-tested history never counts.",
  beat: "We replay random entries on the same coins, sides and hours 300 times. This is the share of those replays this read did better than.",
  avg: "Its average result per trade in R, where 1R is the stop distance (1.2× the 4h ATR), with a 1.5R target and a 168h time limit.",
  random: "The typical (median) result per trade of those 300 random replays, in R, under the same stop, target and time limit.",
} as const;
