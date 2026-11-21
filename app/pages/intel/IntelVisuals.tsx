// The Intel page, visual-first (borst 2026-11-21, same rules as /proof; rules in app/lib/intelTape.mjs).
// Marks against stated lines, never bars that fill toward a goal. Colour = state only: past a line or at an extreme
// = SIGNAL.watch, unread = faint, everything else ink. No green/red here (no R, no outcome on this page's inputs).
// Nothing is added up into a call; every number keeps its source.
import { C, SIGNAL } from "@/config/theme";
import {
  FUNDING_LONGS_PCT, FUNDING_SHORTS_PCT, OI_CONC_X, OI_ELEV_X, PCT_HIGH, PCT_LOW, LS_HEAVY_LONG, LS_HEAVY_SHORT,
  fearGreedMark, stretchedCount, breadthMarks, lineTrack, ratioMark, percentileState, flagLabel, flagLine, lsWords,
} from "@/lib/intelTape.mjs";
import { pressKey } from "@/utils/a11y";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const WATCH = SIGNAL.watch;

export const fmtFunding = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(4)}%`;
export const fmtOI = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`);

export type Asset = { name: string; symbol: string; funding: number; oi: number; volume: number; markPx: number };
type FG = { value: number; label: string } | null;

const cap: React.CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED };

// A rail with a dot (now) and ticks (the stated lines). Fixed scale; never fills.
function Rail({ pos, ticks = [], dot = BRIGHT, beyond = false, height = 12 }: { pos: number | null; ticks?: number[]; dot?: string; beyond?: boolean; height?: number }) {
  return (
    <span style={{ position: "relative", display: "block", height }}>
      <span style={{ position: "absolute", left: 0, right: 0, top: height / 2 - 1, height: 2, borderRadius: 1, background: C.border }} />
      {ticks.map((t, i) => <span key={i} style={{ position: "absolute", left: `${t}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: MUTED }} />)}
      {pos != null && <span style={{ position: "absolute", top: "50%", left: `${pos}%`, width: 9, height: 9, margin: "-4.5px 0 0 -4.5px", borderRadius: "50%", background: dot, boxShadow: `0 0 0 2px ${C.canvas}` }} />}
      {beyond && <span aria-hidden style={{ position: "absolute", right: -2, top: height / 2 - 7, fontFamily: MONO, fontSize: 10, color: dot }}>▸</span>}
    </span>
  );
}

// ── The strip: three visuals only, and the one line ──────────────────────────────────────────
export function IntelStrip({ fg, assets, isMobile }: { fg: FG; assets: Asset[] | null; isMobile: boolean }) {
  const f = fearGreedMark(fg);
  const marks = breadthMarks(assets ?? []) as { name: string; longsPay: boolean }[];
  const pay = marks.filter((m) => m.longsPay).length;
  const s = stretchedCount(assets ?? []);
  const cell = { display: "flex", flexDirection: "column" as const, gap: 6, minWidth: 0 };
  return (
    <section aria-label="The market now" style={{
      background: C.canvas, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: "12px 0", marginBottom: 14,
      ...(isMobile ? {} : { position: "sticky" as const, top: 0, zIndex: 5 }),
    }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr 0.8fr", gap: isMobile ? 14 : 28 }}>
        <div style={cell} title="alternative.me Fear & Greed index, 0 to 100.">
          <span style={cap}>Fear / Greed</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 20, color: f ? (f.extreme ? WATCH : BRIGHT) : FAINT, fontVariantNumeric: "tabular-nums" }}>{f ? f.value : "—"}</span>
            <span style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>{f ? `${f.label} · alternative.me` : "unread"}</span>
          </span>
          <Rail pos={f ? f.pos : null} dot={f?.extreme ? WATCH : BRIGHT} />
          <span style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 9.5, color: FAINT }}><span>fear 0</span><span>100 greed</span></span>
        </div>
        <div style={cell} title="Orderly's top markets by open interest, one mark each. Lit = longs pay funding there. A count, not a direction.">
          <span style={cap}>Funding · Orderly</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 20, color: marks.length ? BRIGHT : FAINT, fontVariantNumeric: "tabular-nums" }}>{marks.length ? `${pay} of ${marks.length}` : "—"}</span>
            <span style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>{marks.length ? "markets where longs pay" : "unread"}</span>
          </span>
          <span aria-hidden style={{ display: "flex", gap: 2, height: 12, alignItems: "center" }}>
            {marks.map((m, i) => <span key={i} title={`${m.name}: ${m.longsPay ? "longs pay" : "shorts pay or flat"}`} style={{ flex: 1, height: m.longsPay ? 10 : 4, borderRadius: 1, background: m.longsPay ? C.accent : C.borderStrong }} />)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>one mark per market, largest open interest first</span>
        </div>
        <div style={cell} title={`Past a stated line: funding above +${FUNDING_LONGS_PCT}% or below ${FUNDING_SHORTS_PCT}% per 8h, or open interest above ${OI_ELEV_X}× / ${OI_CONC_X}× 24h volume.`}>
          <span style={cap}>Past a line</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 20, color: !assets ? FAINT : s.total ? WATCH : BRIGHT, fontVariantNumeric: "tabular-nums" }}>{assets ? s.total : "—"}</span>
            <span style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>{assets ? `funding ${s.funding} · OI ${s.oi}` : "unread"}</span>
          </span>
        </div>
      </div>
      <div style={{ marginTop: 10, fontFamily: UI, fontSize: 12, color: MUTED }}>Public inputs. Nothing graded here.</div>
    </section>
  );
}

// ── A market past a line: the number, the line as a tick, how far past ─────────────────────────
export function LineCard({ a, onOpen, onTrade, onAgent }: { a: Asset; onOpen: () => void; onTrade: () => void; onAgent: () => void }) {
  const t = lineTrack(a);
  if (!t) return null;
  const num = t.funding ? fmtFunding(a.funding) : `${t.value.toFixed(1)}×`;
  const lineText = t.funding ? `line ${t.kind === "CROWDED_LONGS" ? "+" : "−"}${t.line}%` : `line ${t.line}×`;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={pressKey(onOpen)} title={`${flagLine(a.name, a)} Not graded. Tap to read every lens on ${a.name}.`}
      style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: 14, display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: BRIGHT }}>{a.name}</span>
        <span style={{ fontFamily: UI, fontSize: 12, color: FOG }}>{flagLabel(t.kind)}</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: FAINT }}>NOT GRADED</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: WATCH, fontVariantNumeric: "tabular-nums" }}>{num}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{t.funding ? `per 8h · ${t.side}` : "OI ÷ 24h volume"}</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: MUTED }}>OI {fmtOI(a.oi)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Rail pos={t.nowPos} ticks={[t.linePos]} dot={WATCH} beyond={t.beyond} />
        <span style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: MUTED }}>
          <span>{lineText}</span><span>{t.times.toFixed(1)}× the line</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); onTrade(); }}
          style={{ flex: 1, background: "none", border: `1px solid ${C.borderStrong}`, color: C.accent, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "7px", borderRadius: 6, cursor: "pointer" }}>Trade {a.name} →</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onAgent(); }} title={`Set the agent to watch ${a.name}. It trades your rules.`}
          style={{ background: "none", border: `1px solid ${C.border}`, color: FOG, fontFamily: UI, fontSize: 12, padding: "7px 10px", borderRadius: 6, cursor: "pointer" }}>⚡ Agent</button>
      </div>
    </div>
  );
}

// ── A major: funding WITH its percentile, the account ratio bar, a badge when stretched ──────────────
type Ctx = { funding?: { pct?: number | null; days?: number; samples?: number } } | undefined;
export function MajorCard({ sym, a, ctx, ls, onOpen, onAgent }: { sym: string; a: Asset | undefined; ctx: Ctx; ls: number | null; onOpen: () => void; onAgent: () => void }) {
  const pct = ctx?.funding?.pct ?? null;
  const st = percentileState(pct);
  const stretched = st === "high" || st === "low";
  const longShare = ls != null ? Math.min(0.92, ls / (ls + 1)) : null;
  const heavy = ls != null && (ls > LS_HEAVY_LONG || ls < LS_HEAVY_SHORT);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={pressKey(onOpen)} title={`Read every lens on ${sym}`}
      style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: 14, display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: BRIGHT }}>{sym}</span>
        {stretched && <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", padding: "2px 6px", borderRadius: 3, border: `1px solid ${WATCH}`, color: WATCH }}>{st === "high" ? "STRETCHED HIGH" : "STRETCHED LOW"}</span>}
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: MUTED }}>OI {a ? fmtOI(a.oi) : "—"}</span>
      </div>
      {/* Funding never alone: its percentile against its own recorded history beside it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...cap, fontSize: 9 }}>Funding 8h</span>
          <span style={{ fontFamily: MONO, fontSize: 15, color: a ? (stretched ? WATCH : BRIGHT) : FAINT }}>{a ? fmtFunding(a.funding) : "—"}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{pct != null ? `${pct}th pct` : "percentile unread"}</span>
        </span>
        <Rail pos={pct != null ? Math.max(0, Math.min(100, pct)) : null} ticks={[PCT_LOW, PCT_HIGH]} dot={stretched ? WATCH : BRIGHT} />
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>
          {pct != null && ctx?.funding?.days ? `vs its last ${ctx.funding.days} days (${ctx.funding.samples} readings) · ticks at ${PCT_LOW}th / ${PCT_HIGH}th` : `ticks at ${PCT_LOW}th / ${PCT_HIGH}th`}
        </span>
      </div>
      {/* The account long/short ratio, kept as it was: a count of OKX accounts, not of size. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }} title="OKX accounts with a position: the share that are long. A count of accounts, not of size.">
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ ...cap, fontSize: 9 }}>Accounts L/S · OKX</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: ls == null ? FAINT : heavy ? BRIGHT : FOG }}>{ls == null ? "unread" : `${ls.toFixed(2)} · ${lsWords(ls).toLowerCase()}`}</span>
        </span>
        <span style={{ display: "flex", height: 6, borderRadius: 2, overflow: "hidden", gap: 1 }}>
          <span style={{ flex: longShare ?? 0.5, background: "#d4d4d8", opacity: ls != null ? 0.7 : 0.2 }} />
          <span style={{ flex: longShare != null ? 1 - longShare : 0.5, background: C.text.faint, opacity: ls != null ? 0.9 : 0.2 }} />
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: MUTED }}>
          <span>L {longShare != null ? `${Math.round(longShare * 100)}%` : "—"}</span><span>S {longShare != null ? `${Math.round((1 - longShare) * 100)}%` : "—"}</span>
        </span>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onAgent(); }} title={`Set the agent to watch ${sym}. It trades your rules.`}
        style={{ alignSelf: "flex-start", background: "none", border: `1px solid ${C.border}`, color: FOG, fontFamily: UI, fontSize: 12, padding: "4px 9px", borderRadius: 6, cursor: "pointer" }}>⚡ Agent</button>
    </div>
  );
}

// ── The table's OI ÷ volume: the number and a dot on 0 → 3× with the two stated lines as ticks ─────────
export function RatioCell({ ratio, past }: { ratio: number; past: boolean }) {
  const m = ratioMark(ratio);
  return (
    <span title={`Open interest ÷ 24h volume. Ticks at ${OI_ELEV_X}× and ${OI_CONC_X}×; the lines apply only on markets trading over $100k a day.`} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: past ? WATCH : FOG, width: 34, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{ratio.toFixed(1)}×</span>
      <span style={{ flex: 1, minWidth: 40 }}>{m && <Rail pos={m.pos} ticks={m.ticks} dot={past ? WATCH : FOG} beyond={m.beyond} height={10} />}</span>
    </span>
  );
}

/** The flag as a badge (the label words, in the state colour), or a faint dash. */
export function FlagBadge({ kind }: { kind: string }) {
  if (kind === "NONE") return <span style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>—</span>;
  return <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 3, border: `1px solid ${WATCH}`, color: WATCH, whiteSpace: "nowrap" }}>{flagLabel(kind).toUpperCase()}</span>;
}
