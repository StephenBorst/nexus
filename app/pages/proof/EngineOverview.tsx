// The engine overview on /proof (borst 2026-11-17, pipeline-if-then.md "Engine overview"; rules app/lib/engineOverview.mjs).
// The market the reads ran in, each registered read's NEW-DATA sides against a random entry on that side, the
// read-by-read table, and the paper runs as cards. Reads the scoreboard /proof already loaded; the paper cards read the
// public paper-run routes. Display only: not a grade (the stage is), no sums or averages of paper R, no dollars.
import { Fragment, useEffect, useMemo, useState } from "react";
import { C } from "@/config/theme";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { overviewReads, chartRows, tideOf, btcRegime, strongSides, paperCard, chartPct, CHART, fmtR } from "@/lib/engineOverview.mjs";
import { pressKey } from "@/utils/a11y";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const { pos: POS, neg: NEG, accent: BONE } = C;
const tone = (v: number | null | undefined) => (v == null ? FOG : v > 0 ? POS : v < 0 ? NEG : FOG);
const day = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

type Side = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Row = { axis: string; label: string; stage: string; next: string | null; events: number; meanR: number | null; sides: { LONG: Side; SHORT: Side }; words: string[] };
type ChartRow = { axis: string; n: number; meanR: number; randomR: number; pct: number | null };
type Card = { axis: string; unread?: boolean; count?: number; target?: number; startedAt?: string | null; trades?: { coin: string; side: string; outcome: string; reason: string }[];
  open?: { coin: string; side: string; entry: number; openedAt: string | null } | null; targets?: number; stops?: number; timeStops?: number; tape?: string | null; verdict?: string | null };

function Seg({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
      {options.map(([v, text]) => (
        <span key={v} role="radio" aria-checked={value === v} tabIndex={0} onClick={() => onChange(v)} onKeyDown={pressKey(() => onChange(v))}
          style={{ padding: "6px 12px", fontFamily: UI, fontSize: 12.5, cursor: "pointer", color: value === v ? BRIGHT : MUTED, background: value === v ? C.surface : "transparent" }}>{text}</span>
      ))}
    </div>
  );
}

function SidePanel({ side, rows, tideR, picked, onPick, narrow }: { side: "LONG" | "SHORT"; rows: ChartRow[]; tideR: number | null; picked: string | null; onPick: (k: string) => void; narrow?: boolean }) {
  const cols = `minmax(0, ${narrow ? 104 : 132}px) minmax(0, 1fr) 38px`;
  const X = (v: number) => `${chartPct(v).toFixed(2)}%`;
  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, borderBottom: `1px solid ${C.borderStrong}`, paddingBottom: 6, marginBottom: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.14em", color: BRIGHT }}>{side}</span>
        {tideR != null && <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>random {side.toLowerCase()} {fmtR(tideR)}</span>}
      </div>
      {rows.length ? rows.map((r) => {
        const key = `${side}:${r.axis}`, lo = Math.min(r.meanR, r.randomR), hi = Math.max(r.meanR, r.randomR), on = picked === key;
        return (
          <div key={key} role="button" tabIndex={0} aria-pressed={on} onClick={() => onPick(key)} onKeyDown={pressKey(() => onPick(key))}
            title={`${r.axis} · ${side}: ${r.n} new events, mean ${fmtR(r.meanR)}; a random entry ${fmtR(r.randomR)}; beat ${r.pct == null ? "—" : Math.round(r.pct)}% of 300 replays`}
            style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 8, height: 32, borderRadius: 4, cursor: "pointer", background: on ? C.surface : "transparent", padding: "0 4px" }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: FOG, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.axis}</span>
            <span style={{ position: "relative", height: "100%" }}>
              {CHART.ticks.map((t: number) => <span key={t} style={{ position: "absolute", left: X(t), top: t === 0 ? 4 : 10, bottom: t === 0 ? 4 : 10, width: 1, background: t === 0 ? C.borderStrong : C.border }} />)}
              <span style={{ position: "absolute", top: "50%", height: 2, marginTop: -1, left: X(lo), width: `calc(${X(hi)} - ${X(lo)})`, background: r.meanR > r.randomR ? FOG : FAINT }} />
              <span style={{ position: "absolute", top: "50%", left: X(r.randomR), width: 10, height: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", border: `2px solid ${MUTED}`, background: C.canvas }} />
              <span style={{ position: "absolute", top: "50%", left: X(r.meanR), width: 10, height: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", background: BRIGHT, boxShadow: `0 0 0 2px ${C.canvas}` }} />
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.pct ?? 0) >= 95 ? BRIGHT : MUTED }}>{r.pct == null ? "—" : `${Math.round(r.pct)}%`}</span>
          </div>
        );
      }) : <span style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, padding: "6px 4px" }}>No read has 5+ new {side.toLowerCase()} events on these coins yet.</span>}
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, height: 18, padding: "0 4px" }}>
        <span />
        <span style={{ position: "relative" }}>
          {CHART.ticks.map((t: number) => <span key={t} style={{ position: "absolute", left: X(t), transform: "translateX(-50%)", fontFamily: MONO, fontSize: 10, color: FAINT, lineHeight: "18px", whiteSpace: "nowrap" }}>{t === 0 ? "0" : `${t > 0 ? "+" : "−"}${Math.abs(t)}R`}</span>)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT, textAlign: "right", lineHeight: "18px" }}>BEAT</span>
      </div>
    </div>
  );
}

const sideCell = (s: Side) => (s ? <><span style={{ color: tone(s.meanR) }}>{fmtR(s.meanR)}</span> <span style={{ color: MUTED }}>vs {fmtR(s.randomR)} · {s.pct == null ? "thin" : `${Math.round(s.pct)}%`}</span></> : <span style={{ color: FAINT }}>—</span>);
const stageChip = (stage: string) => (
  <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", padding: "3px 6px", borderRadius: 3, whiteSpace: "nowrap",
    border: `1px solid ${stage === "LEAD" || stage === "EDGE" || stage === "TRADEABLE" || stage === "PAPER" ? BONE : C.borderStrong}`,
    color: stage === "RETIRED" ? FAINT : stage === "REGISTERED" ? FOG : BRIGHT }}>{stage}</span>
);

function ReadTable({ rows, isMobile }: { rows: Row[]; isMobile: boolean }) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r) => (
          <div key={r.axis} style={{ borderTop: `1px solid ${C.border}`, padding: "10px 2px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: BRIGHT, overflowWrap: "anywhere" }}>{r.axis}</span>{stageChip(r.stage)}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: MUTED }}>{r.events} new events{r.meanR != null ? <> · mean <span style={{ color: tone(r.meanR) }}>{fmtR(r.meanR)}</span></> : null}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5 }}><span style={{ color: MUTED }}>Longs </span>{sideCell(r.sides.LONG)}</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5 }}><span style={{ color: MUTED }}>Shorts </span>{sideCell(r.sides.SHORT)}</span>
            {r.words.length > 0 && <span style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.5 }}>{r.words.join(" ")}</span>}
          </div>
        ))}
      </div>
    );
  }
  const th = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: MUTED, textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${C.borderStrong}`, whiteSpace: "nowrap" as const };
  const td = { padding: "10px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" as const, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" as const };
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
        <thead><tr><th style={th}>READ</th><th style={th}>STAGE</th><th style={th}>NEW EVENTS</th><th style={th}>MEAN R</th><th style={th}>LONGS VS RANDOM</th><th style={th}>SHORTS VS RANDOM</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.axis}>
              <tr>
                <td style={{ ...td, color: BRIGHT, borderBottom: r.words.length ? "none" : td.borderBottom }}>{r.axis}</td>
                <td style={{ ...td, borderBottom: r.words.length ? "none" : td.borderBottom }}>{stageChip(r.stage)}</td>
                <td style={{ ...td, color: BRIGHT, borderBottom: r.words.length ? "none" : td.borderBottom }}>{r.events}</td>
                <td style={{ ...td, color: tone(r.meanR), borderBottom: r.words.length ? "none" : td.borderBottom }}>{fmtR(r.meanR)}</td>
                <td style={{ ...td, borderBottom: r.words.length ? "none" : td.borderBottom }}>{sideCell(r.sides.LONG)}</td>
                <td style={{ ...td, borderBottom: r.words.length ? "none" : td.borderBottom }}>{sideCell(r.sides.SHORT)}</td>
              </tr>
              {r.words.length > 0 && (
                <tr><td style={{ ...td, paddingTop: 0 }} /><td colSpan={5} style={{ ...td, paddingTop: 0, fontFamily: UI, fontSize: 12.5, color: FOG, whiteSpace: "normal", lineHeight: 1.5 }}>{r.words.join(" ")}</td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaperCard({ c }: { c: Card }) {
  if (c.unread) return <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, fontFamily: UI, fontSize: 12.5, color: MUTED }}><span style={{ fontFamily: MONO, color: BRIGHT }}>{c.axis}</span> · unread right now</div>;
  const pct = Math.min(100, ((c.count ?? 0) / (c.target || 30)) * 100);
  return (
    <a href={`/proof/paper/${c.axis}`} style={{ textDecoration: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, color: FOG }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: BRIGHT, overflowWrap: "anywhere" }}>{c.axis}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{c.count} of {c.target}{c.startedAt ? ` · since ${day(c.startedAt)}` : ""}</span>
      </div>
      <span style={{ height: 4, borderRadius: 2, background: C.border, position: "relative", overflow: "hidden" }}><span style={{ position: "absolute", inset: 0, width: `${pct}%`, background: BONE, borderRadius: 2 }} /></span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {(c.trades || []).map((t, i) => (
          <span key={i} style={{ fontFamily: MONO, fontSize: 10.5, padding: "4px 6px", borderRadius: 3, border: `1px solid ${t.outcome === "WIN" ? POS : t.outcome === "LOSS" ? NEG : C.borderStrong}`, color: t.outcome === "WIN" ? POS : t.outcome === "LOSS" ? NEG : FOG }}>
            {t.coin} {String(t.side)[0]} {t.reason}
          </span>
        ))}
        {c.open && <span style={{ fontFamily: MONO, fontSize: 10.5, padding: "4px 6px", borderRadius: 3, border: `1px dashed ${C.borderStrong}`, color: MUTED }}>{c.open.coin} {String(c.open.side)[0]} open</span>}
      </div>
      <span style={{ fontFamily: UI, fontSize: 12.5, lineHeight: 1.5 }}>
        {c.targets} targets, {c.stops} stops{c.timeStops ? `, ${c.timeStops} time stops` : ""}. {c.verdict && c.verdict !== "ACCRUING" ? `Judged: ${c.verdict.toLowerCase()}.` : `Judged at ${c.target} trades, after fees.`}
      </span>
      {c.tape && <span style={{ fontFamily: UI, fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>{c.tape}</span>}
    </a>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function EngineOverview({ scorecard }: { scorecard: any }) {
  const isMobile = useIsMobile();
  const [line, setLine] = useState<"main" | "holdout">("main");
  const [picked, setPicked] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API}/pipeline/paper-wallets`).then((r) => r.json()).then(async (d) => {
      const reads = (Array.isArray(d?.reads) ? d.reads : []).filter((x: { axis?: string; wallet?: string }) => x?.axis && x.wallet);
      const out = await Promise.all(reads.map(async (x: { axis: string }) => {
        const [run, judge] = await Promise.all([
          fetch(`${API}/signals/paper-run/${x.axis}`).then((r) => r.json()).catch(() => null),
          fetch(`${API}/signals/paper-judge/${x.axis}`).then((r) => r.json()).catch(() => null),
        ]);
        return paperCard(x.axis, run, judge) as Card;
      }));
      if (live) setCards(out);
    }).catch(() => { if (live) setCards([]); });
    return () => { live = false; };
  }, []);

  const rows = useMemo(() => overviewReads(scorecard, { line, minEvents: scorecard?.pipeline?.rules?.minEvents ?? 30 }) as Row[], [scorecard, line]);
  const tide = tideOf(scorecard);
  const btc = btcRegime(scorecard);
  const r30: number | null = btc?.ret30 ?? null;
  const strong = useMemo(() => strongSides(scorecard) as { axis: string; side: string }[], [scorecard]);
  const pickedRow = picked ? rows.find((r) => r.axis === picked.split(":")[1]) : null;
  const pickedSide = picked ? (picked.split(":")[0] as "LONG" | "SHORT") : null;

  if (!scorecard || scorecard.failed || !scorecard.pipeline) return null;
  const stat = (big: React.ReactNode, cap: string) => (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{big}</span>
      <span style={{ fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{cap}</span>
    </div>
  );

  return (
    <section style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 22 : 26, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>Engine overview</h2>
        <p style={{ margin: 0, fontFamily: UI, fontSize: 13, lineHeight: 1.55, color: MUTED, maxWidth: 680 }}>
          Every read is judged against a random entry on the same coins, side and hours. New data only. Not a grade: the stage is.
        </p>
      </div>

      {/* The market the reads ran in */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {tide && stat(<span style={{ color: tone(tide.short) }}>{fmtR(tide.short)}</span>, `a random short, per trade, since ${day(tide.from)}`)}
        {tide && stat(<span style={{ color: tone(tide.long) }}>{fmtR(tide.long)}</span>, `a random long, per trade, since ${day(tide.from)}`)}
        {btc && r30 != null && stat(<span style={{ color: tone(r30) }}>{r30 > 0 ? "+" : r30 < 0 ? "−" : ""}{Math.abs(r30).toFixed(1)}%</span>, `BTC over 30 days, to ${day(btc.day)}`)}
        {btc?.counts && stat(<span style={{ color: BRIGHT }}>{btc.counts.UP ?? 0} · {btc.counts.DOWN ?? 0} · {btc.counts.FLAT ?? 0}</span>, `up · down · flat days since ${day(btc.since)}`)}
      </div>
      <p style={{ margin: 0, fontFamily: UI, fontSize: 13, lineHeight: 1.55, color: FOG, maxWidth: 680 }}>
        {strong.length
          ? <>Beats its own random entry on both coin sets: {strong.map((s, i) => <span key={i}>{i ? " and " : ""}<span style={{ fontFamily: MONO, color: BRIGHT }}>{s.axis}</span> {s.side.toLowerCase()}s</span>)}. One side, new data, not yet a stage.</>
          : "No side beats its own random entry on both coin sets yet."}
      </p>

      {/* Each read against a random entry, one side at a time */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontFamily: UI, fontSize: 12.5, color: FOG }}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: BRIGHT }} />the read’s mean R</span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 9, height: 9, borderRadius: "50%", border: `2px solid ${MUTED}` }} />a random entry (median of 300)</span>
        </div>
        <Seg label="Coins" value={line} onChange={(v) => { setLine(v as "main" | "holdout"); setPicked(null); }} options={[["main", "Main coins"], ["holdout", "Coins it was never picked on"]]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: isMobile ? 18 : 28 }}>
        <SidePanel side="LONG" rows={chartRows(rows, "LONG") as ChartRow[]} tideR={tide?.long ?? null} picked={picked} onPick={(k) => setPicked(picked === k ? null : k)} narrow={isMobile} />
        <SidePanel side="SHORT" rows={chartRows(rows, "SHORT") as ChartRow[]} tideR={tide?.short ?? null} picked={picked} onPick={(k) => setPicked(picked === k ? null : k)} narrow={isMobile} />
      </div>
      {pickedRow && pickedSide && pickedRow.sides[pickedSide] && (
        <p style={{ margin: 0, fontFamily: UI, fontSize: 13, lineHeight: 1.55, color: FOG, borderLeft: `2px solid ${C.borderStrong}`, paddingLeft: 10 }}>
          <span style={{ fontFamily: MONO, color: BRIGHT }}>{pickedRow.axis}</span> {pickedSide.toLowerCase()}s: {pickedRow.sides[pickedSide]!.n} new events, mean <span style={{ color: tone(pickedRow.sides[pickedSide]!.meanR) }}>{fmtR(pickedRow.sides[pickedSide]!.meanR)}</span>; a random {pickedSide.toLowerCase()} on the same coins and hours made {fmtR(pickedRow.sides[pickedSide]!.randomR)}. Beat {pickedRow.sides[pickedSide]!.pct == null ? "—" : Math.round(pickedRow.sides[pickedSide]!.pct!)}% of 300 replays; the bar for an edge is 95%.
        </p>
      )}

      {/* Read by read */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ margin: 0, fontFamily: UI, fontSize: 15, fontWeight: 600, color: BRIGHT }}>Read by read {line === "holdout" ? "· coins it was never picked on" : ""}</h3>
        <ReadTable rows={rows} isMobile={isMobile} />
      </div>

      {/* The paper wallets */}
      {cards && cards.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: UI, fontSize: 15, fontWeight: 600, color: BRIGHT }}>Paper wallets</h3>
          <p style={{ margin: 0, fontFamily: UI, fontSize: 12.5, color: MUTED }}>Each trade as it closed. No totals and no dollars until the 30-trade judgment.</p>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {cards.map((c) => <PaperCard key={c.axis} c={c} />)}
          </div>
        </div>
      )}
    </section>
  );
}
