// ◆ THE BRIEFING — the Lab's intelligence layer, made visible.
// Two lenses, one voice:
//   • THE MARKET — a general, wallet-free read of what's going on right now (tape,
//     crowded funding, confluence setups, movers, live agents). So the Lab feels
//     intelligent to ANYONE, connected or not.
//   • YOUR TERMINAL — a personalized read of your graded record + open risk (only
//     when connected with trades).
// Deterministic (no LLM, no key, instant), with a one-tap hand-off to Nexus to
// go deeper. Renders nothing when there's genuinely nothing to say (cold-start safe).
import { useEffect, useMemo, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { Collapsible } from "./Collapsible";
import type { TabId, ProcessedTrade } from "./types";
import { buildBriefing, buildMarketRead, buildFusion, computeBreadth, type BriefingTrade, type Insight, type MarketSignal } from "./briefing";
import { useFadeFamilyGrade } from "./useFadeFamilyGrade";
import { buildOperatorProfile, profileNarrative } from "@/lib/operatorProfile.mjs";
import { tiltRead, sessionEdge, overtradingRead, sizingRead } from "@/lib/behavioral.mjs";
import { computeEdge } from "@/config/edge";
import { bareTicker } from "@/utils/utils";
import { C } from "@/config/theme";

// Bare ticker for the briefing's symbol dedup (BTC, not PERP_BTC_USDC).


type Consensus = Record<string, { side: "LONG" | "SHORT" | "SPLIT"; lean: number; participants: number }>;

const PROXY = "https://orderly-proxy.stephenpatrick24.workers.dev";
const AGENT_API = "https://og.nexustradinglabs.com";
const COLLAPSE_KEY = "nexus_briefing_collapsed";

// The left bar + rank number. Positive = the bone accent mark, not green: green is kept for money
// and price (docs/brand.md), and an insight is a fact, not a P&L. Caution = amber, info = grey.
const TONE: Record<Insight["tone"], { bar: string; dot: string }> = {
  positive: { bar: C.brand, dot: C.brand },
  caution: { bar: "#fbbf24", dot: "#fbbf24" },
  info: { bar: "#33333a", dot: "#71717a" },
};

function InsightRow({ ins, onSelectTab, rank }: { ins: Insight; onSelectTab: (t: TabId) => void; rank?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 14px", borderBottom: `1px solid ${C.surface}`, borderLeft: `2px solid ${TONE[ins.tone].bar}` }}>
      {rank != null ? (
        <span style={{ flexShrink: 0, width: 18, height: 18, marginTop: 1, borderRadius: "50%", border: `1px solid ${TONE[ins.tone].dot}`, color: TONE[ins.tone].dot, fontFamily: "var(--nx-font-mono)", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{rank}</span>
      ) : (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: TONE[ins.tone].dot, flexShrink: 0, marginTop: 5 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 12, color: "#f4f4f5", fontWeight: 600, lineHeight: 1.3 }}>{ins.title}</div>
        <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 11.5, color: "#a1a1aa", lineHeight: 1.5, marginTop: 2 }}>{ins.detail}</div>
      </div>
      {ins.action?.tab && (
        <button
          onClick={() => onSelectTab(ins.action!.tab as TabId)}
          className="nx-btn"
          style={{ flexShrink: 0, fontSize: 12, padding: "5px 12px", color: "#ededf0", borderColor: "#33333a", whiteSpace: "nowrap" }}
        >{ins.action.label} →</button>
      )}
    </div>
  );
}

function GroupLabel({ text }: { text: string }) {
  return (
    <div style={{ padding: "9px 14px 5px", fontFamily: "var(--nx-font-mono)", fontSize: 8.5, letterSpacing: "0.2em", color: C.text.faint, textTransform: "uppercase", background: C.surfaceAlt }}>{text}</div>
  );
}

export function NexusBriefing({
  trades, winRate, totalPnl, openPositions, wallet, onSelectTab,
}: {
  trades: ProcessedTrade[];
  winRate: number;
  totalPnl: number;
  openPositions: { symbol: string; direction: "LONG" | "SHORT" }[];
  wallet: string | null;
  onSelectTab: (t: TabId) => void;
}) {
  const [rows, setRows] = useState<{ symbol: string; "24h_open"?: string | number; "24h_close"?: string | number }[] | null>(null);
  const [signals, setSignals] = useState<MarketSignal[] | null>(null);
  const fadeGrade = useFadeFamilyGrade(); // the plain funding fade's live grade, for FADE rows
  const [liveAgents, setLiveAgents] = useState<number | null>(null);
  const [agentActive, setAgentActive] = useState<boolean | null>(null);
  const [consensus, setConsensus] = useState<Consensus | null>(null);
  const [process, setProcess] = useState<Record<string, unknown> | null>(null);
  // Folded by default (borst, 2026-11-05: Lab home leads with the graded calls, the read is one tap
  // away). Only an explicit earlier "show" ("0" under the old key) opens it on arrival.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) !== "0"; } catch { return true; }
  });

  // Market context — all public, all fail-soft. Any that fails simply drops the
  // insights that depend on it; the rest still render.
  useEffect(() => {
    let alive = true;
    fetch(PROXY).then((r) => r.json()).then((j) => { if (alive) setRows(j?.data?.rows ?? []); }).catch(() => { /* no tape/movers */ });
    sharedJson(`${AGENT_API}/signals`).then((j) => { if (alive) setSignals(Array.isArray(j?.signals) ? j.signals : []); }).catch(() => { /* no setups */ });
    // /agents/live returns { count, positions:[...] } — count is authoritative.
    sharedJson(`${AGENT_API}/agents/live`).then((j) => { if (alive) setLiveAgents(typeof j?.count === "number" ? j.count : (Array.isArray(j?.positions) ? j.positions.length : 0)); }).catch(() => { /* no live count */ });
    // The merit-weighted caller lean per symbol — the graded crowd, for the fusion.
    sharedJson(`${AGENT_API}/theses/consensus`).then((j) => { if (alive) setConsensus(j?.consensus ?? null); }).catch(() => { /* no crowd lean */ });
    return () => { alive = false; };
  }, []);

  // Agent status — powers the "proven record, no agent running" personal nudge.
  useEffect(() => {
    if (!wallet) { setAgentActive(null); return; }
    let alive = true;
    fetch(`${AGENT_API}/agent/${wallet}`).then((r) => r.json())
      .then((d) => { if (alive) setAgentActive(!!d?.state?.active); })
      .catch(() => { /* nudge just won't fire */ });
    // My own crowd-fading record + align (with/counter-trend) edge — both feed the fusion.
    fetch(`${AGENT_API}/theses/process/${wallet}`).then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setProcess(d && typeof d === "object" ? d : null);
      })
      .catch(() => { /* fusion still fires without it */ });
    return () => { alive = false; };
  }, [wallet]);

  const tape = useMemo(() => computeBreadth(rows), [rows]);

  const personal = useMemo(() => {
    if (!wallet || !trades.length) return [];
    const bt: BriefingTrade[] = trades.map((t) => ({ symbol: t.symbol, direction: t.direction, pnl: t.pnl, timestamp: t.timestamp }));
    return buildBriefing({
      trades: bt, winRate, totalPnl, openPositions,
      agent: agentActive == null ? null : { active: agentActive },
    }).slice(0, 3);
  }, [wallet, trades, winRate, totalPnl, openPositions, agentActive]);

  // ⭐ THE FUSION — is the market's setup MINE? Intersects the crowded-fade signal,
  // the graded caller lean, and my own edge. Leads the briefing when it fires.
  const fusion = useMemo(() => {
    const bt: BriefingTrade[] = trades.map((t) => ({ symbol: t.symbol, direction: t.direction, pnl: t.pnl, timestamp: t.timestamp }));
    return buildFusion({ trades: bt, signals, consensus, fadeGrade }).slice(0, 1);
  }, [trades, signals, consensus, fadeGrade]);

  // ⭐ THE OPERATOR READ — the Lab's one point of view about YOU, surfaced proactively
  // on the OBSERVE tab instead of buried in Analytics. Composed from the same builder
  // (archetype + severity-ranked reads); the full card + share + unlocks stay in
  // Analytics. Only fires once the record is real (tier ≠ UNKNOWN).
  const operator = useMemo(() => {
    if (!wallet || !trades.length) return null;
    const bt: BriefingTrade[] = trades.map((t) => ({ symbol: t.symbol, direction: t.direction, pnl: t.pnl, timestamp: t.timestamp }));
    const sized = trades.map((t) => ({ pnl: t.pnl, timestamp: t.timestamp, size: t.qty * t.price }));
    const p = buildOperatorProfile({
      process,
      edge: computeEdge(trades.map((t) => ({ symbol: t.symbol, pnl: t.pnl, side: t.side || t.direction }))),
      behavioral: { tilt: tiltRead(bt), session: sessionEdge(bt), overtrading: overtradingRead(bt), sizing: sizingRead(sized) },
      trades,
    });
    if (!p || p.tier === "UNKNOWN" || (!p.archetype && !p.reads.length)) return null;
    // Lead with WHO you are + your single costliest read (severity-ranked already).
    return { archetype: p.archetype, lead: p.reads[0] || null, meritRank: p.meritRank, tier: p.tier, narrative: profileNarrative(p, { max: 2 }) };
  }, [wallet, trades, process]);

  // The "flagged setups" coaching loop is gone (2026-11-28): it counted how many of the Briefing's "your setup" fades
  // you took, and the Briefing no longer calls any setup yours.

  const market = useMemo(
    () => buildMarketRead({ rows, signals, liveAgents, tape, consensus, fadeGrade })
      .filter((m) => !fusion.some((f) => f.detail.startsWith(m.title.split(" ")[0]))) // avoid echoing the fusion's symbol read
      .slice(0, (personal.length ? 3 : 3) - Math.min(fusion.length, 1)),
    [rows, signals, liveAgents, tape, consensus, fadeGrade, personal.length, fusion]
  );

  // ⭐ THE ACTION QUEUE — the deepening: instead of three separate lenses, merge every
  // read into ONE list ranked by priority and present it as a numbered "what to act on,
  // in order" queue. The fusion (your edge × the market) naturally floats to the top by
  // its own priority; coaching/personal/market fall in behind by importance. Deduped by id.
  const queue = useMemo(() => {
    const all: Insight[] = [...fusion, ...personal, ...market];
    const seen = new Set<string>();
    const byId = all.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
    // Dedup by SYMBOL as well as by id (Grok). The four builders are independent, so the same
    // coin could arrive from the fusion, a personal read and a market read under three different
    // ids and take three of the briefing's slots — "SOL" three times reads like the Lab has one
    // idea. Sort FIRST so the survivor per symbol is the highest-priority read of it, not
    // whichever builder happened to run first. Symbol-less reads (the tape, your record, the
    // session edge) always pass — they aren't about a coin.
    const known = new Set((signals || []).map((s) => bareTicker(s.symbol).toUpperCase()));
    const symbolOf = (i: Insight): string | null => {
      if (i.meta?.symbol) return bareTicker(i.meta.symbol).toUpperCase();
      for (const tok of i.title.toUpperCase().match(/[A-Z0-9]{2,6}/g) || []) if (known.has(tok)) return tok;
      return null;
    };
    const usedSym = new Set<string>();
    return byId
      .sort((a, b) => b.priority - a.priority)
      .filter((i) => {
        const s = symbolOf(i);
        if (!s) return true;
        if (usedSym.has(s)) return false;
        usedSym.add(s);
        return true;
      })
      // Three items, not five: a briefing you scroll is a feed. The rest of the read is one tap
      // away on the Board, which ranks every market anyway.
      .slice(0, 3);
  }, [fusion, personal, market, signals]);

  if (!queue.length) return null;

  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? "1" : "0"); } catch { /* ignore */ } return n; });

  const total = queue.length;
  const askAi = () => window.dispatchEvent(new CustomEvent("nexus:assistant-ask", {
    detail: {
      prompt: personal.length
        ? "Use get_my_edge and get_market_regime: lay out my own record and the market's inputs right now as facts, with each read's grade, and name the one pattern in my record that cost me the most."
        : "Use get_market_regime and get_smart_money: lay out the market's inputs right now as facts, with each read's grade or \"not graded\".",
    },
  }));

  return (
    <Collapsible
      title="The briefing · what matters right now"
      subtitle={`${total} ${total === 1 ? "fact" : "facts"} worth a look${tape ? ` · ${tape.up} of ${tape.total} markets up` : ""}`}
      shortTitle="The briefing"
      shortSub={`${total} worth a look`}
      open={!collapsed}
      onToggle={toggle}
    >
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", background: C.surfaceAlt }}>
          {/* ⭐ THE OPERATOR READ — who you are + your single costliest habit, leading the
              briefing so the you-engine greets you here, not just in Analytics. */}
          {operator && (
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 8.5, letterSpacing: "0.2em", color: "#52525b", textTransform: "uppercase" }}>Your operator read</span>
                  {operator.meritRank && <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 8, color: "#a1a1aa", border: "1px solid #33333a", borderRadius: 2, padding: "0 4px" }}>{operator.meritRank.glyph} {operator.meritRank.title.toUpperCase()}</span>}
                </span>
                <button onClick={() => onSelectTab("analytics")} style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#a1a1aa", background: "none", border: "none", cursor: "pointer", padding: 0 }}>full profile →</button>
              </div>
              {operator.archetype && (
                <div style={{ fontFamily: "var(--nx-font-serif)", fontSize: 17, color: "#f4f4f5", marginTop: 5, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{operator.archetype.label}</div>
              )}
              {operator.lead && (
                <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#a1a1aa", lineHeight: 1.55, marginTop: 5 }}>
                  {operator.lead.text.charAt(0).toUpperCase() + operator.lead.text.slice(1)}.
                </div>
              )}
            </div>
          )}
          {/* ⭐ THE ACTION QUEUE — one ranked list, most important first. What to act on,
              in order — your edge × the market floats to the top by priority. */}
          <GroupLabel text="Facts, not advice · most relevant first" />
          {queue.map((ins, i) => <InsightRow key={ins.id} ins={ins} onSelectTab={onSelectTab} rank={i + 1} />)}
          {/* Hand-off to the copilot. Not a duplicate of the floating bubble: the bubble opens an
              empty chat, this asks a prepared question built from THIS briefing (your record +
              the tape). Kept as a quiet text action, no box, no glyph. */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 14px" }}>
            <button onClick={askAi} className="nx-text-action" style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12.5, fontWeight: 600, color: "#a1a1aa", background: "none", border: "none", padding: "4px 0", cursor: "pointer", whiteSpace: "nowrap" }}>
              Ask Nexus about this →
            </button>
          </div>
        </div>
    </Collapsible>
  );
}
