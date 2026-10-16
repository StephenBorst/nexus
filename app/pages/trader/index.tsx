/**
 * /trader/:wallet — Public Trader Profile
 *
 * Phase 8: Full stats breakdown for a single trader.
 * Accessible from the feed leaderboard or via shareable URL.
 */

import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "@orderly.network/hooks";
import { useLivePrices, calcUnrealizedPnl, distancePct } from "@/hooks/useLivePrices";
import { showsLivePnl } from "@/lib/callLifecycle.mjs";
import { callRR, runnerRR, fmtRR, liveMove, fmtLiveMove } from "@/lib/callMath.mjs";
import { AwaitingFill, awaitingLabel } from "@/components/AwaitingFill";
import { useLabWallet, appendToLab } from "@/hooks/useLabAuth";
import { NexusTierBadge } from "@/components/NexusTierBadge";
import { MessageTraderButton } from "@/components/MessageTraderButton";
import type { ThesisTrade } from "@/pages/lab/types";
import { SocialBar } from "@/components/SocialBar";
import { deployToAgent } from "@/utils/agentPrefill";
import { deriveStyle } from "@/config/agentStyles";
import { PublicOperatorProfile, InFlightCalls, VenueEvidence } from "./ProfileSynthesis";
import { TrackedRecordCard } from "@/components/TrackedRecordCard";
import { bareTicker } from "@/utils/utils";
import { SIGNAL } from "@/config/theme";
import { TEXT_ACTION, TEXT_ACTION_BAR, TEXT_ACTION_CLASS } from "@/components/ui";
import { pressKey } from "@/utils/a11y";
import { useEscapeKey } from "@/utils/a11y";
import type { SavedStrategy } from "@/pages/lab/agentTypes";

const API_BASE = "https://og.nexustradinglabs.com";

type FeedThesis = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;
  positionSize: number;
  leverage: number;
  status: "ACTIVE" | "HIT_TP" | "STOPPED_OUT" | "INVALIDATED" | "CLOSED";
  gradedOutcome?: "WIN" | "LOSS"; // trustless price-grade (cron-stamped); absent = not yet graded
  gradedR?: number;                // the R the grader paid (present once resolved)
  fillState?: "WORKING" | "OPEN";  // server: has the entry traded yet (grading.mjs applyFillStamp)
  filledAt?: number;
  publishMark?: { px: number; at: number };
  actualPnl: number | null;
  createdAt: number;
  notes: string;
  wallet: string;
  pfp: string | null;
  displayName: string | null;
  fundingCost72h?: number;
  riskPercent?: number;
  accountSize?: number;
  copyCount?: number;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ACTIVE:      { label: "ACTIVE",      color: "#d4d4d8", bg: "#1a1a1e", border: "#33333a" },
  HIT_TP:      { label: "HIT TP",      color: "#ededf0", bg: "#1a1a1e", border: "#33333a" },
  STOPPED_OUT: { label: "STOPPED OUT", color: "#f7525f", bg: "#241012", border: "#4a1e22" },
  INVALIDATED: { label: "INVALIDATED", color: "#fbbf24", bg: "#2a1a00", border: "#4a3a00" },
  CLOSED:      { label: "CLOSED",      color: "#a1a1aa", bg: "#1a1a1e", border: "#33333a" },
  PENDING:     { label: "PENDING",     color: "#a1a1aa", bg: "#141416", border: "#33333a" },
};

// Neutral fallback for any unrecognized / future status value so the row never crashes.
const STATUS_FALLBACK = { label: "UNKNOWN", color: "#a1a1aa", bg: "#141416", border: "#33333a" };

// ─── Avatar ──────────────────────────────────────────────────────────────────
function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M16 12h4" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
      <path d="M6 2h8a2 2 0 0 1 2 2v2H4V4a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function Avatar({ pfp, displayName, size = 48 }: { pfp: string | null; displayName: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid #232327", background: "#141416",
      overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
      color: "#52525b", flexShrink: 0,
    }}>
      {pfp && !err ? (
        <img src={pfp} alt={displayName ?? ""} onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <WalletIcon />
      )}
    </div>
  );
}

// ─── Stat Box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "#141416",
      border: "1px solid #232327",
      borderRadius: 4,
      padding: "12px 16px",
      textAlign: "center",
    }}>
      <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 8, color: "#52525b", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 17, fontWeight: "bold", color: color ?? "#a1a1aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Thesis Row ───────────────────────────────────────────────────────────────
function ThesisRow({
  thesis,
  markPrice,
  onCopy,
  isOwn,
  walletAddress,
}: {
  thesis: FeedThesis;
  markPrice?: number | null;
  onCopy?: (t: FeedThesis) => void;
  isOwn: boolean;
  walletAddress: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[thesis.status] ?? STATUS_FALLBACK;
  const ticker = bareTicker(thesis.symbol);
  const timeAgo = (() => {
    const diff = Date.now() - thesis.createdAt;
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    return "just now";
  })();

  // P&L only once the entry has traded; a resting order shows the order instead (AwaitingFill).
  const pendingLabel = awaitingLabel(thesis)?.split(" · ")[0] ?? null; // the price is in the block below
  // Public calls carry no position size, so the badge reads the move in R and % (a dollar
  // figure would always be $0.00). A sized call (the owner's own view) keeps its dollars.
  const pnlData = showsLivePnl(thesis) && markPrice != null
    ? calcUnrealizedPnl(thesis.direction, thesis.entryPrice, markPrice, thesis.positionSize)
    : null;
  const move = showsLivePnl(thesis) && markPrice != null ? liveMove(thesis, markPrice) : null;
  const isGraded = (thesis.gradedOutcome === "WIN" || thesis.gradedOutcome === "LOSS") && Number.isFinite(thesis.gradedR);

  return (
    <div style={{
      background: "#141416",
      border: `1px solid ${cfg.border}`,
      borderRadius: 4,
      overflow: "hidden",
      opacity: thesis.status === "INVALIDATED" ? 0.65 : 1,
    }}>
      {/* Main row: identity + result on one line, the levels in a grid under it, so every card has the
          same shape on a phone and on desktop (it used to stack the levels into one tall column). */}
      <div role="button" tabIndex={0}
        onClick={() => setExpanded(!expanded)} onKeyDown={pressKey(() => setExpanded(!expanded))}
        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 6 }}>
          {/* Ticker + side. The side is a label, not money: monochrome (docs/brand.md). */}
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 15, fontWeight: "bold", color: "#f4f4f5" }}>{ticker}</span>
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, letterSpacing: "0.04em", color: "#a1a1aa" }}>
            {thesis.direction === "LONG" ? "↑" : "↓"} {thesis.direction}
          </span>
          {(thesis.copyCount ?? 0) > 0 && (
            <span title={`Copied ${thesis.copyCount} time${thesis.copyCount === 1 ? "" : "s"}`} style={{
              fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#a1a1aa",
              background: "#1a1a1e", border: "1px solid #232327", borderRadius: 3, padding: "1px 5px",
            }}>
              ⧉ {thesis.copyCount}
            </span>
          )}
          <div style={{ flex: 1 }} />

          {/* Result: the graded R once resolved; the live move while open; never a typed-in dollar figure
              (public calls carry no size, so it read "+$0.00"). A sized call (owner's view) keeps its dollars. */}
          {isGraded ? (
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 12, fontWeight: 700, color: (thesis.gradedR as number) >= 0 ? "#3ecf8e" : "#f7525f" }}>
              {(thesis.gradedR as number) >= 0 ? "+" : "−"}{Math.abs(thesis.gradedR as number).toFixed(2)}R
            </span>
          ) : pnlData && thesis.positionSize > 0 ? (
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, fontWeight: "bold", color: pnlData.pnl >= 0 ? "#3ecf8e" : "#f7525f" }}>
              {pnlData.pnl >= 0 ? "+" : ""}${pnlData.pnl.toFixed(2)}
              <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 3 }}>({pnlData.pct >= 0 ? "+" : ""}{pnlData.pct.toFixed(2)}%)</span>
            </span>
          ) : move ? (
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, fontWeight: "bold", color: move.pct >= 0 ? "#3ecf8e" : "#f7525f" }}>
              {fmtLiveMove(move)}
            </span>
          ) : null}

          <span style={{
            fontFamily: "var(--nx-font-mono)", fontSize: 8, letterSpacing: "0.08em",
            padding: "2px 7px", borderRadius: 3,
            background: cfg.bg, border: `1px ${pendingLabel ? "dashed" : "solid"} ${cfg.border}`, color: pendingLabel ? "#a1a1aa" : cfg.color,
          }}>{pendingLabel ? pendingLabel.toUpperCase() : cfg.label}</span>
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", whiteSpace: "nowrap" }}>{timeAgo}</span>

          {walletAddress && !isOwn && onCopy && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(thesis); }}
              className="nx-text-action"
              style={{ background: "none", border: "none", color: "#a1a1aa", fontFamily: "var(--nx-font-ui)", fontSize: 12, fontWeight: 600, padding: "4px 2px", cursor: "pointer" }}
            >Copy</button>
          )}
          <span aria-hidden style={{ color: "#52525b", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
        </div>

        {/* Levels — monochrome: a stop or a target is a level, not money. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: "6px 12px" }}>
          {[
            { label: "ENTRY", val: `$${thesis.entryPrice.toFixed(2)}`, color: "#a1a1aa" },
            { label: "STOP",  val: `$${thesis.stopLoss.toFixed(2)}`,   color: "#a1a1aa" },
            { label: "TP1",   val: `$${thesis.takeProfit1.toFixed(2)}`, color: "#ededf0" },
            { label: "R:R",   val: fmtRR(callRR(thesis)), color: "#ededf0" },
            ...(runnerRR(thesis) != null ? [{ label: "RUNNER", val: fmtRR(runnerRR(thesis)), color: "#a1a1aa" }] : []),
            ...(thesis.positionSize > 0 ? [{ label: "SIZE", val: `$${thesis.positionSize.toFixed(0)}`, color: "#a1a1aa" }] : []),
          ].map(({ label, val, color }) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, letterSpacing: "0.06em", color: "#71717a", fontFamily: "var(--nx-font-mono)" }}>{label}</div>
              <div style={{ fontSize: 12, color, fontFamily: "var(--nx-font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Expanded: full details + notes + live grid */}
      {expanded && (
        <div style={{ borderTop: "1px solid #232327", padding: "12px 16px" }}>
          <AwaitingFill thesis={thesis} markPrice={markPrice} style={{ marginBottom: 12 }} />
          {/* Live price grid — only once the entry has traded */}
          {showsLivePnl(thesis) && markPrice != null && (() => {
            const { pnl, pct } = calcUnrealizedPnl(thesis.direction, thesis.entryPrice, markPrice, thesis.positionSize);
            const toSL = distancePct(markPrice, thesis.stopLoss);
            const toTP = distancePct(markPrice, thesis.takeProfit1);
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: "8px 12px", marginBottom: 12, padding: 10, background: "#0f0f11", borderRadius: 4, border: "1px solid #232327" }}>
                {[
                  { label: "MARK", val: `$${markPrice.toFixed(markPrice < 10 ? 4 : 2)}`, color: "#fff" },
                  thesis.positionSize > 0
                    ? { label: "UNREALIZED", val: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`, color: pnl >= 0 ? "#3ecf8e" : "#f7525f" }
                    : { label: "MOVE", val: fmtLiveMove(liveMove(thesis, markPrice)), color: pct >= 0 ? "#3ecf8e" : "#f7525f" },
                  { label: "TO SL", val: `${toSL.toFixed(2)}%`, color: "#f7525f" },
                  { label: "TO TP1", val: `${toTP.toFixed(2)}%`, color: "#ededf0" },
                ].map(({ label, val, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 7, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>{label}</div>
                    <div style={{ fontSize: 11, color, fontFamily: "var(--nx-font-mono)", fontWeight: "bold" }}>{val}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Notes */}
          {thesis.notes && (
            <div style={{
              fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa",
              lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {thesis.notes}
            </div>
          )}
        </div>
      )}
      {/* Same native social layer as the feed — one-tap like, inline comments. */}
      <div role="presentation" style={{ padding: "0 12px" }} onClick={(e) => e.stopPropagation()}>
        <SocialBar
          thesisId={thesis.id}
          walletAddress={walletAddress}
          symbol={thesis.symbol}
          direction={thesis.direction}
          autoload
        />
      </div>
    </div>
  );
}

const COPY_PREFS_KEY = "nexus-copy-prefs";

// ─── Copy Modal (inline, same logic as feed) ──────────────────────────────────
function CopyModal({ thesis, walletAddress, onClose }: { thesis: FeedThesis; walletAddress: string; onClose: () => void }) {
  const ticker = bareTicker(thesis.symbol);
  const traderName = thesis.displayName ?? `${thesis.wallet.slice(0, 6)}…${thesis.wallet.slice(-4)}`;
  useEscapeKey(onClose);

  const [accountSize, setAccountSize] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COPY_PREFS_KEY) ?? "{}").accountSize ?? ""; }
    catch { return ""; }
  });
  const [riskPct, setRiskPct] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COPY_PREFS_KEY) ?? "{}").riskPct ?? "1.5"; }
    catch { return "1.5"; }
  });
  const [fundingRate, setFundingRate] = useState("0.01");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const labWallet = useLabWallet();

  // Persist prefs on change
  useEffect(() => {
    try { localStorage.setItem(COPY_PREFS_KEY, JSON.stringify({ accountSize, riskPct })); }
    catch { /* ignore */ }
  }, [accountSize, riskPct]);

  const accNum = parseFloat(accountSize);
  const riskNum = parseFloat(riskPct);
  const accErr = accountSize !== "" && (isNaN(accNum) || accNum <= 0) ? "must be > 0" : "";
  const riskErr = riskPct !== "" && (isNaN(riskNum) || riskNum < 0.1 || riskNum > 100) ? "must be 0.1–100" : "";
  const hasValidationErr = !!accErr || !!riskErr;

  const calc = useMemo(() => {
    if (hasValidationErr) return null;
    const acc = parseFloat(accountSize);
    const risk = parseFloat(riskPct);
    const fund = parseFloat(fundingRate);
    if (!acc || !risk || !thesis.entryPrice || !thesis.stopLoss || !thesis.takeProfit1) return null;
    const stopDist = Math.abs(thesis.entryPrice - thesis.stopLoss) / thesis.entryPrice;
    const rewardDist = Math.abs(thesis.takeProfit1 - thesis.entryPrice) / thesis.entryPrice;
    if (stopDist === 0) return null;
    const riskAmount = acc * (risk / 100);
    const positionSize = Math.min(riskAmount / stopDist, acc * 100);
    const leverage = positionSize / acc;
    const riskReward = rewardDist / stopDist;
    const fundingPerPeriod = positionSize * (Math.abs(fund) / 100);
    return { positionSize, leverage, riskReward, riskAmount, fundingPerPeriod };
  }, [accountSize, riskPct, fundingRate, thesis, hasValidationErr]);

  const inputStyle: React.CSSProperties = {
    background: "#0f0f11", border: "1px solid #232327", borderRadius: 3,
    color: "#ededf0", fontFamily: "var(--nx-font-mono)", fontSize: 11,
    padding: "6px 8px", outline: "none", width: "100%", boxSizing: "border-box",
  };

  async function handleSave() {
    if (!calc || hasValidationErr) { setErr("check inputs"); return; }
    setSaving(true); setErr("");
    try {
      const newThesis: ThesisTrade = {
        id: `copy_${Date.now()}`, symbol: thesis.symbol, direction: thesis.direction,
        entryPrice: thesis.entryPrice, stopLoss: thesis.stopLoss,
        takeProfit1: thesis.takeProfit1, takeProfit2: thesis.takeProfit2,
        riskPercent: parseFloat(riskPct), accountSize: parseFloat(accountSize),
        fundingRate: parseFloat(fundingRate), positionSize: calc.positionSize,
        leverage: calc.leverage, riskReward: calc.riskReward,
        fundingCost8h: calc.fundingPerPeriod, fundingCost24h: calc.fundingPerPeriod * 3,
        fundingCost72h: calc.fundingPerPeriod * 9,
        notes: `Copied from ${traderName}${thesis.notes ? `\n\n${thesis.notes}` : ""}`,
        createdAt: Date.now(), status: "ACTIVE", actualPnl: null, isPublic: false,
        copiedFromWallet: thesis.wallet,
      };
      // Signed by this wallet, appended to its FULL record (nothing is written if that can't be read).
      const r = await appendToLab(walletAddress, labWallet, newThesis, {
        copiedFromWallet: thesis.wallet,
        copiedThesisSymbol: thesis.symbol,
        copiedThesisDirection: thesis.direction,
        copiedThesisId: thesis.id,
      });
      if (!r.ok) { setErr(r.error); return; }
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch { setErr("failed to save. Check connection"); }
    finally { setSaving(false); }
  }

  return (
    <div role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{ background: "#141416", border: "1px solid #232327", borderRadius: 6, padding: 20, width: "100%", maxWidth: 400, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 15, fontWeight: "bold", color: "#fff" }}>
              {ticker} <span style={{ fontSize: 11, color: thesis.direction === "LONG" ? "#3ecf8e" : "#f7525f" }}>{thesis.direction}</span>
            </div>
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", marginTop: 2 }}>copying from {traderName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {/* Inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 8, color: "#52525b", fontFamily: "var(--nx-font-mono)", marginBottom: 4 }}>ACCOUNT SIZE ($)</div>
            <input style={{ ...inputStyle, borderColor: accErr ? "#4a1e22" : "#232327" }} type="number" placeholder="10000" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} />
            {accErr && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 8, color: "#f7525f", marginTop: 3 }}>{accErr}</div>}
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#52525b", fontFamily: "var(--nx-font-mono)", marginBottom: 4 }}>RISK %</div>
            <input style={{ ...inputStyle, borderColor: riskErr ? "#4a1e22" : "#232327" }} type="number" placeholder="1.5" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
            {riskErr && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 8, color: "#f7525f", marginTop: 3 }}>{riskErr}</div>}
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#52525b", fontFamily: "var(--nx-font-mono)", marginBottom: 4 }}>FUNDING %</div>
            <input style={inputStyle} type="number" placeholder="0.01" step="0.001" value={fundingRate} onChange={(e) => setFundingRate(e.target.value)} />
          </div>
        </div>

        {/* Calc output */}
        <div style={{ marginTop: 10, marginBottom: 12 }}>
          {calc ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: "8px 10px", padding: 10, background: "#1a1a1e", borderRadius: 4, border: "1px solid #232327" }}>
              <div>
                <div style={{ fontSize: 7, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>YOUR SIZE</div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 13, color: "#ededf0", fontWeight: "bold" }}>${calc.positionSize.toFixed(0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>LEVERAGE</div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 13, fontWeight: "bold", color: calc.leverage > 25 ? "#f7525f" : calc.leverage > 10 ? "#fbbf24" : "#3ecf8e" }}>{calc.leverage.toFixed(1)}x</div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>R:R</div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 13, fontWeight: "bold", color: calc.riskReward >= 2 ? "#ededf0" : "#fbbf24" }}>1:{calc.riskReward.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>MAX LOSS</div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 13, color: "#f7525f", fontWeight: "bold" }}>${calc.riskAmount.toFixed(2)}</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: 10, background: "#0f0f11", borderRadius: 4, border: "1px solid #232327", fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", textAlign: "center" }}>
              enter account size + risk % to calculate
            </div>
          )}
        </div>

        {err && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#f7525f", marginBottom: 10 }}>{err}</div>}
        <button
          onClick={handleSave}
          disabled={saving || saved || !calc || hasValidationErr}
          style={{
            width: "100%", background: saved ? "#1a1a1e" : calc && !hasValidationErr ? "#1a1a1e" : "#0f0f11",
            border: `1px solid ${saved ? "#ededf0" : calc && !hasValidationErr ? "#ededf0" : "#232327"}`,
            color: saved ? "#ededf0" : calc && !hasValidationErr ? "#ededf0" : "#33333a",
            fontFamily: "var(--nx-font-ui)", fontSize: 12.5,
            padding: "10px 0", borderRadius: 4, cursor: calc && !saving && !saved && !hasValidationErr ? "pointer" : "default",
          }}
        >
          {saved ? "✓ Saved to Lab" : saving ? "saving..." : "Save to Lab →"}
        </button>
      </div>
    </div>
  );
}

// ─── Trader Page ──────────────────────────────────────────────────────────────
export default function TraderPage() {
  const { wallet } = useParams<{ wallet: string }>();
  const navigate = useNavigate();
  const [theses, setTheses] = useState<FeedThesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copyTarget, setCopyTarget] = useState<FeedThesis | null>(null);
  const [copied, setCopied] = useState(false);
  // Merit rank from the grader (/theses/process): earned from graded calls only. It replaced a
  // "REP" score built from planned R:R and the on-chain Rep Score, which counts outcomes callers
  // close themselves; Feed RANKS stopped ranking on either, so the profile doesn't show them.
  const [merit, setMerit] = useState<{ glyph: string; title: string } | null>(null);
  const [agentRec, setAgentRec] = useState<{ netPnl: number; winRate: number; trades: number; score: number } | null>(null);
  const [pubStrats, setPubStrats] = useState<SavedStrategy[]>([]);

  const { state: accountState } = useAccount();
  const walletAddress = (accountState as { address?: string })?.address ?? null;
  const isOwn = walletAddress?.toLowerCase() === wallet?.toLowerCase();

  // Follow graph — follow this caller so their next open pings you (LiveAlerts is follow-aware).
  // Same server-side graph the Feed uses (/follows/:you); we hold the whole set and PUT it back so
  // a toggle here never clobbers follows made elsewhere.
  const [followSet, setFollowSet] = useState<Set<string>>(new Set());
  const [followBusy, setFollowBusy] = useState(false);
  const isFollowing = !!wallet && followSet.has(wallet.toLowerCase());
  useEffect(() => {
    if (!walletAddress) { setFollowSet(new Set()); return; }
    let alive = true;
    fetch(`${API_BASE}/follows/${walletAddress}`).then((r) => r.json())
      .then((d: { following?: string[] }) => { if (alive) setFollowSet(new Set((d.following ?? []).map((w: string) => w.toLowerCase()))); })
      .catch(() => { /* fail-soft */ });
    return () => { alive = false; };
  }, [walletAddress]);
  async function toggleFollow() {
    if (!walletAddress || !wallet || isOwn || followBusy) return;
    const lw = wallet.toLowerCase();
    const next = new Set(followSet);
    if (next.has(lw)) next.delete(lw); else next.add(lw);
    setFollowSet(next); // optimistic
    setFollowBusy(true);
    try {
      await fetch(`${API_BASE}/follows/${walletAddress}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ following: [...next] }),
      });
    } catch { /* keep optimistic; a reload re-syncs from the server */ } finally { setFollowBusy(false); }
  }

  // Fetch all public theses, filter to this wallet
  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    setError(false);
    setMerit(null);
    fetch(`${API_BASE}/feed`)
      .then((r) => r.json())
      .then((data: { feed: FeedThesis[] }) => {
        // Agent-feed entries can arrive without the full human-thesis numeric fields.
        // The FeedThesis type says these are numbers, so anything downstream calls
        // .toFixed() on them — coerce to safe numbers on load so one malformed entry
        // can't crash the whole profile (was: "Cannot read properties of undefined").
        const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const all = (data.feed ?? []).map((t) => ({
          ...t,
          entryPrice: num(t.entryPrice), stopLoss: num(t.stopLoss),
          takeProfit1: num(t.takeProfit1), takeProfit2: num(t.takeProfit2),
          riskReward: num(t.riskReward), positionSize: num(t.positionSize),
          leverage: num(t.leverage),
          actualPnl: t.actualPnl == null ? null : num(t.actualPnl),
        }));
        // /feed also carries RESOLUTION rows ("BTC SHORT stopped out, −1R"): announcements with no
        // levels. They used to land here as calls with $0.00 entry/stop/TP and "Checking fill".
        setTheses(all.filter((t) => !(t as { resolution?: boolean }).resolution && t.wallet.toLowerCase() === wallet.toLowerCase()));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    fetch(`${API_BASE}/theses/process/${wallet.toLowerCase()}`).then((r) => r.ok ? r.json() : null)
      .then((d) => setMerit(d?.meritRank?.title ? { glyph: String(d.meritRank.glyph ?? ""), title: String(d.meritRank.title) } : null))
      .catch(() => {});
    // Hub: this trader's graded AGENT record + their published strategies.
    setAgentRec(null); setPubStrats([]);
    fetch(`${API_BASE}/agents/standing/${wallet}`).then((r) => r.ok ? r.json() : null).then((d) => setAgentRec(d?.stats && d.stats.trades > 0 ? d.stats : null)).catch(() => {});
    fetch(`${API_BASE}/agent/${wallet}/strategies`).then((r) => r.ok ? r.json() : null).then((d) => setPubStrats((d?.strategies || []).filter((s: SavedStrategy) => s.public))).catch(() => {});
  }, [wallet]);

  // Live prices for active theses
  const activeSymbols = useMemo(
    () => [...new Set(theses.filter((t) => t.status === "ACTIVE").map((t) => t.symbol))],
    [theses]
  );
  const livePrices = useLivePrices(activeSymbols);
  // The unresolved book — what the in-flight tracker and the says-vs-holds check read.
  const openCalls = useMemo(
    () => theses.filter((t) => t.status === "ACTIVE").map((t) => ({
      symbol: t.symbol, direction: t.direction,
      entryPrice: t.entryPrice, stopLoss: t.stopLoss, takeProfit1: t.takeProfit1,
      status: t.status, gradedOutcome: t.gradedOutcome, fillState: t.fillState, publishMark: t.publishMark,
    })),
    [theses],
  );

  // Derived stats
  const stats = useMemo(() => {
    // Trustless: WIN/LOSS come from the objective grade (gradedOutcome), not raw /
    // self-reported statuses — consistent with the RANKS board + share cards.
    const wins = theses.filter((t) => t.gradedOutcome === "WIN").length;
    const losses = theses.filter((t) => t.gradedOutcome === "LOSS").length;
    const active = theses.filter((t) => t.status === "ACTIVE" && t.gradedOutcome !== "WIN" && t.gradedOutcome !== "LOSS").length;
    const invalidated = theses.filter((t) => t.status === "INVALIDATED").length;
    const closed = wins + losses;
    const winRate = closed > 0 ? (wins / closed) * 100 : null;
    // Average graded R over the resolved calls: the win rate never shows without it.
    const graded = theses.filter((t) => (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS") && Number.isFinite(t.gradedR));
    const avgR = graded.length ? graded.reduce((a, t) => a + (t.gradedR as number), 0) / graded.length : null;
    // From each call's own levels (TP1), the R the grader pays; calls whose levels don't make a call are left out.
    const rrs = theses.map((t) => callRR(t)).filter((r): r is number => r != null);
    const avgRR = rrs.length > 0 ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;
    const bestTrade = theses.reduce<FeedThesis | null>((best, t) =>
      callRR(t) != null && (!best || (callRR(t) ?? 0) > (callRR(best) ?? 0)) ? t : best, null);
    return { wins, losses, active, invalidated, closed, winRate, avgR, avgRR, bestTrade };
  }, [theses]);

  // Pull each identity field from the first thesis that actually has it — a wallet's
  // theses can carry different snapshots, so keying both off theses[0] left us showing
  // a name with a mismatched / missing picture.
  const displayName = theses.find((t) => t.displayName)?.displayName ?? null;
  const pfp = theses.find((t) => t.pfp)?.pfp ?? null;
  const shortAddr = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";

  function copyLink() {
    // Share the crawler-friendly /share/identity proxy — it unfurls the PREMIUM identity
    // card (merit rank + graded record) and bounces humans back to this profile. Sharing
    // the raw app URL would unfurl the generic static card (crawlers don't run our JS).
    const link = wallet ? `https://og.nexustradinglabs.com/share/identity/${wallet.toLowerCase()}` : window.location.href;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Ph14 — OG meta tags for social sharing
  useEffect(() => {
    if (loading || !wallet) return;
    const name = displayName ?? shortAddr;
    const title = `${name} on Nexus`;
    // The graded record in parts: a win rate never goes out without its R.
    const description = stats.closed > 0 && stats.winRate !== null && stats.avgR !== null
      ? `${stats.closed} graded call${stats.closed === 1 ? "" : "s"} · ${stats.winRate.toFixed(0)}% · ${stats.avgR >= 0 ? "+" : "−"}${Math.abs(stats.avgR).toFixed(2)}R avg. Graded from public price.`
      : "No graded calls yet. Every public call is graded from public price.";

    const setMeta = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    const OG_BASE = "https://og.nexustradinglabs.com"; // Ph20: custom domain on nexus-lab-api Worker
    setMeta("og:title", title);
    setMeta("og:description", description);
    // The PREMIUM identity card (merit rank + graded record), not the legacy /og/trader.
    setMeta("og:image", `${OG_BASE}/og/identity/${wallet}`);          // SVG. Discord, Telegram, iMessage
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", `${OG_BASE}/og/identity/${wallet}.png`); // Ph21: PNG for Twitter
    setMeta("og:url", window.location.href);
    document.title = title;

    return () => {
      setMeta("og:title", "Nexus Trading Labs");
      setMeta("og:description", "Non-custodial Perpetual DEX on Arbitrum");
      setMeta("og:image", "https://trade.nexustradinglabs.com/embed-mini.png");
      setMeta("og:url", "https://trade.nexustradinglabs.com");
      setMeta("twitter:card", "summary_large_image");
      setMeta("twitter:title", "Nexus Trading Labs");
      setMeta("twitter:description", "Non-custodial Perpetual DEX on Arbitrum");
      setMeta("twitter:image", "https://trade.nexustradinglabs.com/embed-mini.png");
      document.title = "Nexus Trading Labs";
    };
  }, [wallet, loading, displayName, shortAddr, stats.closed, stats.avgR, stats.winRate]);

  if (!wallet) return null;

  return (
    <div style={{ background: "#0a0a0b", minHeight: "100svh" }}>
      {/* Copy modal */}
      {copyTarget && walletAddress && (
        <CopyModal thesis={copyTarget} walletAddress={walletAddress} onClose={() => setCopyTarget(null)} />
      )}

      {/* Header — the call page's action bar: plain text actions, one style (TEXT_ACTION), no boxes. Follow /
          Message / Link wrap to a second row on a phone; each keeps a 44px tap target. */}
      <div style={TEXT_ACTION_BAR}>
        <button onClick={() => navigate("/feed")} className={TEXT_ACTION_CLASS} style={TEXT_ACTION}>← Feed</button>
        <div style={{ flex: 1 }} />
        {walletAddress && !isOwn && wallet && (
          <button
            onClick={toggleFollow}
            disabled={followBusy}
            className={TEXT_ACTION_CLASS}
            title={isFollowing ? "Unfollow. Stop starred alerts when they open a position" : "Follow. Their next open pings you in Live Alerts"}
            // Gold = someone you follow (SIGNAL.follow's one job); otherwise the plain action colour.
            style={{ ...TEXT_ACTION, color: isFollowing ? SIGNAL.follow : TEXT_ACTION.color, cursor: followBusy ? "default" : "pointer" }}
          >
            {isFollowing ? "★ Following" : "☆ Follow"}
          </button>
        )}
        <MessageTraderButton
          wallet={wallet}
          myWallet={walletAddress}
          variant="full"
          label="⬡ Message"
          className={TEXT_ACTION_CLASS}
          style={TEXT_ACTION}
        />
        <button onClick={copyLink} title="Copy link" className={TEXT_ACTION_CLASS} style={{ ...TEXT_ACTION, color: copied ? "#ededf0" : TEXT_ACTION.color }}>
          {copied ? "✓ Copied" : "⧉ Link"}
        </button>
      </div>

      <div style={{ padding: 16, maxWidth: 860, margin: "0 auto" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#71717a" }}>
            Loading profile…
          </div>
        )}

        {error && !loading && (
          <div style={{ textAlign: "center", padding: "60px 0", fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#fbbf24" }}>
            Couldn’t load this profile. Check your connection and try again.
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Trader identity */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, padding: "16px 20px", background: "#141416", border: "1px solid #232327", borderRadius: 6 }}>
              <Avatar pfp={pfp} displayName={displayName} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 18, fontWeight: "bold", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {displayName ?? shortAddr}
                  </span>
                  {isOwn && <span style={{ color: "#ededf0", fontSize: 11, flexShrink: 0 }}>YOU</span>}
                  {wallet && <span style={{ flexShrink: 0 }}><NexusTierBadge address={wallet} /></span>}
                </div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#52525b", marginTop: 2 }}>{shortAddr}</div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", marginTop: 4 }}>
                  {theses.length} public {theses.length === 1 ? "call" : "calls"}
                </div>
              </div>
              {/* Cross-check: this board ranks GRADED CALLS, but a caller's real
                  venue record is separate evidence. New tab on purpose. Verifying
                  shouldn't cost you your place on the profile. */}
              {wallet && (
                <a
                  href={`/analyze?address=${wallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="X-ray this wallet's actual perp record on Hyperliquid + Orderly. Verify before you copy"
                  className={TEXT_ACTION_CLASS}
                  style={{ ...TEXT_ACTION, flexShrink: 0 }}
                >
                  ⌕ X-ray ↗
                </a>
              )}
              {/* Merit rank: earned from graded calls (▪ Signal → ◆ Sharp → ✦ Apex), never bought. A rank,
                  not money: monochrome. No rank, no badge — the tiles below carry the record. */}
              {merit && (
                <div
                  title="Merit rank, earned from graded calls: Signal (5+ calls, net positive R), Sharp (15+, 50%+, 0.5R+), Apex (30+, 55%+, 1R+)."
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    padding: "8px 14px", border: "1px solid #33333a", borderRadius: 4, flexShrink: 0,
                  }}
                >
                  <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", letterSpacing: "0.12em" }}>RANK</div>
                  <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 15, fontWeight: 700, color: "#ededf0", lineHeight: 1.4, whiteSpace: "nowrap" }}>
                    {merit.glyph} {merit.title.toUpperCase()}
                  </div>
                </div>
              )}
            </div>

            {theses.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div aria-hidden style={{ fontSize: 20, color: "#52525b", marginBottom: 8 }}>◆</div>
                <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#a1a1aa" }}>No public calls yet.</div>
                <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#71717a", marginTop: 4 }}>Calls appear here once this wallet publishes one. Each is graded from public price.</div>
              </div>
            ) : (
              <>
                {/* SYNTHESIS FIRST — who this trader is, what's in flight, and what the
                    venue independently says. The raw stat grid below is the evidence. */}
                <PublicOperatorProfile wallet={wallet ?? null} isOwn={isOwn} />
                <InFlightCalls calls={openCalls} prices={livePrices} />
                <VenueEvidence wallet={wallet ?? null} openCalls={openCalls} />

                {/* The accruing, self-grading on-chain record (Consistency Score, trend,
                    copy record). Same surface as the Smart Money x-ray, so a trader's
                    public page and their x-ray can never tell a different story. */}
                {wallet && <TrackedRecordCard address={wallet} />}

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 24 }}>
                  {/* A rate is monochrome; the graded R beside it carries the money colour. */}
                  <StatBox
                    label="WIN RATE"
                    value={stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"}
                    sub={stats.closed > 0 ? `${stats.wins}W / ${stats.losses}L graded` : "no graded calls yet"}
                    color={stats.winRate === null ? "#52525b" : "#ededf0"}
                  />
                  <StatBox
                    label="AVG GRADED R"
                    value={stats.avgR !== null ? `${stats.avgR >= 0 ? "+" : "−"}${Math.abs(stats.avgR).toFixed(2)}R` : "—"}
                    sub={stats.avgR !== null ? `over ${stats.closed} resolved` : "none resolved yet"}
                    color={stats.avgR === null ? "#52525b" : stats.avgR >= 0 ? "#3ecf8e" : "#f7525f"}
                  />
                  <StatBox
                    label="PLANNED R:R"
                    value={`1:${stats.avgRR.toFixed(2)}`}
                    sub="avg, from the levels"
                    color="#ededf0"
                  />
                  <StatBox
                    label="ACTIVE"
                    value={String(stats.active)}
                    sub="unresolved calls"
                    color={stats.active > 0 ? "#ededf0" : "#52525b"}
                  />
                  <StatBox
                    label="TOTAL"
                    value={String(theses.length)}
                    sub={`${stats.invalidated} invalidated`}
                    color="#a1a1aa"
                  />
                  {stats.bestTrade && (
                    <StatBox
                      label="BEST R:R"
                      value={fmtRR(callRR(stats.bestTrade))}
                      sub={bareTicker(stats.bestTrade.symbol)}
                      color="#ededf0"
                    />
                  )}
                </div>

                {/* Hub: this trader's graded autonomous-agent record */}
                {agentRec && (
                  <div style={{ marginBottom: 16, border: "1px solid #232327", borderRadius: 6, padding: 14, background: "#0a0a0b" }}>
                    <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", letterSpacing: "0.08em", marginBottom: 10 }}>AUTONOMOUS AGENT · GRADED RECORD</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px,1fr))", gap: 12 }}>
                      {[
                        { l: "NET P&L", v: `${agentRec.netPnl >= 0 ? "+" : ""}$${agentRec.netPnl}`, c: agentRec.netPnl >= 0 ? "#3ecf8e" : "#f7525f" },
                        { l: "WIN RATE", v: `${agentRec.winRate}%`, c: "#d4d4d8" },
                        { l: "TRADES", v: String(agentRec.trades), c: "#d4d4d8" },
                        { l: "SCORE", v: `${agentRec.score}`, c: "#d4d4d8" },
                      ].map((x) => (
                        <div key={x.l}>
                          <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", letterSpacing: "0.1em", marginBottom: 3 }}>{x.l}</div>
                          <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 16, fontWeight: 600, color: x.c }}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hub: this trader's published strategies — copyable to your own agent */}
                {pubStrats.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", letterSpacing: "0.08em", marginBottom: 10 }}>PUBLISHED STRATEGIES · COPY TO YOUR AGENT</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {pubStrats.map((s) => (
                        <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 10px", background: "#0a0a0b", border: "1px solid #232327", borderRadius: 3 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 12, fontWeight: 600, color: "#d4d4d8" }}>{s.name} <span style={{ color: "#d4d4d8", fontSize: 9 }}>{deriveStyle(s.config)}</span></div>
                            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#a1a1aa", marginTop: 2 }}>{s.config.signalMode} · {s.config.leverage}x · TP{s.config.tpPercent}/SL{s.config.slPercent}</div>
                          </div>
                          <button onClick={() => deployToAgent(s.config, `${displayName ?? shortAddr}'s "${s.name}"`, undefined, navigate, { replaceFilters: true })} style={{ background: "none", border: "1px solid #33333a", color: "#ededf0", fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "5px 14px", borderRadius: 3, cursor: "pointer", flexShrink: 0 }}>Copy →</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Thesis list */}
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", letterSpacing: "0.08em", marginBottom: 10 }}>
                  CALLS · TAP ONE TO OPEN IT
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {theses
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((t) => (
                      <ThesisRow
                        key={t.id}
                        thesis={t}
                        markPrice={livePrices[t.symbol] ?? null}
                        onCopy={setCopyTarget}
                        isOwn={isOwn}
                        walletAddress={walletAddress}
                      />
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
