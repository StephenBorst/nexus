import { useEffect, useState } from "react";
import { C } from "@/config/theme";
import { SectionHeader } from "./components";

// ── Q Signals lens — Quotient's fair value vs the market ──────────────────────
// The forecasting DESK's read, paid + credit-metered — the sibling of Forecast
// Divergence (which reads the FREE Polymarket crowd and refuses to invent a
// probability). Quotient prices a model FAIR VALUE for a liquid prediction market
// and flags a convergence signal where that fair value diverges from the live venue
// price. We surface Q's number + Q's conviction honestly: a prompt to stake a GRADED
// thesis, never a fair-value oracle, never advice. The record still grades the call.
//
// Fail-soft by design: renders a calm one-liner when the key is unset, credits are
// dry, or the feed is sparse. Data comes from the KV-cached worker route, and this
// lens is collapsed-by-default + lazy-mounted, so it spends a credit only when opened.

const AGENT_API = "https://og.nexustradinglabs.com";
// Canonical design tokens (app/config/theme.ts) — same palette the Forecast lens draws
// from, so this corner matches the rest of the Lab. Green stays rationed to data.
const BONE = C.text.bright, FOG = C.text.fog, DIM = C.text.muted, FAINT = C.text.faint;
const POS = C.pos, ACCENT = C.accent;
const SURFACE = C.surface, SURFACE_ALT = C.surfaceAlt, INSET = C.inset, BORDER = C.border, BORDER_STRONG = C.borderStrong;
const MF = "var(--nx-font-mono)";

interface QSignal {
  id: string;
  question: string;
  venue: string | null;
  url: string | null;
  quotientUrl: string | null;
  side: string | null;
  qProbPct: number;
  marketProbPct: number;
  spreadPp: number;
  convictionTier: number | null;
  conviction: string;
  convergeUpsidePct: number | null;
  maxRoiPct: number | null;
  thesis: string | null;
  windowDays: number | null;
  endDate: string | null;
  volume24hUsd: number | null;
  capacityUsd: number | null;
  isFresh: boolean;
  isNewToday: boolean;
  status: string | null;
  adverseMovePct: number | null;
}
interface QBoard {
  configured?: boolean;
  ok?: boolean;
  reason?: string;
  scanned?: number;
  freshCount?: number;
  highConvictionCount?: number;
  signals?: QSignal[];
}

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

function SignalCard({ s }: { s: QSignal }) {
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
    </div>
  );
}

export function QSignals() {
  const [board, setBoard] = useState<QBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${AGENT_API}/intel/quotient`);
        const d = await r.json();
        if (!cancelled) setBoard(d && typeof d === "object" ? d : {});
      } catch { if (!cancelled) setBoard({}); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    // 5-min client poll; the worker route is KV-cached ~10 min, so this rarely spends a credit.
    const iv = setInterval(load, 300_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const signals = board?.signals ?? [];
  const configured = board?.configured !== false;
  const noCredits = board?.ok === false && board?.reason === "no_credits";

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHeader eyebrow="Quotient · fair value vs the market" title="Q Signals" note="PREDICTION MARKETS · CONVICTION-RANKED" />

      <div style={{ background: SURFACE_ALT, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "14px 16px" }}>
        {loading ? (
          <div style={{ color: FAINT, fontSize: 11, fontFamily: MF }}>Reading Quotient signals…</div>
        ) : !configured ? (
          <div style={{ color: DIM, fontSize: 11, fontFamily: MF, lineHeight: 1.6 }}>
            Quotient isn’t connected yet — set the API key and the forecasting desk’s fair-value signals stream in here.
          </div>
        ) : noCredits ? (
          <div style={{ color: DIM, fontSize: 11, fontFamily: MF, lineHeight: 1.6 }}>
            Quotient connected · <span style={{ color: FOG }}>credits empty</span>. Fund the balance to stream live signals.
          </div>
        ) : !signals.length ? (
          <div style={{ color: DIM, fontSize: 11, fontFamily: MF, lineHeight: 1.6 }}>
            No live Q signals right now — sparse by design (Quotient publishes only where its fair value clears the conviction gate).
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {signals.map((s) => <SignalCard key={s.id} s={s} />)}
            </div>
            <div style={{ marginTop: 12, color: FAINT, fontSize: 9, fontFamily: MF, lineHeight: 1.6 }}>
              Fair value + conviction from Quotient, priced against the live venue. A spread = Q’s model and the market disagree —
              a prompt to investigate and stake a graded call, not a fair-value oracle. Not advice.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default QSignals;
