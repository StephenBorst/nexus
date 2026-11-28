// The engine overview on /proof (borst 2026-11-17, pipeline-if-then.md "Engine overview"; rules app/lib/engineOverview.mjs).
// The market the reads ran in, each registered read's NEW-DATA sides against a random entry on that side, the
// read-by-read table, and the paper runs as cards. Reads the scoreboard /proof already loaded; the paper cards read the
// public paper-run routes. Display only: not a grade (the stage is), no sums or averages of paper R, no dollars.
import { useEffect, useMemo, useState } from "react";
import { C } from "@/config/theme";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { overviewReads, tideOf, btcRegime, strongSides, paperCard, fmtR } from "@/lib/engineOverview.mjs";
import { vsRandomCards, RANDOM_WORDS, RANDOM_CUTOFFS } from "@/lib/proofLayout.mjs";
import { WordChip } from "@/components/ReadCard";
import { pressKey } from "@/utils/a11y";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const { pos: POS, neg: NEG, accent: BONE } = C;
const tone = (v: number | null | undefined) => (v == null ? FOG : v > 0 ? POS : v < 0 ? NEG : FOG);
const day = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

type Side = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Row = { axis: string; label: string; stage: string; next: string | null; events: number; meanR: number | null; sides: { LONG: Side; SHORT: Side }; words: string[] };
type VsSide = { n: number; pct: number | null; meanR: number | null; randomR: number | null; word: { key: string; text: string } };
type VsCard = { axis: string; label: string; sides: { LONG: VsSide; SHORT: VsSide }; best: number | null; trades: number };
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

const stat = (big: React.ReactNode, cap: string) => (
  <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{big}</span>
    <span style={{ fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{cap}</span>
  </div>
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ready = (scorecard: any) => !!scorecard && !scorecard.failed && !!scorecard.pipeline;

/** The market the reads ran in: what a random long and short earned, BTC's 30 days, the regime day counts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MarketStats({ scorecard }: { scorecard: any }) {
  const isMobile = useIsMobile();
  if (!ready(scorecard)) return null;
  const tide = tideOf(scorecard);
  const btc = btcRegime(scorecard);
  const r30: number | null = btc?.ret30 ?? null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
      {tide && stat(<span style={{ color: tone(tide.short) }}>{fmtR(tide.short)}</span>, `a random short, per trade, since ${day(tide.from)}`)}
      {tide && stat(<span style={{ color: tone(tide.long) }}>{fmtR(tide.long)}</span>, `a random long, per trade, since ${day(tide.from)}`)}
      {btc && r30 != null && stat(<span style={{ color: tone(r30) }}>{r30 > 0 ? "+" : r30 < 0 ? "−" : ""}{Math.abs(r30).toFixed(1)}%</span>, `BTC over 30 days, to ${day(btc.day)}`)}
      {btc?.counts && stat(<span style={{ color: BRIGHT }}>{btc.counts.UP ?? 0} · {btc.counts.DOWN ?? 0} · {btc.counts.FLAT ?? 0}</span>, `up · down · flat days since ${day(btc.since)}`)}
    </div>
  );
}

/**
 * Every read vs random trades (plain-words pass, borst 2026-11-21): one card per read, each side a word chip
 * ("Beats random" … "Worse than random", the backtest's own cutoffs) with its trades and the share of 300 random trades
 * it beat; a tap shows its average beside a random trade's. Main coins or the fresh ones. New data only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SideChart({ scorecard }: { scorecard: any }) {
  const isMobile = useIsMobile();
  const [line, setLine] = useState<"main" | "holdout">("main");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = useMemo(() => overviewReads(scorecard, { line, minEvents: scorecard?.pipeline?.rules?.minEvents ?? 30 }) as Row[], [scorecard, line]);
  const cards = useMemo(() => vsRandomCards(rows) as VsCard[], [rows]);
  const strong = useMemo(() => strongSides(scorecard) as { axis: string; side: string }[], [scorecard]);
  if (!ready(scorecard)) return null;
  const FIRST = 6;
  const shown = all ? cards : cards.slice(0, FIRST);
  return (
    <section style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 20 : 22, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>Every read vs random trades</h2>
        <p style={{ margin: 0, fontFamily: UI, fontSize: 13.5, lineHeight: 1.55, color: MUTED, maxWidth: 680 }}>
          For each read we take 300 random trades on the same coins, same side, same hours. If it can’t beat them, its timing adds nothing.
          New data only.
        </p>
      </div>
      <p style={{ margin: 0, fontFamily: UI, fontSize: 13.5, lineHeight: 1.55, color: FOG, maxWidth: 680 }}>
        {strong.length
          ? <>Beating random on both the main coins and fresh ones: {strong.map((s, i) => <span key={i}>{i ? " and " : ""}<span style={{ fontFamily: MONO, color: BRIGHT }}>{s.axis}</span> {s.side.toLowerCase()}s</span>)}. One side only, not a stage yet.</>
          : "Nothing beats random on both the main coins and fresh ones yet."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontFamily: UI, fontSize: 12, color: MUTED }}>
          <WordChip word={{ key: "BEATS", text: RANDOM_WORDS.BEATS }} /> {RANDOM_CUTOFFS.beats}%+
          <WordChip word={{ key: "LEANS", text: RANDOM_WORDS.LEANS }} /> {RANDOM_CUTOFFS.leans}%+
          <WordChip word={{ key: "WORSE", text: RANDOM_WORDS.WORSE }} /> {RANDOM_CUTOFFS.worse}% or less
        </div>
        <Seg label="Coins" value={line} onChange={(v) => { setLine(v as "main" | "holdout"); setPicked(null); }} options={[["main", "Main coins"], ["holdout", "Fresh coins"]]} />
      </div>
      {line === "holdout" && <p style={{ margin: 0, fontFamily: UI, fontSize: 12.5, color: MUTED }}>Fresh coins = coins none of these reads were picked on.</p>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {shown.map((c) => (
          <div key={c.axis} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: UI, fontSize: 13.5, fontWeight: 600, color: BRIGHT, lineHeight: 1.35 }}>{c.label}</div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, overflowWrap: "anywhere" }}>{c.axis}</div>
            </div>
            {(["LONG", "SHORT"] as const).map((sd) => {
              const v = c.sides[sd], key = `${sd}:${c.axis}`, on = picked === key;
              return (
                <button key={sd} type="button" aria-expanded={on} onClick={() => setPicked(on ? null : key)}
                  style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch", textAlign: "left", background: on ? C.surface : "none", border: "none", borderTop: `1px solid ${C.border}`, padding: "8px 2px 2px", cursor: "pointer" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: BRIGHT, minWidth: 52 }}>{sd}S</span>
                    <WordChip word={v.word} />
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>{v.n} trades{v.pct == null || v.word.key === "FEW" ? "" : ` · ${Math.round(v.pct)}%`}</span>
                  </span>
                  {on && (
                    <span style={{ fontFamily: UI, fontSize: 12.5, lineHeight: 1.5, color: FOG }}>
                      {v.n ? <>Its {sd.toLowerCase()}s averaged <span style={{ color: tone(v.meanR) }}>{fmtR(v.meanR)}</span> a trade; a random {sd.toLowerCase()} on the same coins and hours averaged {v.randomR == null ? "—" : fmtR(v.randomR)}.{v.pct == null ? "" : ` It beat ${Math.round(v.pct)}% of 300 random tries.`}</> : `No new ${sd.toLowerCase()} trades yet.`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {cards.length > FIRST && (
        <button type="button" onClick={() => setAll((v) => !v)} className="nx-text-action" style={{ alignSelf: "flex-start", background: "none", border: "none", padding: "4px 0", cursor: "pointer", fontFamily: UI, fontSize: 13, color: FOG }}>
          {all ? "Show fewer" : `Show all ${cards.length} reads`}
        </button>
      )}
    </section>
  );
}

/** The paper wallets as cards: each trade as it closed, the open one, the count of 30. No totals, no dollars. */
export function PaperWallets({ isMobile }: { isMobile: boolean }) {
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
  if (!cards || !cards.length) return null;
  return (
    <section id="proof-paper" style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 120 }}>
      <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 20 : 22, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>Paper wallets</h2>
      <p style={{ margin: 0, fontFamily: UI, fontSize: 12.5, color: MUTED }}>Each trade as it closed. No totals and no dollars until the 30-trade judgment, after fees.</p>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {cards.map((c) => <PaperCard key={c.axis} c={c} />)}
      </div>
    </section>
  );
}
