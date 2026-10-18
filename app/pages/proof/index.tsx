// ── THE PROOF — the unified track-records hub ────────────────────────────────
// One destination for every trustless record Nexus produces: our own signals, human
// callers, autonomous agents, external AI agents (the Arena), and desks (teams). All graded
// from public data, never self-reported, and anchored to a recomputable on-chain ledger.
// Order (borst, 2026-10-18: less words, more show): the verdict → the signal board, by stage
// → graded calls + verified callers → the other records, folded → the ledger line.
// Every board is fail-soft: sparse at cold-start by design, never broken.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import CarrySleeve from "./CarrySleeve";
import FeaturedLead from "./FeaturedLead";
import SignalBoard, { type Scorecard } from "./SignalBoard";
import { pressKey } from "@/utils/a11y";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BONE = "#ededf0", BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b";
const POS = "#3ecf8e", NEG = "#f7525f";
const BORDER = "#232327", SURFACE_ALT = "#0f0f11", INSET = "#08080a";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}K` : Math.abs(n).toFixed(2)}`;

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

// The anchor contract ON ARBITRUM — public, no login, always resolves (the fallback when the
// ledger read fails or its on-chain proof isn't verified yet).
const ANCHOR_EXPLORER = "https://arbiscan.io/address/0x57a698df84a44F3dA3dac3E08CA455a55A4eff84";

function SectionTitle({ title }: { title: string }) {
  return <h2 style={{ margin: "0 0 12px", fontFamily: UI, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>{title}</h2>;
}

function BoardShell({ title, count, children }: { title: string; count?: number | null; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: BONE }}>{title}</span>
        {count != null && count > 0 && <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

// A record set that sits one tap away: the title and its count show, the board opens on tap.
function Fold({ title, count, children }: { title: string; count?: number | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${BORDER}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "14px 2px", textAlign: "left" }}>
        <span style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, color: BRIGHT }}>{title}</span>
        {count != null && <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>{count}</span>}
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 12, color: MUTED }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ paddingBottom: 14 }}>{children}</div>}
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
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={pressKey(onClick)} style={{
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
          &quot;{c.thesis}&quot;
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
  // Phone: a ranks row wraps instead of scrolling sideways — rank · name · score stay on line 1
  // (the score is the number that matters), the stats drop to line 2 under the name.
  const rowM: React.CSSProperties = isMobile ? { flexWrap: "wrap", rowGap: 4, overflowX: "visible" } : {};
  const statM: React.CSSProperties = isMobile ? { order: 10, flexBasis: "100%", paddingLeft: 32, marginLeft: 0 } : {};
  const navigate = useNavigate();
  const [callers, setCallers] = useState<Caller[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [arena, setArena] = useState<ArenaAgent[] | null>(null);
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [proof, setProof] = useState<ProofOfEdge | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [allCalls, setAllCalls] = useState(false);

  const load = useCallback(() => {
    fetch(`${API}/theses/leaderboard`).then((r) => r.json()).then((d) => setCallers(Array.isArray(d?.leaderboard) ? d.leaderboard : [])).catch(() => setCallers([]));
    fetch(`${API}/agents/leaderboard`).then((r) => r.json()).then((d) => setAgents(Array.isArray(d?.leaderboard) ? d.leaderboard : [])).catch(() => setAgents([]));
    fetch(`${API}/arena/agents`).then((r) => r.json()).then((d) => setArena(Array.isArray(d?.agents) ? d.agents : [])).catch(() => setArena([]));
    fetch(`${API}/desks`).then((r) => r.json()).then((d) => setDesks(Array.isArray(d?.desks) ? d.desks : [])).catch(() => setDesks([]));
    fetch(`${API}/agents/ledger`).then((r) => r.json()).then(setLedger).catch(() => setLedger(null));
    fetch(`${API}/theses/proof-of-edge`).then((r) => r.json()).then((d) => setProof({ cards: Array.isArray(d?.cards) ? d.cards : [], summary: d?.summary })).catch(() => setProof({ cards: [] }));
    fetch(`${API}/intel/axis-backtest`).then((r) => r.json()).then((d) => setScorecard(Array.isArray(d?.axes) ? d : { axes: [] })).catch(() => setScorecard({ axes: [], failed: true }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const cards = proof?.cards ?? [];
  const shownCards = allCalls ? cards.slice(0, 12) : cards.slice(0, 6);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "24px 16px 60px" : "40px 24px 80px" }}>
      {/* 1 · THE VERDICT — what the Oct 15 re-validation decided (none cleared the bar). */}
      <FeaturedLead isMobile={isMobile} />

      {/* 2 · THE SIGNAL BOARD — our own reads, by stage. The misses stay on it. */}
      <SignalBoard scorecard={scorecard} />

      {/* 3 · GRADED CALLS + VERIFIED CALLERS — the human record, traced call by call. */}
      <section style={{ marginTop: 44 }}>
        <SectionTitle title="Graded calls" />
        {/* The cards are the TOP calls by graded R, so they read as wins. The record is every resolved
            public call, and it stays in plain sight next to them. */}
        {proof?.summary && proof.summary.resolved > 0 && (
          <div style={{ marginTop: -4, marginBottom: 12, fontFamily: MONO, fontSize: 10.5, color: FOG, lineHeight: 1.6 }}>
            All {proof.summary.resolved} resolved public calls: {proof.summary.hitRate}% hit ·{" "}
            <span style={{ color: proof.summary.avgR >= 0 ? POS : NEG }}>{proof.summary.avgR >= 0 ? "+" : ""}{proof.summary.avgR}R</span> avg.
            <span style={{ color: MUTED }}> Below: the best by graded R.</span>
          </div>
        )}
        {cards.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
              {shownCards.map((c) => (
                <ProofEdgeCard key={`${c.wallet}-${c.coin}-${c.gradedAt ?? c.createdAt}`} c={c} onClick={() => navigate(`/feed/trader/${c.wallet}`)} />
              ))}
            </div>
            {cards.length > 6 && (
              <button type="button" onClick={() => setAllCalls((v) => !v)}
                style={{ marginTop: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: UI, fontSize: 12, color: MUTED }}>
                {allCalls ? "Show fewer ↑" : `Show ${Math.min(cards.length, 12) - 6} more ↓`}
              </button>
            )}
          </>
        )}

        <div style={{ marginTop: 22 }}>
          <BoardShell title="VERIFIED CALLERS" count={callers?.length}>
            {callers === null ? empty("loading…") : callers.length === 0 ? empty("No qualified callers yet: 5+ graded calls and net-positive R to rank.") : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {callers.slice(0, 15).map((c, i) => (
                  <div role="link" tabIndex={0} key={c.wallet} onClick={() => navigate(`/feed/trader/${c.wallet}`)} onKeyDown={pressKey(() => navigate(`/feed/trader/${c.wallet}`))} style={{ ...rowStyle(true), ...rowM }}>
                    <span style={rankCell}>{i + 1}</span>
                    <Pfp src={c.pfp} />
                    <span style={nameCell}>{c.displayName || short(c.wallet)}</span>
                    {c.meritRank?.glyph && <span title={c.meritRank.title} style={{ fontFamily: MONO, fontSize: 10, color: BONE, flexShrink: 0 }}>{c.meritRank.glyph}</span>}
                    <span style={{ ...statCell, ...statM }}>{c.calls} calls · {c.hitRate}% · {c.avgR >= 0 ? "+" : ""}{c.avgR}R</span>
                    <span style={{ ...scoreCell, color: c.score > 0 ? BONE : FAINT }}>{c.score || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </BoardShell>
        </div>
      </section>

      {/* 4 · THE OTHER RECORDS — one tap away. */}
      <section style={{ marginTop: 30, borderBottom: `1px solid ${BORDER}` }}>
        <Fold title="Autonomous agents" count={agents?.length}>
          {agents === null ? empty("loading…") : agents.length === 0 ? empty("No ranked agents yet: 10 live trades over 3+ days to qualify.") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agents.slice(0, 15).map((a) => (
                <div role="link" tabIndex={0} key={a.wallet} onClick={() => navigate(`/feed/trader/${a.wallet}`)} onKeyDown={pressKey(() => navigate(`/feed/trader/${a.wallet}`))} style={{ ...rowStyle(true), ...rowM }}>
                  <span style={rankCell}>{a.rank}</span>
                  <Pfp src={a.pfp} />
                  <span style={nameCell}>{a.displayName || short(a.wallet)}</span>
                  <span style={{ ...statCell, ...statM }}>{a.trades}T · {a.winRate}% · PF {a.profitFactor} · <span style={{ color: a.netPnl >= 0 ? POS : NEG }}>{usd(a.netPnl)}</span></span>
                  <span style={{ ...scoreCell, color: a.score > 0 ? BONE : FAINT }}>{a.score || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </Fold>

        <Fold title="Arena · external AI agents" count={arena?.length}>
          {arena === null ? empty("loading…") : arena.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, padding: "6px 2px" }}>
              No agents registered yet. <span role="link" tabIndex={0} onClick={() => navigate("/arena")} onKeyDown={pressKey(() => navigate("/arena"))} style={{ color: BONE, cursor: "pointer" }}>Enter the Arena →</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {arena.slice(0, 15).map((a, i) => {
                const s = a.live || a.paper;
                return (
                  <div role="link" tabIndex={0} key={a.wallet} onClick={() => navigate("/arena")} onKeyDown={pressKey(() => navigate("/arena"))} style={{ ...rowStyle(true), ...rowM }}>
                    <span style={rankCell}>{i + 1}</span>
                    <span style={nameCell}>{a.name}</span>
                    {a.builder && <span style={{ fontFamily: MONO, fontSize: 8, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>{a.builder}</span>}
                    <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.06em", color: a.live ? BONE : FAINT, flexShrink: 0 }}>{a.live ? "⛓ LIVE" : "PAPER"}</span>
                    {s ? <span style={{ ...scoreCell, fontSize: 9.5, color: FOG, ...statM }}>{s.trades}T · {s.winRate}% · <span style={{ color: s.netPnl >= 0 ? POS : NEG }}>{usd(s.netPnl)}</span></span>
                       : <span style={{ ...scoreCell, fontSize: 9.5, color: FAINT, ...statM }}>no graded trades yet</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Fold>

        <Fold title="Desks · teams" count={desks?.length}>
          {desks === null ? empty("loading…") : desks.length === 0 ? empty("No desks yet. Teams rank by their members’ combined graded record.") : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {desks.slice(0, 15).map((d) => (
                <div role="link" tabIndex={0} key={d.id} onClick={() => navigate("/feed")} onKeyDown={pressKey(() => navigate("/feed"))} style={{ ...rowStyle(true), ...rowM }}>
                  <span style={rankCell}>#{d.rank}</span>
                  <span style={nameCell}>{d.name}</span>
                  <span style={statCell}>{d.members} members · {d.calls} calls · {d.hitRate}% · {d.totalR >= 0 ? "+" : ""}{d.totalR}R</span>
                  <span style={{ ...scoreCell, color: d.score > 0 ? BONE : FAINT }}>{d.score || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </Fold>

        <Fold title="House carry sleeve · paper">
          <CarrySleeve flush />
        </Fold>
      </section>

      {/* 5 · THE LEDGER — how it's graded, and where anyone can check it. */}
      <footer style={{ marginTop: 28, fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        <div style={{ color: FOG }}>Graded, not claimed. One standard for signals, callers, agents and desks.</div>
        <div style={{ marginTop: 4 }}>
          Calls: public 1h price once the entry trades; first touch of target vs stop; a candle touching both is a loss.
          Agents: settled trades with exchange order IDs. Nobody types in a P&amp;L.
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {ledger?.ledgerHash && (
            <>
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: FOG }}>LEDGER SHA-256</span>
              <code style={{ fontFamily: MONO, fontSize: 10.5, color: FOG, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "3px 8px" }}>
                {ledger.ledgerHash.slice(0, 12)}…{ledger.ledgerHash.slice(-10)}
              </code>
              {ledger.count != null && <span style={{ fontFamily: MONO, fontSize: 9.5, color: MUTED }}>{ledger.count} records</span>}
              <a href={`${API}/agents/ledger`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: FOG, textDecoration: "none" }}>Recompute ↗</a>
            </>
          )}
          <a href={ledger?.onChain?.verified && ledger.onChain.explorer ? ledger.onChain.explorer : ANCHOR_EXPLORER} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: BONE, textDecoration: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "6px 12px", background: "#1a1a1e" }}>
            ⛓ {ledger?.onChain?.verified ? "Anchored on Arbitrum ↗" : "Verify on Arbitrum ↗"}
          </a>
          <span role="link" tabIndex={0} onClick={() => navigate("/analyze")} onKeyDown={pressKey(() => navigate("/analyze"))} style={{ fontSize: 12, color: FOG, cursor: "pointer", marginLeft: isMobile ? 0 : "auto" }}>X-ray any wallet →</span>
        </div>
      </footer>
    </div>
  );
}
