// Wallet X-Ray panels: the time-window grade, the decay row, the copy gate, and the
// open-positions panel. All grading rules live in @/lib/xrayGrade.mjs (tested) — this
// file only renders them. The grade is shown as its parts; there is no single score.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { XRAY_WINDOWS, GATE_WINDOW, WATCHED_MIN_DAYS, fmtPf, liqDistancePct } from "@/lib/xrayGrade.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BONE = "#ededf0";
const POS = "#3ecf8e", NEG = "#f7525f", WARN = "#fbbf24";
const FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b", BRIGHT = "#f4f4f5";
const BORDER = "#232327", SURFACE = "#141416", SURFACE_ALT = "#0f0f11";

const label: CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: MUTED };
const card: CSSProperties = { border: `1px solid ${BORDER}`, borderRadius: 8, background: SURFACE_ALT, padding: "16px 18px", marginBottom: 22 };

export type WindowKey = "24H" | "7D" | "30D" | "ALL";
export const WINDOW_KEYS = XRAY_WINDOWS.map((w) => w.key) as WindowKey[];

export type WindowGrade = {
  key: WindowKey; min: number; trades: number; need: number; net: number;
  status: "ACCRUING" | "GRADED";
  wins?: number; losses?: number; winRate?: number; pf?: number;
  avgWin?: number; avgLoss?: number; expectancy?: number;
};
export type WatchedWin = { key: WindowKey; covered: boolean; coveredDays: number; net?: number; stale?: boolean };
export type DecayCell = { key: string; status: "GRADED" | "ACCRUING"; pf: number | null; trades: number; need?: number };
export type Gate = { pass: boolean; evidence: { source: string; label: string }[]; reasons: string[] };

export const usd = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(2);
  return `${n < 0 ? "-" : ""}$${s}`;
};
const signed = (n: number) => `${n >= 0 ? "+" : ""}${usd(n)}`;
const px = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4);
};

// ── THE GRADE — window tabs + components + decay row ─────────────────────────
export function WindowGradeCard({
  hasTape, grades, active, onPick, fellBack, partialKeys, watched, decay,
}: {
  hasTape: boolean;
  grades: Record<WindowKey, WindowGrade> | null;
  active: WindowKey;
  onPick: (k: WindowKey) => void;
  fellBack: boolean;
  partialKeys: WindowKey[];
  watched: Record<WindowKey, WatchedWin> | null;
  decay: DecayCell[] | null;
}) {
  const g = grades?.[active] ?? null;
  const w = watched?.[active] ?? null;
  const minFor = XRAY_WINDOWS.find((x) => x.key === active)?.min ?? 20;
  return (
    <div className="nx-fade-in" style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={label}>◆ THE GRADE · BY WINDOW</div>
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          {WINDOW_KEYS.map((k) => {
            const on = k === active;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => onPick(k)}
                style={{
                  fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer",
                  padding: "5px 10px", borderRadius: 3, border: `1px solid ${on ? BONE : BORDER}`,
                  background: on ? BONE : "transparent", color: on ? "#0a0a0b" : MUTED,
                }}>
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {fellBack && active === "ALL" && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: MUTED, marginBottom: 10 }}>
          30D has too few trades to grade. Showing ALL. Tap 30D to see it accruing.
        </div>
      )}

      {hasTape && g ? (
        g.status === "GRADED" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 12 }}>
            {[
              { l: "NET", v: signed(g.net), c: g.net >= 0 ? POS : NEG },
              { l: "TRADES", v: String(g.trades), c: BRIGHT },
              { l: "WIN RATE", v: `${(g.winRate ?? 0).toFixed(0)}%`, c: BRIGHT },
              { l: "PROFIT FACTOR", v: fmtPf(g.pf), c: (g.pf ?? 0) > 1 ? POS : NEG },
              { l: "AVG WIN / LOSS", v: `${usd(g.avgWin ?? 0)} / ${usd(g.avgLoss ?? 0)}`, c: FOG },
              { l: "EXPECTANCY", v: signed(g.expectancy ?? 0), c: (g.expectancy ?? 0) >= 0 ? POS : NEG },
            ].map((s) => (
              <div key={s.l}>
                <div style={{ ...label, fontSize: 8, letterSpacing: "0.12em" }}>{s.l}</div>
                <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: s.c, marginTop: 2 }}>{s.v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontFamily: UI, fontSize: 18, fontWeight: 700, color: FOG }}>ACCRUING</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, marginTop: 4 }}>
              {g.trades} closed trade{g.trades === 1 ? "" : "s"} in {active} · needs {minFor} to grade
              {g.trades > 0 ? ` · ${signed(g.net)} net so far (a fact, not a grade)` : ""}
            </div>
          </div>
        )
      ) : (
        <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
          No Hyperliquid tape. Per-trade grading needs one. Orderly publishes per-market totals only.
        </div>
      )}

      {hasTape && partialKeys.includes(active) && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: WARN, marginTop: 10 }}>
          partial tape. Hyperliquid serves only a wallet&apos;s 10,000 most recent fills, and {active} reaches back before them. Graded on what&apos;s served.
        </div>
      )}

      {/* The Orderly side can't be windowed per trade — only off the watched record. */}
      {watched && (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: FOG, marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
          <span style={{ color: MUTED }}>ORDERLY · WATCHED · {active}</span>{"  "}
          {w?.covered && w.net != null ? (
            <span style={{ color: w.net >= 0 ? POS : NEG, fontWeight: 700 }}>{signed(w.net)} realized</span>
          ) : w?.stale ? (
            <span style={{ color: FAINT }}>— record stopped updating</span>
          ) : (
            <span style={{ color: FAINT }}>— watched {Math.floor(w?.coveredDays ?? 0)}d, not enough to cover {active}</span>
          )}
        </div>
      )}

      {hasTape && decay && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: MONO, fontSize: 11 }}>
          <span style={{ ...label, fontSize: 8 }}>EDGE DECAY · PF</span>
          {decay.map((d, i) => (
            <span key={d.key} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <span style={{ color: FAINT }}>→</span>}
              <span title={d.status === "GRADED" ? `${d.trades} trades` : `${d.trades} trades · needs ${d.need} more`}>
                <span style={{ color: MUTED }}>{d.key} </span>
                {d.status === "GRADED"
                  ? <b style={{ color: (d.pf ?? 0) > 1 ? POS : NEG }}>{fmtPf(d.pf)}</b>
                  : <span style={{ color: FAINT }}>accruing</span>}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SHARE ─────────────────────────────────────────────────────────────────────
// Shares the crawler-friendly /share/xray link (real meta + the 30D card), not the SPA URL:
// X/Discord/Telegram don't run JS, so the SPA's own tags never unfurl. Humans who open the
// link land straight on /analyze. Mobile → the OS share sheet; everywhere else → clipboard.
// No tracking params, no auto-posting.
export const xrayShareUrl = (address: string) => `https://og.nexustradinglabs.com/share/xray/${address.toLowerCase()}`;

export function ShareXrayButton({ address, isMobile }: { address: string; isMobile: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const url = xrayShareUrl(address);
  const flash = (s: "copied" | "manual") => {
    setState(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), s === "copied" ? 2000 : 8000);
  };
  const onShare = async () => {
    if (isMobile && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ title: "Wallet X-Ray", url }); return; }
      catch (e) { if ((e as { name?: string })?.name === "AbortError") return; /* else fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); flash("copied"); }
    catch { flash("manual"); } // no clipboard permission → show the link to copy by hand
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button onClick={onShare} className="nx-btn" title="Share this x-ray. The link unfurls with the 30D grade card"
        style={{ background: "none", border: `1px solid ${state === "copied" ? BONE : BORDER}`, borderRadius: 3, cursor: "pointer",
          fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", padding: "3px 9px", color: state === "copied" ? BONE : MUTED }}>
        {state === "copied" ? "LINK COPIED ✓" : "↗ SHARE"}
      </button>
      {state === "manual" && (
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link"
          style={{ fontFamily: MONO, fontSize: 10, color: FOG, background: "#08080a", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "3px 6px", width: 260, maxWidth: "70vw" }} />
      )}
    </span>
  );
}

// ── OPEN THIS EDGE ON NEXUS — the gated CTA ──────────────────────────────────
export function EdgeGateCard({ gate, children }: { gate: Gate; children?: ReactNode }) {
  return (
    <div className="nx-fade-in" style={{ ...card, borderLeft: `3px solid ${gate.pass ? BONE : BORDER}` }}>
      <div style={{ ...label, marginBottom: 8 }}>{gate.pass ? "⚡ OPEN THIS EDGE ON NEXUS" : "⚡ COPY LOCKED"}</div>
      {gate.pass ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: FOG, marginBottom: 12 }}>
          {gate.evidence.map((e) => e.label).join(" · ")}
        </div>
      ) : (
        <>
          <ul style={{ margin: "0 0 8px", paddingLeft: 16, fontFamily: MONO, fontSize: 11, color: FOG, lineHeight: 1.7 }}>
            {gate.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.6, marginBottom: 12, maxWidth: 640 }}>
            Copy opens once the recent record clears the bar: {GATE_WINDOW} with ≥20 closed trades, net positive,
            profit factor above 1. Or {WATCHED_MIN_DAYS}+ graded days of a watched Orderly record, net positive.
            Any graded record that&apos;s negative keeps it locked.
          </div>
        </>
      )}
      {children}
    </div>
  );
}

// ── OPEN POSITIONS ────────────────────────────────────────────────────────────
export type PosRow = {
  key: string; venue: string; sym: string; side: "LONG" | "SHORT";
  leverage: number | null; isolated?: boolean; entry: number; mark: number | null; uPnl: number; valueUsd: number;
  liq: number | null; liqReported: boolean; // liqReported=false → venue doesn't publish it (Orderly)
  copySym: string | null;                    // Orderly coin when copyable, else null
};

const COLS = "124px 90px 64px 52px 1fr 1fr 96px 80px 112px";

export function PositionsPanel({
  rows, gatePass, onCopy, onDraft, hlFailed, hasOrderly, failedDexes = [],
}: {
  rows: PosRow[]; gatePass: boolean;
  onCopy: (r: PosRow) => void; onDraft: (r: PosRow) => void;
  hlFailed: boolean; hasOrderly: boolean; failedDexes?: string[];
}) {
  return (
    <div className="nx-fade-in" style={card}>
      <div style={{ ...label, marginBottom: 10 }}>◆ OPEN POSITIONS · LIVE</div>
      {rows.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
          No open positions{hlFailed ? " found. Hyperliquid positions couldn't be read right now" : ""}.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, minWidth: 794, ...label, fontSize: 8, paddingBottom: 6, borderBottom: `1px solid ${BORDER}` }}>
            <span>VENUE</span><span>MARKET</span><span>SIDE</span><span>LEV</span>
            <span style={{ textAlign: "right" }}>ENTRY</span><span style={{ textAlign: "right" }}>MARK</span>
            <span style={{ textAlign: "right" }}>UPNL</span><span style={{ textAlign: "right" }}>LIQ DIST</span><span />
          </div>
          {rows.map((r) => {
            const dist = r.liqReported ? liqDistancePct(r.side, r.mark, r.liq) : null;
            const distColor = dist == null ? FAINT : dist < 10 ? NEG : dist < 25 ? WARN : FOG;
            return (
              <div key={r.key} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, minWidth: 794, alignItems: "center", padding: "7px 0", fontFamily: MONO, fontSize: 11, borderBottom: `1px solid ${SURFACE}` }}>
                <span style={{ color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.venue}>{r.venue}</span>
                <span style={{ color: BRIGHT }}>{r.sym}</span>
                <span style={{ color: r.side === "LONG" ? POS : NEG }}>{r.side === "LONG" ? "↑ LONG" : "↓ SHORT"}</span>
                <span style={{ color: r.leverage ? FOG : FAINT }} title={r.leverage ? (r.isolated ? "isolated margin" : "cross margin") : undefined}>
                  {r.leverage ? `${r.leverage}x` : "—"}{r.leverage && r.isolated ? <span style={{ color: MUTED, fontSize: 9 }}> ISO</span> : null}
                </span>
                <span style={{ color: FOG, textAlign: "right" }}>{px(r.entry)}</span>
                <span style={{ color: FOG, textAlign: "right" }}>{px(r.mark)}</span>
                <span style={{ color: r.uPnl >= 0 ? POS : NEG, textAlign: "right" }}>{signed(r.uPnl)}</span>
                <span style={{ color: distColor, textAlign: "right" }} title={r.liqReported ? (r.liq ? `liq ${px(r.liq)}` : "no liquidation price reported") : "venue doesn't publish it"}>
                  {dist == null ? "—" : `${dist.toFixed(1)}%`}
                </span>
                <span style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                  <button onClick={() => onDraft(r)} title="Draft a thesis from this position. Plan it yourself"
                    style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 3, color: MUTED, fontFamily: MONO, fontSize: 9, padding: "2px 7px", cursor: "pointer" }}>◆</button>
                  {gatePass && r.copySym ? (
                    <button onClick={() => onCopy(r)} className="nx-btn" title="Copy this position. The agent enters your direction, manages the exit, and grades it on-chain"
                      style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 3, color: BONE, fontFamily: MONO, fontSize: 9, letterSpacing: "0.04em", padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap" }}>⚡ COPY</button>
                  ) : (
                    <span title={!gatePass ? "Copy locked. The wallet's grade hasn't cleared the bar" : "Not listed on Orderly. Nothing to copy into"}
                      style={{ color: FAINT, fontSize: 9, padding: "2px 4px", whiteSpace: "nowrap" }}>{!gatePass ? "🔒" : "not listed"}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* A partial book must say so — never pass it off as every open position. */}
      {failedDexes.length > 0 && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: WARN, marginTop: 10 }}>
          Couldn&apos;t read Hyperliquid positions on: {failedDexes.join(", ")}. This list may be incomplete.
        </div>
      )}
      {hasOrderly && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: FAINT, marginTop: 10, lineHeight: 1.6 }}>
          Orderly doesn&apos;t publish an account&apos;s leverage or liquidation price publicly. Shown as —, never estimated.
          Liq distance is how far the mark must move against the position to reach the venue-reported liquidation price.
        </div>
      )}
    </div>
  );
}
