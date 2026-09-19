import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletConnector } from "@orderly.network/hooks";
import { C } from "@/config/theme";
import { SectionHeader } from "./components";
import { useSubscription } from "@/hooks/useSubscription";
import { TIER_NAME, PRO_HOLDER_TIER, PRO_MONTHLY_USDC, nexusDiscountedPrice } from "@/config/subscription";
import { loadQuotientDirect, type Eip1193 } from "./qpay";
import { shapeQuotientSignals, type QSignal, type QBoard } from "./qshape";

// ── Q Signals lens — Quotient's fair value vs the market (PRO · you pay per pull) ──────
// The forecasting DESK's read: Quotient prices a model FAIR VALUE for a liquid prediction
// market and flags a convergence signal where that fair value diverges from the live venue.
// It's the paid sibling of Forecast Divergence (which reads the FREE Polymarket crowd and
// refuses to invent a probability). We surface Q's number + Q's conviction honestly — a prompt
// to stake a GRADED thesis, never a fair-value oracle, never advice. The record still grades it.
//
// Two gates, by design:
//   • ACCESS — Q Signals is a Nexus PRO lens (hold ARCHITECT $NEXUS, or subscribe). Non-PRO
//     wallets see a calm locked card, not the data.
//   • DATA COST — each pull is paid by the USER'S wallet via x402 (an off-chain, gasless USDC
//     authorization on Base, ~$0.01 to Quotient). Nexus spends nothing; there's no markup.
//
// NO auto-poll: nothing loads until the user clicks and signs. A short client cache (15 min)
// means re-opening the lens shows the last paid pull instead of charging again. Fail-soft
// throughout: a missing wallet, a declined payment, or a sparse feed renders a quiet line.

const CACHE_KEY = "nx_qsignals_cache";
const CACHE_TTL_MS = 15 * 60 * 1000; // re-opening within 15 min shows the last paid pull, no re-charge

// Canonical design tokens (app/config/theme.ts) — same palette the Forecast lens draws from.
// Green stays rationed to data (profit/up), bone is THE accent.
const BONE = C.text.bright, FOG = C.text.fog, DIM = C.text.muted, FAINT = C.text.faint;
const POS = C.pos, NEG = C.neg, ACCENT = C.accent, CANVAS = C.canvas;
const SURFACE = C.surface, SURFACE_ALT = C.surfaceAlt, INSET = C.inset, BORDER = C.border, BORDER_STRONG = C.borderStrong;
const MF = "var(--nx-font-mono)";

// QSignal / QBoard types + the shaper live in ./qshape (shared with the client-direct pull).

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}
function fmtEnds(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtClock(ts: number): string {
  try { return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
// Conviction tier → the ONE bit of chroma on a card: green only for "high" (data role),
// then quiet tones. If everything glows, nothing reads as the strong signal.
const tierColor = (tier: number | null) => (tier != null && tier >= 3 ? POS : tier === 2 ? FOG : FAINT);

// The convergence gap, drawn: a 0–100% track with the live market price and Q's fair
// value as ticks, the space between them shaded — the edge, read at a glance.
function ConvergenceBar({ qPct, mktPct }: { qPct: number; mktPct: number }) {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const lo = clamp(Math.min(qPct, mktPct)), hi = clamp(Math.max(qPct, mktPct));
  return (
    <div style={{ margin: "8px 0 6px" }}>
      <div style={{ position: "relative", height: 6, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 3 }}>
        {/* the gap = the edge Q is trading */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${lo}%`, width: `${hi - lo}%`, background: ACCENT, opacity: 0.14 }} />
        {/* live market price (secondary tone) */}
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `calc(${clamp(mktPct)}% - 1px)`, width: 2, background: FOG }} />
        {/* Q's fair value (brightest — the read) */}
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `calc(${clamp(qPct)}% - 1px)`, width: 2, background: BONE }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontFamily: MF, fontSize: 8.5, letterSpacing: "0.08em" }}>
        <span style={{ color: DIM }}>MARKET <b style={{ color: FOG }}>{Math.round(mktPct)}%</b></span>
        <span style={{ color: DIM }}>Q FAIR <b style={{ color: BONE }}>{Math.round(qPct)}%</b></span>
      </div>
    </div>
  );
}

function SignalCard({ s, onTrade, onStake }: { s: QSignal; onTrade: (x: QSignal) => void; onStake: (x: QSignal) => void }) {
  const tc = tierColor(s.convictionTier);
  const link = s.quotientUrl || s.url;
  return (
    <div style={{ border: `1px solid ${BORDER}`, background: SURFACE, borderRadius: 2, padding: "11px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: BONE, fontFamily: MF, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "1px 7px" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: tc, display: "inline-block" }} />
          Q · {s.conviction.toUpperCase()}
        </span>
        {s.side ? <span style={{ color: BONE, fontFamily: MF, fontSize: 11, fontWeight: 700 }}>{s.side}</span> : null}
        {s.venue ? <span style={{ color: FAINT, fontFamily: MF, fontSize: 9, letterSpacing: "0.06em" }}>{s.venue}</span> : null}
        {s.isNewToday ? <span style={{ color: POS, fontFamily: MF, fontSize: 8.5, letterSpacing: "0.1em" }}>NEW</span> : null}
        {s.endDate ? <span style={{ color: FAINT, fontSize: 9.5, fontFamily: MF, marginLeft: "auto" }}>ends {fmtEnds(s.endDate)}</span> : null}
      </div>
      <div style={{ color: FOG, fontSize: 12, lineHeight: 1.45 }}>{s.question}</div>
      <ConvergenceBar qPct={s.qProbPct} mktPct={s.marketProbPct} />
      {s.thesis ? <div style={{ color: DIM, fontSize: 11, lineHeight: 1.5, margin: "6px 0 8px", fontStyle: "italic" }}>{s.thesis}</div> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontFamily: MF, fontSize: 10 }}>
        <span style={{ color: DIM }}>spread <b style={{ color: BONE }}>{s.spreadPp}pp</b></span>
        {s.convergeUpsidePct != null ? <span style={{ color: DIM }}>upside <b style={{ color: POS }}>{s.convergeUpsidePct}%</b></span> : null}
        {s.windowDays != null ? <span style={{ color: FAINT }}>{s.windowDays}d window</span> : null}
        {s.capacityUsd != null ? <span style={{ color: FAINT }}>{fmtUsd(s.capacityUsd)} cap</span> : null}
        {link ? (
          <a href={link} target="_blank" rel="noreferrer noopener" className="nx-press"
            style={{ marginLeft: "auto", color: BONE, textDecoration: "none", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "3px 10px", fontFamily: MF, fontSize: 10 }}
          >open ↗</a>
        ) : null}
      </div>
      {s.perp ? (
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: BONE, fontFamily: MF, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
            <span style={{ color: FAINT }}>◆</span>{s.perp.coin}
            <b style={{ color: s.perp.direction === "LONG" ? POS : NEG }}>{s.perp.direction}</b>
          </span>
          <span style={{ color: FAINT, fontFamily: MF, fontSize: 8.5, letterSpacing: "0.08em" }}>Q READ → PERP</span>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button onClick={() => onTrade(s)} className="nx-press"
              style={{ background: ACCENT, color: CANVAS, border: `1px solid ${ACCENT}`, borderRadius: 2, padding: "3px 11px", fontFamily: MF, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
            >⚡ Trade</button>
            <button onClick={() => onStake(s)} className="nx-press"
              style={{ background: "transparent", color: BONE, border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "3px 11px", fontFamily: MF, fontSize: 10, cursor: "pointer" }}
            >◆ Stake thesis</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Small pill button in the Lab register — bone border, mono, press feedback.
function LoadButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="nx-press"
      style={{
        background: disabled ? INSET : ACCENT, color: disabled ? FAINT : CANVAS,
        border: `1px solid ${disabled ? BORDER : ACCENT}`, borderRadius: 2, padding: "7px 16px",
        fontFamily: MF, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
        cursor: disabled ? "default" : "pointer",
      }}
    >{label}</button>
  );
}

interface Cached { board: QBoard; usd: number; ts: number; }
function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!c || typeof c.ts !== "number" || Date.now() - c.ts > CACHE_TTL_MS) return null;
    return c;
  } catch { return null; }
}
function writeCache(c: Cached) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* private mode */ } }

export function QSignals({ address }: { address?: string | null }) {
  const { isPro, via, isLoading: subLoading } = useSubscription(address);

  // EIP-1193 provider from the Orderly wallet connector (same source swapExec uses to sign).
  type WCWallet = { provider?: Record<string, unknown> };
  const wcCtx = useWalletConnector() as unknown as { wallet?: WCWallet | null };
  const provider = (wcCtx?.wallet?.provider as unknown as Eip1193 | undefined) || undefined;
  const navigate = useNavigate();

  const [board, setBoard] = useState<QBoard | null>(null);
  const [paidUsd, setPaidUsd] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading">("idle");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [perpOnly, setPerpOnly] = useState(true); // perp focus by default — the tradeable slice

  // Hydrate the last paid pull (≤15 min old) so re-opening the lens doesn't re-charge.
  useEffect(() => {
    if (!isPro) return;
    const c = readCache();
    if (c) { setBoard(c.board); setPaidUsd(c.usd); setLoadedAt(c.ts); }
  }, [isPro]);

  const load = async () => {
    if (phase === "loading") return;
    if (!provider) { setErr("Connect a wallet to load Q signals."); return; }
    setPhase("loading"); setErr(null);
    setStatus("sign the ~$0.01 USDC payment on Base in your wallet…");
    try {
      // The BROWSER pays Quotient directly (residential IP) — Quotient 403s our worker's IP,
      // so this can never go through the server. Then shape client-side (qshape).
      const { signals: raw, usd } = await loadQuotientDirect(provider, 1);
      const board = shapeQuotientSignals(raw);
      setBoard(board); setPaidUsd(usd); setLoadedAt(Date.now());
      writeCache({ board, usd, ts: Date.now() });
    } catch (e) {
      setErr((e as Error)?.message || "Couldn't load signals.");
    } finally {
      setPhase("idle"); setStatus("");
    }
  };

  // Q read → perp actions (only on the crypto price-target slice that maps to a listed perp).
  const goTrade = (s: QSignal) => { if (s.perp) navigate(`/perp/${s.perp.perpSymbol}`); };
  const stakeThesis = (s: QSignal) => {
    if (!s.perp) return;
    const draft = {
      symbol: s.perp.coin,
      direction: s.perp.direction,
      catalyst: `Quotient fair value ${s.qProbPct}% vs venue ${s.marketProbPct}% (${s.spreadPp}pp edge)`,
      targetWindow: s.windowDays ? `${s.windowDays}d` : "7d",
      notes: `Quotient's model prices "${s.question}" at ${s.qProbPct}% vs the venue's ${s.marketProbPct}% — a ${s.spreadPp}pp gap.${s.thesis ? ` ${s.thesis}` : ""} Trading the convergence as a directional ${s.perp.coin} view (${s.perp.direction})${s.perp.targetUsd ? `, price ~$${s.perp.targetUsd.toLocaleString()}` : ""}. Q's read — your call: add entry/stop/targets. Graded from public price.`,
    };
    try { localStorage.setItem("nexus_thesis_draft", JSON.stringify(draft)); } catch { /* private mode */ }
    try {
      window.dispatchEvent(new CustomEvent("nexus:lab-tab", { detail: { tab: "thesis" } }));
      window.dispatchEvent(new CustomEvent("nexus:thesis-draft"));
    } catch { /* non-browser */ }
  };

  const signals = board?.signals ?? [];
  const perpSignals = signals.filter((s) => s.perp);
  const shown = perpOnly && perpSignals.length ? perpSignals : signals;
  const loading = phase === "loading";

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHeader eyebrow="Quotient · fair value vs the market" title="Q Signals" note={`${TIER_NAME} · PREDICTION MARKETS · YOU PAY PER PULL`} />

      <div style={{ background: SURFACE_ALT, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "14px 16px" }}>
        {subLoading ? (
          <div style={{ color: FAINT, fontSize: 11, fontFamily: MF }}>Checking access…</div>
        ) : !isPro ? (
          /* ── LOCKED — Q Signals is a PRO lens ── */
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ color: BONE, fontFamily: MF, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "2px 8px" }}>◆ {TIER_NAME}</span>
              <span style={{ color: FOG, fontSize: 12 }}>Q Signals is a {TIER_NAME} lens.</span>
            </div>
            <div style={{ color: DIM, fontSize: 11.5, lineHeight: 1.65 }}>
              Quotient's model fair value vs the live market on liquid prediction markets — a prompt to stake a graded
              thesis, priced against the venue. Each pull is paid by your wallet (~$0.01 USDC on Base); Nexus takes no cut.
            </div>
            <div style={{ marginTop: 10, color: FAINT, fontSize: 10.5, fontFamily: MF, lineHeight: 1.7 }}>
              Unlock with {TIER_NAME}: hold <span style={{ color: FOG }}>{PRO_HOLDER_TIER}</span> in $NEXUS,
              or subscribe (<span style={{ color: FOG }}>${PRO_MONTHLY_USDC}/mo</span>, or ${nexusDiscountedPrice()} in $NEXUS).
            </div>
          </div>
        ) : board ? (
          /* ── LOADED (paid) — the signals, or a calm empty note; + a paid-refresh control ── */
          <>
            {signals.length ? (
              <>
                {perpSignals.length && signals.length > perpSignals.length ? (
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {([[true, `PERPS · ${perpSignals.length}`], [false, `ALL · ${signals.length}`]] as const).map(([po, lbl]) => (
                      <button key={String(po)} onClick={() => setPerpOnly(po)} className="nx-press"
                        style={{ background: perpOnly === po ? ACCENT : INSET, color: perpOnly === po ? CANVAS : DIM, border: `1px solid ${perpOnly === po ? ACCENT : BORDER}`, borderRadius: 2, padding: "3px 11px", fontFamily: MF, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer" }}
                      >{lbl}</button>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {shown.map((s) => <SignalCard key={s.id} s={s} onTrade={goTrade} onStake={stakeThesis} />)}
                </div>
              </>
            ) : (
              <div style={{ color: DIM, fontSize: 11.5, fontFamily: MF, lineHeight: 1.65 }}>
                No Q signal cleared the conviction bar right now — sparse by design (Quotient publishes only where its fair value diverges enough from the venue). Your pull went through; check back later.
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <LoadButton label={loading ? "loading…" : "refresh · $0.01"} onClick={load} disabled={loading} />
              {loadedAt ? <span style={{ color: FAINT, fontSize: 9.5, fontFamily: MF }}>loaded {fmtClock(loadedAt)}{paidUsd != null ? ` · paid $${paidUsd.toFixed(2)}` : ""}</span> : null}
              {loading && status ? <span style={{ color: DIM, fontSize: 9.5, fontFamily: MF }}>{status}</span> : null}
            </div>
            {err ? <div style={{ marginTop: 8, color: C.neg, fontSize: 10.5, fontFamily: MF }}>{err}</div> : null}
            <div style={{ marginTop: 12, color: FAINT, fontSize: 9, fontFamily: MF, lineHeight: 1.6 }}>
              Fair value + conviction from Quotient, priced against the live venue. A spread = Q's model and the market disagree —
              a prompt to investigate and stake a graded call, not a fair-value oracle. Not advice.
            </div>
          </>
        ) : loading ? (
          <div style={{ color: FOG, fontSize: 11, fontFamily: MF, lineHeight: 1.7 }}>
            {status || "Loading Q signals…"}
          </div>
        ) : (
          /* ── PRO, nothing loaded yet — explicit pay-to-load (no auto-poll) ── */
          <div>
            <div style={{ color: DIM, fontSize: 11.5, lineHeight: 1.65, marginBottom: 12 }}>
              Load Quotient's live fair-value signals. Your wallet pays Quotient <b style={{ color: FOG }}>~$0.01 USDC on Base</b> per
              pull (an off-chain, gasless authorization — no Nexus markup, nothing stored). Nothing loads until you sign; there's no auto-refresh.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <LoadButton label={loading ? "loading…" : "Load signals · $0.01"} onClick={load} disabled={loading || !provider} />
              {!provider ? <span style={{ color: FAINT, fontSize: 9.5, fontFamily: MF }}>connect a wallet to pay</span> : null}
              {via === "holder" ? <span style={{ color: FAINT, fontSize: 9.5, fontFamily: MF }}>{TIER_NAME} via $NEXUS holdings</span> : null}
            </div>
            {err ? <div style={{ marginTop: 8, color: C.neg, fontSize: 10.5, fontFamily: MF }}>{err}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default QSignals;
