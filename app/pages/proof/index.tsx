// ── THE PROOF — the unified track-records hub ────────────────────────────────
// One destination for every trustless record Nexus produces: human callers,
// autonomous agents, external AI agents (the Arena), and desks (teams). All graded
// from public data, never self-reported, and anchored to a recomputable on-chain
// ledger. The moat, made legible in one place — humans, machines, teams, one
// standard. Every board is fail-soft: sparse at cold-start by design, never broken.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SectionHeader } from "@/pages/lab/components";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import CarrySleeve from "./CarrySleeve";
import FeaturedLead from "./FeaturedLead";
import { AXIS_PRESET, AXIS_PAUSED, presetById } from "@/config/strategyPresets";
import { deployToAgent } from "@/utils/agentPrefill";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BONE = "#ededf0", BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b";
const POS = "#3ecf8e", NEG = "#f7525f";
const BORDER = "#232327", SURFACE_ALT = "#0f0f11", INSET = "#08080a";

type Filter = "all" | "callers" | "agents" | "arena" | "desks" | "signals";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}K` : Math.abs(n).toFixed(2)}`;
const label: React.CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: MUTED };

// ── data types (only the fields we render) ──
type Caller = { wallet: string; displayName?: string; pfp?: string; hitRate: number; avgR: number; calls: number; score: number; meritRank?: { glyph: string; title: string } | null };
type Agent = { rank: number; wallet: string; displayName?: string; pfp?: string; trades: number; winRate: number; netPnl: number; profitFactor: number; score: number };
type ArenaAgent = { wallet: string; name: string; builder?: string; currentPosition?: { symbol: string; direction: string } | null; paper?: { trades: number; winRate: number; netPnl: number } | null; live?: { trades: number; winRate: number; netPnl: number } | null };
type Desk = { id: string; name: string; rank: number; members: number; calls: number; hitRate: number; totalR: number; score: number };
type Ledger = { ledgerHash?: string; count?: number; onChain?: { txHash?: string; explorer?: string; verified?: boolean } | null };
type ProofCard = {
  wallet: string; displayName?: string | null; pfp?: string | null;
  coin: string; direction: "LONG" | "SHORT"; entryPrice?: number; stopLoss?: number; takeProfit1?: number;
  outcome: "WIN" | "LOSS"; r: number; createdAt?: number | null; gradedAt?: number | null;
  thesis?: string | null; catalyst?: string | null; targetWindow?: string | null;
  regimeTrend?: string | null; planScore?: number | null;
};
type ProofOfEdge = { cards: ProofCard[]; summary?: { resolved: number; wins: number; hitRate: number; avgR: number } };
type Horizon = { h: number; samples: number; hitRate: number; meanBps: number; stable: boolean; verdict: string };
type ExitGrade = { preset: string; tpPercent: number; slPercent: number; maxHoldHours: number; feeBps: number; samples: number; hitRate: number; netBps: number; stable: boolean; verdict: string; exits: Record<string, number>; avgHoldH: number; presetExit?: boolean; oos?: { since: string; samples: number; hitRate: number; netBps: number } };
type AxisRow = { name: string; label: string; verdict: string; best: { h: number; samples: number; hitRate: number; meanBps: number; stable: boolean } | null; horizons?: Horizon[]; exit?: ExitGrade | null; exit24h?: ExitGrade | null };
type Scorecard = { axes: AxisRow[]; config?: { minSamples: number; coins: string[]; horizonsHours: number[] }; note?: string; asOf?: string };

// Verdict tone — green ONLY for a proven-predictive signal; NOISE/INSUFFICIENT stay
// muted (no edge ≠ a loss), PROMISING is neutral-bone (positive but unconfirmed).
const VERDICT: Record<string, { color: string; label: string }> = {
  PREDICTIVE: { color: POS, label: "◆ PREDICTIVE" },
  PROMISING: { color: BONE, label: "PROMISING" },
  NOISE: { color: MUTED, label: "NOISE" },
  INSUFFICIENT: { color: FAINT, label: "ACCRUING" },
};

// A single labeled stat — value over a plain micro-label, so the scoreboard reads
// itself (no memorizing "bps"/"obs"). The tooltip carries the deeper gloss on hover.
function Stat({ v, unit, l, color, title, align = "end" }: { v: string; unit?: string; l: string; color?: string; title?: string; align?: "start" | "end" }) {
  return (
    <span title={title} style={{ display: "flex", flexDirection: "column", alignItems: align === "end" ? "flex-end" : "flex-start", gap: 3, minWidth: 0, cursor: title ? "help" : "default" }}>
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: color || BRIGHT, lineHeight: 1, whiteSpace: "nowrap" }}>
        {v}{unit ? <span style={{ fontSize: 8.5, color: MUTED, fontWeight: 500 }}> {unit}</span> : null}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.09em", textTransform: "uppercase", color: MUTED, whiteSpace: "nowrap" }}>{l}</span>
    </span>
  );
}

// One row per candidate signal — our OWN reads, graded by forward returns.
// Layout: the name + verdict on line 1 (the name WRAPS — it never shoves the stats off
// the card), the five stats on line 2 as an equal 5-cell grid on phones (never a tall
// column, never clipped), inline right on desktop. When the read has an agent mode that
// trades the EXACT graded rule (AXIS_PRESET — shared module + parity test), a third line
// loads it into the agent in PAPER. Reads without one say so rather than borrow a look-alike.
// The preset signal replayed on EVERY recorded market (each on its own), pooled, vs random entries.
type Evidence = { ok: boolean; hold: number; markets: number; marketsGreen: number; trades: number; netUsd: number; winRate: number; caveat?: string;
  baseline?: { verdict: string; pctBeaten?: number; moreTradesNeeded?: number | null; runs?: number; trades?: number; minTrades?: number } };

function EvidenceLine({ axis }: { axis: string }) {
  const [ev, setEv] = useState<Evidence | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API}/intel/evidence?axis=${axis}`).then((r) => r.json()).then((d) => { if (live && d?.ok) setEv(d); }).catch(() => { /* fail-soft */ });
    return () => { live = false; };
  }, [axis]);
  if (!ev) return null;
  const bl = ev.baseline;
  const tone = bl?.verdict === "BEATS_RANDOM" ? POS : bl?.verdict === "LEANS_ABOVE" ? "#fbbf24" : FOG;
  return (
    <div title={`The preset's own signal and ${ev.hold}h exit, replayed on every market with recorded history — each on its own — and the trades pooled. ${ev.caveat || ""}`}
      style={{ marginTop: 6, fontFamily: MONO, fontSize: 9, color: FOG, lineHeight: 1.6, cursor: "help" }}>
      <span style={{ color: MUTED, letterSpacing: "0.08em" }}>ACROSS {ev.markets} RECORDED MARKETS</span>{" "}
      <span style={{ color: ev.netUsd >= 0 ? POS : NEG }}>{ev.netUsd >= 0 ? "+" : ""}${ev.netUsd}</span> · {ev.trades} trades · green on {ev.marketsGreen}/{ev.markets}
      {bl && bl.verdict === "TOO_FEW_TRADES" && <span style={{ color: FAINT }}> · too few trades to test vs random</span>}
      {bl && bl.verdict !== "TOO_FEW_TRADES" && (
        <> · vs random entries <b style={{ color: tone }}>{bl.pctBeaten}%</b>
          {bl.verdict !== "BEATS_RANDOM" && bl.moreTradesNeeded != null && <span style={{ color: FAINT }}> · ~{bl.moreTradesNeeded} more trades for a verdict</span>}
        </>
      )}
      <span style={{ color: FAINT }}> · markets move together — pooled, not independent</span>
    </div>
  );
}

function SignalRow({ a }: { a: AxisRow }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const v = VERDICT[a.verdict] || VERDICT.INSUFFICIENT;
  const rated = !!a.best && a.verdict !== "INSUFFICIENT";
  const paused = AXIS_PAUSED[a.name];
  const preset = AXIS_PRESET[a.name] && !paused ? presetById(AXIS_PRESET[a.name]) : undefined;
  const align = isMobile ? "start" : "end";
  const stats = rated && a.best ? [
    <Stat key="h" align={align} v={`${a.best.h}h`} l="horizon" title="How far ahead we measure the move — this read's best window." />,
    <Stat key="hr" align={align} v={`${a.best.hitRate}%`} l="hit rate" title="Share of times it moved the predicted way." />,
    <Stat key="e" align={align} v={`${a.best.meanBps >= 0 ? "+" : ""}${a.best.meanBps}`} unit={isMobile ? undefined : "bps"} l={isMobile ? "edge · bps" : "avg edge"} color={a.best.meanBps >= 0 ? POS : NEG} title="Average forward move it caught, in basis points (100 bps = 1%)." />,
    <Stat key="n" align={align} v={`${a.best.samples}`} l="samples" title="How many times this read has fired — more samples = more trustworthy." />,
    <Stat key="s" align={align} v={a.best.stable ? "✓" : "—"} l="stable" color={a.best.stable ? POS : FAINT} title="Held up in BOTH halves of the record (walk-forward) — not a fluke of one stretch." />,
  ] : null;
  // Every horizon, not just the best — a preset holding into a NOISE window is invisible
  // if only the best one is shown.
  const hz = rated ? (a.horizons || []).filter((h) => h.verdict !== "INSUFFICIENT") : [];
  // The preset's own exit, and a 24h-hold copy of it (same TP/SL) on the same entry window.
  const exitsShown = rated ? [a.exit, a.exit24h].filter((g): g is ExitGrade => !!g && g.verdict !== "INSUFFICIENT") : [];
  const load = () => preset && deployToAgent({ ...preset.config, mode: "PAPER" }, `the ${preset.name} preset (PAPER)`, undefined, navigate, { replaceFilters: true });
  return (
    <div style={{ background: INSET, border: `1px solid ${BORDER}`, borderRadius: 5, padding: isMobile ? "10px 12px" : "9px 12px" }}>
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: BRIGHT, flex: isMobile ? 1 : "0 1 auto", minWidth: 0, lineHeight: 1.4, overflowWrap: "anywhere" }}>{a.label}</span>
        <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", color: v.color, border: `1px solid ${v.color}55`, borderRadius: 3, padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>{v.label}</span>
        {!isMobile && (stats
          ? <span style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "flex-end", flexShrink: 0 }}>{stats}</span>
          : <span style={{ ...statCell, marginLeft: "auto", color: FAINT }}>accruing — not yet rated</span>)}
      </div>
      {isMobile && (stats
        ? <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>{stats}</div>
        : <div style={{ ...statCell, color: FAINT, marginTop: 6 }}>accruing — not yet rated</div>)}
      {hz.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, fontFamily: MONO, fontSize: 9 }} title="Forward move after the read fired, by horizon (gross, close-to-close).">
          {hz.map((h) => {
            const tone = VERDICT[h.verdict] || VERDICT.INSUFFICIENT;
            return (
              <span key={h.h} style={{ whiteSpace: "nowrap", color: FOG }}>
                {h.h}h <span style={{ color: h.meanBps >= 0 ? POS : NEG }}>{h.meanBps >= 0 ? "+" : ""}{h.meanBps}</span>
                <span style={{ color: tone.color, marginLeft: 4, fontSize: 8 }}>{h.verdict === "PREDICTIVE" ? "◆" : h.verdict.toLowerCase()}</span>
              </span>
            );
          })}
        </div>
      )}
      {exitsShown.length > 0 && (
        <div style={{ marginTop: 8, padding: "7px 9px", border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE_ALT, fontFamily: MONO, fontSize: 9, color: FOG, lineHeight: 1.6 }}
          title="The read, traded the way the agent trades it: one position per market, first touch of stop or target along the logged hourly candles (a bar touching both = stop), else closed at the max hold. Net of a taker fee each side. Both exits use the same entry window. Informational — it doesn't change the read's grade.">
          <div style={{ color: MUTED, letterSpacing: "0.08em" }}>AS THE AGENT TRADES IT <span style={{ color: FAINT, letterSpacing: 0 }}>· TP {exitsShown[0].tpPercent}% · SL {exitsShown[0].slPercent}%</span></div>
          {exitsShown.map((x) => {
            const tone = VERDICT[x.verdict] || VERDICT.INSUFFICIENT;
            return (
              <div key={x.maxHoldHours} style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 4 }}>
                <span style={{ color: BRIGHT, minWidth: 92 }}>{x.maxHoldHours}h {x.presetExit ? "preset exit" : "exit"}</span>
                <span style={{ color: tone.color, fontWeight: 700 }}>{tone.label}</span>
                <span><span style={{ color: x.netBps >= 0 ? POS : NEG }}>{x.netBps >= 0 ? "+" : ""}{x.netBps}</span> bps net</span>
                <span>{x.hitRate}% win</span>
                <span>n{x.samples}</span>
                <span>{x.stable ? "stable" : "not stable"}</span>
                <span style={{ color: FAINT }}>TP {x.exits.TP || 0} · SL {x.exits.SL || 0} · time {x.exits.TIMEOUT || 0} · avg {x.avgHoldH}h</span>
                {x.oos && (
                  <span style={{ color: FAINT }} title="Only trades entered after the 12h-vs-24h question was raised — the out-of-sample test of that choice.">
                    since {x.oos.since.slice(5, 10)}: {x.oos.samples ? <>n{x.oos.samples} · <span style={{ color: x.oos.netBps >= 0 ? POS : NEG }}>{x.oos.netBps >= 0 ? "+" : ""}{x.oos.netBps}</span> bps</> : "no trades yet"}
                  </span>
                )}
              </div>
            );
          })}
          {!AXIS_PAUSED[a.name] && <EvidenceLine axis={a.name} />}
        </div>
      )}
      {preset ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={load} className="nx-press"
            style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: "#08080a", background: BONE, border: "none", borderRadius: 3, padding: "6px 12px", cursor: "pointer" }}>
            Load “{preset.name}” in the agent →
          </button>
          <span style={{ fontFamily: MONO, fontSize: 8.5, color: FAINT }}>PAPER · same rule the board grades · review, then Save</span>
        </div>
      ) : paused ? (
        <div style={{ fontFamily: MONO, fontSize: 8.5, color: FAINT, marginTop: 8 }}>{paused}</div>
      ) : rated && (a.verdict === "PREDICTIVE" || a.verdict === "PROMISING") ? (
        <div style={{ fontFamily: MONO, fontSize: 8.5, color: FAINT, marginTop: 8 }}>research read — not an agent mode yet</div>
      ) : null}
    </div>
  );
}

function BoardShell({ title, count, children }: { title: string; count?: number | null; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: BONE }}>{title}</span>
        {count != null && count > 0 && <span style={{ fontFamily: MONO, fontSize: 9, color: FAINT }}>{count}</span>}
      </div>
      <div style={{ height: 1, background: BORDER, marginBottom: 8 }} />
      {children}
    </div>
  );
}

const rowStyle = (clickable: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 10, background: INSET, border: `1px solid ${BORDER}`,
  borderRadius: 5, padding: "8px 10px", overflowX: "auto", cursor: clickable ? "pointer" : "default",
});
const rankCell: React.CSSProperties = { fontFamily: MONO, fontSize: 11, color: FAINT, flexShrink: 0, width: 22 };
const nameCell: React.CSSProperties = { fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0, whiteSpace: "nowrap" };
const statCell: React.CSSProperties = { fontFamily: MONO, fontSize: 9.5, color: FOG, flexShrink: 0 };
const scoreCell: React.CSSProperties = { marginLeft: "auto", fontFamily: MONO, fontSize: 13, fontWeight: 700, flexShrink: 0 };
const empty = (t: string) => <div style={{ fontFamily: MONO, fontSize: 11, color: FAINT, padding: "6px 2px" }}>{t}</div>;

function Pfp({ src }: { src?: string }) {
  return src
    ? <img src={src} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#1a1a1e", border: `1px solid ${BORDER}`, flexShrink: 0 }} />;
}

const fmtDate = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

// ── PROOF OF EDGE card — one resolved call, traced through the public record ──
// Borrowed framing (Quotient): the thesis → the levels → the first-touch outcome,
// none of it self-reported. Directional chips stay monochrome (positioning, not P&L);
// only the WIN/LOSS outcome + R carry the pos/neg chroma.
function ProofEdgeCard({ c, onClick }: { c: ProofCard; onClick: () => void }) {
  const win = c.outcome === "WIN";
  const tone = win ? POS : NEG;
  const chip: React.CSSProperties = { fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", color: BRIGHT, background: "#141416", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "2px 6px", whiteSpace: "nowrap" };
  return (
    <div onClick={onClick} style={{
      background: SURFACE_ALT, border: `1px solid ${BORDER}`, borderLeft: `2px solid ${tone}`,
      borderRadius: 6, padding: 12, cursor: "pointer", display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Author + outcome */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Pfp src={c.pfp || undefined} />
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.displayName || short(c.wallet)}</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, fontWeight: 700, color: tone, whiteSpace: "nowrap" }}>
          {win ? "✓ WIN" : "✗ LOSS"} {c.r >= 0 ? "+" : ""}{c.r}R
        </span>
      </div>
      {/* Market line */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: BONE }}>{c.coin}</span>
        <span style={chip}>{c.direction}</span>
        {c.regimeTrend && <span style={{ fontFamily: MONO, fontSize: 8, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 5px" }}>{c.regimeTrend.replace("TREND_", "").replace("_", " ")}</span>}
        {c.gradedAt && <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 8.5, color: FAINT }}>{fmtDate(c.createdAt)} → {fmtDate(c.gradedAt)}</span>}
      </div>
      {/* Thesis */}
      {c.thesis && (
        <div style={{ fontFamily: UI, fontSize: 12, color: FOG, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          "{c.thesis}"
        </div>
      )}
      {/* Catalyst + exit window (the Signal framing) */}
      {(c.catalyst || c.targetWindow) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {c.catalyst && <span style={{ fontFamily: MONO, fontSize: 9.5, color: FOG, background: "#141416", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "2px 6px" }}>⚡ {c.catalyst}</span>}
          {c.targetWindow && <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED }}>⌛ {c.targetWindow}</span>}
        </div>
      )}
      {/* Levels — the claim that was graded */}
      {c.entryPrice != null && (
        <div style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT, borderTop: `1px solid ${BORDER}`, paddingTop: 7 }}>
          entry {c.entryPrice} · target {c.takeProfit1 ?? "—"} · stop {c.stopLoss ?? "—"}
        </div>
      )}
    </div>
  );
}

export default function ProofPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [callers, setCallers] = useState<Caller[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [arena, setArena] = useState<ArenaAgent[] | null>(null);
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [proof, setProof] = useState<ProofOfEdge | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);

  const load = useCallback(() => {
    fetch(`${API}/theses/leaderboard`).then((r) => r.json()).then((d) => setCallers(Array.isArray(d?.leaderboard) ? d.leaderboard : [])).catch(() => setCallers([]));
    fetch(`${API}/agents/leaderboard`).then((r) => r.json()).then((d) => setAgents(Array.isArray(d?.leaderboard) ? d.leaderboard : [])).catch(() => setAgents([]));
    fetch(`${API}/arena/agents`).then((r) => r.json()).then((d) => setArena(Array.isArray(d?.agents) ? d.agents : [])).catch(() => setArena([]));
    fetch(`${API}/desks`).then((r) => r.json()).then((d) => setDesks(Array.isArray(d?.desks) ? d.desks : [])).catch(() => setDesks([]));
    fetch(`${API}/agents/ledger`).then((r) => r.json()).then(setLedger).catch(() => setLedger(null));
    fetch(`${API}/theses/proof-of-edge`).then((r) => r.json()).then((d) => setProof({ cards: Array.isArray(d?.cards) ? d.cards : [], summary: d?.summary })).catch(() => setProof({ cards: [] }));
    fetch(`${API}/intel/axis-backtest`).then((r) => r.json()).then((d) => setScorecard(Array.isArray(d?.axes) ? d : { axes: [] })).catch(() => setScorecard({ axes: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const show = (f: Filter) => filter === "all" || filter === f;
  const totalRecords = useMemo(
    () => (callers?.length ?? 0) + (agents?.length ?? 0) + (arena?.length ?? 0) + (desks?.length ?? 0),
    [callers, agents, arena, desks]
  );

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "ALL" },
    { id: "callers", label: "CALLERS" },
    { id: "agents", label: "AGENTS" },
    { id: "arena", label: "ARENA" },
    { id: "desks", label: "DESKS" },
    { id: "signals", label: "SIGNALS" },
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "20px 14px 60px" : "32px 24px 80px" }}>
      <SectionHeader
        eyebrow="THE PROOF"
        title="Every track record on Nexus — graded, not claimed"
        note={totalRecords > 0 ? `${totalRecords} RANKED` : "TRUSTLESS BY DESIGN"}
      />

      <div style={{ fontFamily: UI, fontSize: 13.5, color: FOG, lineHeight: 1.65, maxWidth: 660 }}>
        Humans, machines, and teams — all ranked on <b style={{ color: BRIGHT }}>one standard</b>. Every record here is
        graded from public price (first-touch target vs. stop for calls; settled trades for agents), never
        self-reported, and hashed into a ledger anyone can recompute and check against the chain. This is the part
        competitors can't copy: being <i>right</i> is the only thing that ranks.
      </div>

      {/* FEATURED LEAD — the engine's validated edge, front and center (booth hero). */}
      <FeaturedLead isMobile={isMobile} />

      {/* Ledger trust strip — the primitive that unifies everything. */}
      {ledger?.ledgerHash && (
        <div style={{ marginTop: 20, border: `1px solid ${BORDER}`, borderLeft: `2px solid ${BONE}`, borderRadius: 6, background: SURFACE_ALT, padding: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: BONE }}>🔗 LEDGER SHA-256</span>
          <code style={{ fontFamily: MONO, fontSize: 10.5, color: FOG, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "3px 8px" }}>
            {ledger.ledgerHash.slice(0, 12)}…{ledger.ledgerHash.slice(-10)}
          </code>
          {ledger.count != null && <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>{ledger.count} records</span>}
          <a href={`${API}/agents/ledger`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 9.5, color: FOG, textDecoration: "none" }}>recompute ↗</a>
          {ledger.onChain?.verified && (
            <a href={ledger.onChain.explorer || "#"} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 9.5, color: BONE, textDecoration: "none", border: `1px solid #33333a`, borderRadius: 3, padding: "3px 8px", background: "#1a1a1e" }}>
              ⛓ ANCHORED ON-CHAIN ↗
            </a>
          )}
        </div>
      )}

      {/* HOUSE CARRY SLEEVE — our own strategy, run in the open (transparency-as-product). */}
      <CarrySleeve />

      {/* PROOF OF EDGE — resolved calls traced through the public record. The flagship
          trust artifact: not a leaderboard number, the actual calls behind it. */}
      {proof && proof.cards.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: BONE }}>PROOF OF EDGE</span>
            {proof.summary && proof.summary.resolved > 0 && (
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>
                {proof.summary.resolved} resolved · {proof.summary.hitRate}% hit · {proof.summary.avgR >= 0 ? "+" : ""}{proof.summary.avgR}R avg
              </span>
            )}
          </div>
          <div style={{ height: 1, background: BORDER, marginBottom: 12 }} />
          <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.6, maxWidth: 660, marginBottom: 14 }}>
            The calls behind the record — thesis, levels, and first-touch outcome, graded from public price.
            Ranked by graded R; the aggregate above is every resolved public call, not just these.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
            {proof.cards.slice(0, 12).map((c) => (
              <ProofEdgeCard key={`${c.wallet}-${c.coin}-${c.gradedAt ?? c.createdAt}`} c={c} onClick={() => navigate(`/feed/trader/${c.wallet}`)} />
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: "flex", gap: 6, marginTop: 22, marginBottom: 22, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", padding: "6px 13px", borderRadius: 4, cursor: "pointer",
            background: filter === f.id ? "#1a1a1e" : "none",
            border: `1px solid ${filter === f.id ? BONE : BORDER}`,
            color: filter === f.id ? BONE : MUTED,
          }}>{f.label}</button>
        ))}
      </div>

      {/* CALLERS — humans, graded from public price */}
      {show("callers") && (
        <BoardShell title="VERIFIED CALLERS" count={callers?.length}>
          {callers === null ? empty("loading…") : callers.length === 0 ? empty("No qualified callers yet — 5+ graded calls to rank.") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {callers.slice(0, 15).map((c, i) => (
                <div key={c.wallet} onClick={() => navigate(`/feed/trader/${c.wallet}`)} style={rowStyle(true)}>
                  <span style={rankCell}>{i + 1}</span>
                  <Pfp src={c.pfp} />
                  <span style={nameCell}>{c.displayName || short(c.wallet)}</span>
                  {c.meritRank?.glyph && <span title={c.meritRank.title} style={{ fontFamily: MONO, fontSize: 10, color: BONE, flexShrink: 0 }}>{c.meritRank.glyph}</span>}
                  <span style={statCell}>{c.calls} calls · {c.hitRate}% · {c.avgR >= 0 ? "+" : ""}{c.avgR}R</span>
                  <span style={{ ...scoreCell, color: c.score > 0 ? BONE : FAINT }}>{c.score || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </BoardShell>
      )}

      {/* AGENTS — Nexus autonomous agents, settled trades */}
      {show("agents") && (
        <BoardShell title="AUTONOMOUS AGENTS" count={agents?.length}>
          {agents === null ? empty("loading…") : agents.length === 0 ? empty("No ranked agents yet — 10 live trades over 3+ days to qualify.") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agents.slice(0, 15).map((a) => (
                <div key={a.wallet} onClick={() => navigate(`/feed/trader/${a.wallet}`)} style={rowStyle(true)}>
                  <span style={rankCell}>{a.rank}</span>
                  <Pfp src={a.pfp} />
                  <span style={nameCell}>{a.displayName || short(a.wallet)}</span>
                  <span style={statCell}>{a.trades}T · {a.winRate}% · PF {a.profitFactor} · <span style={{ color: a.netPnl >= 0 ? POS : NEG }}>{usd(a.netPnl)}</span></span>
                  <span style={{ ...scoreCell, color: a.score > 0 ? BONE : FAINT }}>{a.score || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </BoardShell>
      )}

      {/* ARENA — external AI agents, paper + live */}
      {show("arena") && (
        <BoardShell title="🏟️ ARENA — EXTERNAL AI AGENTS" count={arena?.length}>
          {arena === null ? empty("loading…") : arena.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: FAINT, padding: "6px 2px" }}>
              The open proving ground is live — no agents registered yet. <span onClick={() => navigate("/arena")} style={{ color: BONE, cursor: "pointer" }}>Enter the Arena →</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {arena.slice(0, 15).map((a, i) => {
                const s = a.live || a.paper;
                return (
                  <div key={a.wallet} onClick={() => navigate("/arena")} style={rowStyle(true)}>
                    <span style={rankCell}>{i + 1}</span>
                    <span style={nameCell}>{a.name}</span>
                    {a.builder && <span style={{ fontFamily: MONO, fontSize: 8, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>{a.builder}</span>}
                    <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.06em", color: a.live ? BONE : FAINT, flexShrink: 0 }}>{a.live ? "⛓ LIVE" : "PAPER"}</span>
                    {s ? <span style={{ ...scoreCell, fontSize: 9.5, color: FOG }}>{s.trades}T · {s.winRate}% · <span style={{ color: s.netPnl >= 0 ? POS : NEG }}>{usd(s.netPnl)}</span></span>
                       : <span style={{ ...scoreCell, fontSize: 9.5, color: FAINT }}>no graded trades yet</span>}
                  </div>
                );
              })}
            </div>
          )}
        </BoardShell>
      )}

      {/* DESKS — teams, combined graded call record */}
      {show("desks") && (
        <BoardShell title="◆ DESKS — TEAMS" count={desks?.length}>
          {desks === null ? empty("loading…") : desks.length === 0 ? empty("No desks yet — teams rank by their members' combined graded record.") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {desks.slice(0, 15).map((d) => (
                <div key={d.id} onClick={() => navigate("/feed")} style={rowStyle(true)}>
                  <span style={rankCell}>#{d.rank}</span>
                  <span style={nameCell}>{d.name}</span>
                  <span style={statCell}>{d.members}👤 · {d.calls} calls · {d.hitRate}% · {d.totalR >= 0 ? "+" : ""}{d.totalR}R</span>
                  <span style={{ ...scoreCell, color: d.score > 0 ? BONE : FAINT }}>{d.score || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </BoardShell>
      )}

      {/* SIGNALS — we grade our OWN reads by the same trustless standard. The part nobody
          else does: publishing which of our signals work and which don't, walk-forward. */}
      {show("signals") && (
        <BoardShell title="◆ SIGNAL SCOREBOARD — OUR OWN READS, GRADED" count={scorecard?.axes?.length}>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.6, maxWidth: 660, marginBottom: 12 }}>
            Every read in the engine, scored the way we grade traders — <b style={{ color: BRIGHT }}>forward returns, no lookahead</b>, pooled across the core markets, with a walk-forward stability check.
            A read is not an edge until it's <span style={{ color: POS }}>◆ PREDICTIVE</span> here. Most sit at <span style={{ color: FAINT }}>ACCRUING</span> until the self-logged history matures and the sample clears the bar.
            <span style={{ display: "block", marginTop: 8, color: MUTED, fontSize: 11.5 }}>
              Reading a row — <b style={{ color: FOG }}>horizon</b> (how far ahead) · <b style={{ color: FOG }}>hit rate</b> (share that went the right way) · <b style={{ color: FOG }}>edge</b> (avg move caught, 100 bps = 1%) · <b style={{ color: FOG }}>samples</b> (times it&rsquo;s fired) · <b style={{ color: FOG }}>stable</b> (held up in both halves).
            </span>
          </div>
          {scorecard === null ? empty("loading…") : !scorecard.axes?.length ? empty("scorecard warming up…") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {scorecard.axes.map((a) => <SignalRow key={a.name} a={a} />)}
            </div>
          )}
          <div style={{ fontFamily: MONO, fontSize: 8.5, color: FAINT, marginTop: 10, lineHeight: 1.5 }}>
            {scorecard?.config?.coins?.length ? `pooled across ${scorecard.config.coins.length} markets · min ${scorecard.config.minSamples} obs to rate` : "self-graded · walk-forward"}
            {scorecard?.asOf ? ` · updated ${new Date(scorecard.asOf).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
            {" "}· we publish the misses too — that's the point.
          </div>
        </BoardShell>
      )}

      {/* Footer — how grading works */}
      <div style={{ marginTop: 30, paddingTop: 16, borderTop: `1px solid ${BORDER}`, fontFamily: UI, fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
        Calls are graded from public 1h price — first touch of target vs. stop, same-candle counted as a loss.
        Agents are ranked on real settled trades carrying exchange order IDs. Nobody types in a P&L.
        Want your own record? <span onClick={() => navigate("/analyze")} style={{ color: BONE, cursor: "pointer" }}>X-ray any wallet →</span>
      </div>
    </div>
  );
}
