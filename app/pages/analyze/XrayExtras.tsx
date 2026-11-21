// The X-Ray's empty page and its compare table (borst 2026-11-21).
//  • XrayHome: what's on the page before a wallet is pasted. Your recent X-rays and starred wallets (this device),
//    the wallets Smart Money watches ordered by stage then days watched (smartLayout.mjs, the board's own order),
//    and what an X-Ray reads. Every row is one tap to run it.
//  • XrayCompare: two wallets on the same grade, windows and copy gate (xrayCompare.mjs). The page hands in wallet A's
//    already-read side; B is read here. No winner, no combined score.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, UI } from "@/config/theme";
import { readRecent, RECENT_KEY, walletLabel } from "@/lib/xrayInput.mjs";
import { sortWallets, walletStage, recordFacts, STAGE_WORD, STRIP_LINE } from "@/lib/smartLayout.mjs";
import { compareRows, compareLine } from "@/lib/xrayCompare.mjs";
import { gradeAllWindows, edgeGate, fillsToClosedTrades, windowComplete } from "@/lib/xrayGrade.mjs";
import { fetchHLTape, fetchHLPositions } from "@/utils/hyperliquid";
import { pressKey } from "@/utils/a11y";
import { useIsMobile } from "@/pages/lab/useIsMobile";

const AGENT_API = "https://og.nexustradinglabs.com";
const WATCH_KEY = "nexus_sm_watchlist";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const POS = "#3ecf8e", NEG = "#f7525f";

const eyebrow = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", color: MUTED, textTransform: "uppercase" as const };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

type Board = { source: "orderly" | "hl"; address: string; pnl: number }[];
type Track = Record<string, unknown>;

function Row({ onClick, left, right, sub }: { onClick: () => void; left: string; right?: string; sub?: string }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={pressKey(onClick)}
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", minHeight: 44, boxSizing: "border-box" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, color: BRIGHT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
        {sub && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {right && <span style={{ fontFamily: UI, fontSize: 12, color: FOG, flexShrink: 0, whiteSpace: "nowrap" }}>{right}</span>}
      <span aria-hidden style={{ color: FAINT, flexShrink: 0 }}>→</span>
    </div>
  );
}

function Box({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, overflow: "hidden", minWidth: 0 }}>
      <div style={{ padding: "12px 12px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={eyebrow}>{title}</div>
        {note && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginTop: 5, lineHeight: 1.45 }}>{note}</div>}
      </div>
      {children}
    </section>
  );
}

const READS = [
  { t: "The grade, by window", d: "24H · 7D · 30D · ALL from the Hyperliquid tape. A window grades only once it has enough closed trades (5 / 10 / 20 / 20)." },
  { t: "The watched record", d: "Realized P&L snapshotted daily from the day we start watching. Lifetime totals flatter; this can’t be back-filled." },
  { t: "Open positions", d: "Both venues. Leverage and liquidation as Hyperliquid reports them; Orderly’s indexer has neither, so they stay blank." },
  { t: "The copy gate", d: "Copy opens only when the 30D record or a 20-day watched record is net positive, and nothing graded says otherwise." },
];

export function XrayHome({ onPick }: { onPick: (address: string, name?: string) => void }) {
  const isMobile = useIsMobile();
  const [recent] = useState(() => { try { return readRecent(localStorage.getItem(RECENT_KEY)); } catch { return []; } });
  const [starred] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); return Array.isArray(v) ? v.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).slice(0, 8) : []; } catch { return []; }
  });
  const [board, setBoard] = useState<Board | null>(null);
  const [tracked, setTracked] = useState<Record<string, Track>>({});
  const [boardFailed, setBoardFailed] = useState(false);

  useEffect(() => {
    let off = false;
    fetch(`${AGENT_API}/smart/board`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (off) return;
        const t: Board = Array.isArray(d?.traders) ? d.traders.filter((x: { address?: string }) => /^0x[0-9a-fA-F]{40}$/.test(String(x?.address))) : [];
        setBoard(t);
        const addrs = [...new Set(t.map((x) => x.address.toLowerCase()))].slice(0, 60);
        if (addrs.length) fetch(`${AGENT_API}/smart/xray/tracked?addresses=${addrs.join(",")}`).then((r) => r.json())
          .then((x) => { if (!off && x?.tracked) setTracked(x.tracked); }).catch(() => {});
      })
      .catch(() => { if (!off) setBoardFailed(true); });
    return () => { off = true; };
  }, []);

  const watched = useMemo(() => (board ? (sortWallets(board, tracked) as Board).slice(0, 8) : []), [board, tracked]);

  return (
    <div className="nx-fade-in" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, marginTop: 6 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {recent.length > 0 && (
          <Box title="Your recent X-rays" note="On this device only.">
            {recent.map((r) => <Row key={r.address} onClick={() => onPick(r.address, r.name)} left={walletLabel(r)} right={r.at ? ago(r.at) : undefined} />)}
          </Box>
        )}
        {starred.length > 0 && (
          <Box title="Wallets you starred" note="Your Smart Money watchlist on this device.">
            {starred.map((a) => <Row key={a} onClick={() => onPick(a)} left={short(a)} />)}
          </Box>
        )}
        <Box title="What an X-Ray reads">
          <div style={{ padding: "4px 12px 8px" }}>
            {READS.map((r) => (
              <div key={r.t} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: UI, fontSize: 13, color: BRIGHT }}>{r.t}</div>
                <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG, marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
              </div>
            ))}
            <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, paddingTop: 8, lineHeight: 1.5 }}>Paste a 0x address or an ENS name. Public data only: nothing to connect, nothing signed.</div>
          </div>
        </Box>
      </div>
      <Box title="Wallets we watch" note={`${STRIP_LINE} Ordered by stage, then days watched.`}>
        {board === null && !boardFailed && <div style={{ padding: 12, fontFamily: MONO, fontSize: 11, color: MUTED }}>reading the Smart Money board…</div>}
        {boardFailed && <div style={{ padding: 12, fontFamily: UI, fontSize: 12.5, color: MUTED }}>The Smart Money board is unread right now. Paste a wallet above.</div>}
        {watched.map((t) => {
          const tk = tracked[t.address.toLowerCase()];
          const stage = walletStage(tk) as keyof typeof STAGE_WORD;
          const facts = (recordFacts(tk) as { text: string }[]).slice(0, 2).map((f) => f.text).join(" · ");
          return <Row key={t.address} onClick={() => onPick(t.address)} left={`${short(t.address)} · ${t.source === "hl" ? "Hyperliquid" : "Orderly"}`} right={STAGE_WORD[stage]} sub={facts || undefined} />;
        })}
      </Box>
    </div>
  );
}

// ── Compare ──────────────────────────────────────────────────────────────────
export type CompareSide = {
  unread?: boolean;
  grades: Record<string, unknown> | null;
  track: unknown;
  gate: { pass: boolean; reasons: string[] } | null;
  hlLifetime: number | null;
  orderlyRealized: number | null;
  openPositions: number | null;
};

/** Read wallet B the way the page reads A: HL tape + Orderly indexer + the watched record, each fail-soft. */
async function readSide(addr: string): Promise<CompareSide> {
  const now = Date.now();
  const [hl, ord, hist, pos] = await Promise.allSettled([
    fetchHLTape(addr),
    fetch(`${AGENT_API}/smart/xray?address=${encodeURIComponent(addr)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    fetch(`${AGENT_API}/smart/xray/history?address=${encodeURIComponent(addr)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    fetchHLPositions(addr),
  ]);
  if (hl.status === "rejected" && ord.status === "rejected") return { unread: true, grades: null, track: null, gate: null, hlLifetime: null, orderlyRealized: null, openPositions: null };
  const trades = hl.status === "fulfilled" ? (fillsToClosedTrades(hl.value.fills) as { pnl: number }[]) : [];
  const grades = trades.length ? (gradeAllWindows(trades, now) as Record<string, { status: string }>) : null;
  const track = hist.status === "fulfilled" && hist.value?.track ? hist.value.track : null;
  const ox = ord.status === "fulfilled" ? ord.value : null;
  const orOpen = ox?.venues ? ox.venues.reduce((n: number, v: { openPositions?: number }) => n + (Number(v.openPositions) || 0), 0) : 0;
  return {
    grades,
    track,
    gate: edgeGate({
      hl30: grades ? grades["30D"] : null,
      watched: track && !(track as { building?: boolean }).building ? track : null,
      hl30CoveredDays: hl.status === "fulfilled" && hl.value.oldestTs && !windowComplete("30D", now, { truncated: hl.value.truncated, oldestTs: hl.value.oldestTs })
        ? (now - hl.value.oldestTs) / 86400000 : null,
    }) as CompareSide["gate"],
    hlLifetime: trades.length ? trades.reduce((s, t) => s + t.pnl, 0) : null,
    orderlyRealized: ox && ox.venues?.length ? Number(ox.totalRealized) || 0 : null,
    openPositions: pos.status === "fulfilled" ? pos.value.positions.length + orOpen : null,
  };
}

export function XrayCompare({ a, aLabel, b, bLabel, onClose, onOpen }: {
  a: CompareSide; aLabel: string; b: string; bLabel: string; onClose: () => void; onOpen: (address: string) => void;
}) {
  const isMobile = useIsMobile();
  const [side, setSide] = useState<CompareSide | null>(null);
  useEffect(() => {
    let off = false;
    setSide(null);
    readSide(b).then((s) => { if (!off) setSide(s); }).catch(() => { if (!off) setSide({ unread: true, grades: null, track: null, gate: null, hlLifetime: null, orderlyRealized: null, openPositions: null }); });
    return () => { off = true; };
  }, [b]);
  const rows = compareRows(a, side ?? { unread: true }) as { key: string; label: string; note?: string; a: { text: string; tone: string | null }; b: { text: string; tone: string | null } }[];
  const color = (t: string | null) => (t === "pos" ? POS : t === "neg" ? NEG : t === "muted" ? MUTED : BRIGHT);
  const cell = (c: { text: string; tone: string | null }, loading: boolean) => (
    <span style={{ fontFamily: MONO, fontSize: 12, color: loading ? FAINT : color(c.tone), lineHeight: 1.45, overflowWrap: "anywhere" }}>{loading ? "reading…" : c.text}</span>
  );
  return (
    <div className="nx-fade-in" style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: isMobile ? "14px 14px 12px" : "16px 18px 14px", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={eyebrow}>Side by side · same grade, same windows</div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontFamily: UI, fontSize: 12.5, cursor: "pointer", padding: "6px 0", minHeight: 32 }}>Close compare ✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "160px minmax(0,1fr) minmax(0,1fr)", gap: "0 14px" }}>
        {!isMobile && <span />}
        <span style={{ fontFamily: MONO, fontSize: 11, color: BRIGHT, paddingBottom: 8, overflowWrap: "anywhere" }}>{aLabel}</span>
        <button type="button" onClick={() => onOpen(b)} title="Open this wallet’s full X-Ray"
          style={{ textAlign: "left", background: "none", border: "none", padding: "0 0 8px", cursor: "pointer", fontFamily: UI, fontSize: 12, color: BRIGHT, overflowWrap: "anywhere" }}>{bLabel} →</button>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "contents" }}>
            {isMobile
              ? <div style={{ gridColumn: "1 / -1", fontFamily: UI, fontSize: 11.5, color: MUTED, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>{r.label}{r.note ? ` · ${r.note}` : ""}</div>
              : <span style={{ fontFamily: UI, fontSize: 12.5, color: FOG, padding: "9px 0", borderTop: `1px solid ${C.border}` }}>{r.label}{r.note && <span style={{ color: FAINT }}> · {r.note}</span>}</span>}
            <span style={{ padding: isMobile ? "4px 0 6px" : "9px 0", borderTop: isMobile ? "none" : `1px solid ${C.border}` }}>{cell(r.a, false)}</span>
            <span style={{ padding: isMobile ? "4px 0 6px" : "9px 0", borderTop: isMobile ? "none" : `1px solid ${C.border}` }}>{cell(r.b, side === null)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: FOG, marginTop: 12 }}>{side === null ? "Reading the second wallet…" : compareLine(a, side, aLabel, bLabel)}</div>
    </div>
  );
}
