// Copy Trades tab (2026-11-14, borst: "Copy Trades tab"): your copies, grouped by the caller you copied. For each:
// their WHOLE graded record from the public feed (losses included, copies out), whether they're on the ranked board
// or why not, and where your copies of them stand. Rules app/lib/copyLeaders.mjs + feedRecord.mjs (tested).
// Never a "copy more" nudge; the record says it. Green/red only on money.
import { C, MONO, UI } from "@/config/theme";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "@orderly.network/hooks";
import { useLabStorage } from "@/hooks/useLabStorage";
import { useIsMobile } from "./useIsMobile";
import { STATUS_CONFIG } from "./styles";
import { effectiveStatus } from "./helpers";
import { EmptyState } from "./components";
import { bareTicker } from "@/utils/utils";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { feedRecords, recordLine } from "@/lib/feedRecord.mjs";
import { copyLeaders, mineLine } from "@/lib/copyLeaders.mjs";
import { callRR, fmtRR } from "@/lib/callMath.mjs";
import { CoinLink } from "@/components/CoinLink";

const AGENT_API = "https://og.nexustradinglabs.com";
const px = (v: number) => (Number.isFinite(v) && v > 0 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 2 : 4 })}` : "—");

type Rec = { graded: number; wins: number; netR: number };

export function CopiesView() {
  const isMobile = useIsMobile();
  const { state: accountState } = useAccount();
  const walletAddress = (accountState as { address?: string })?.address ?? null;
  const { theses } = useLabStorage(walletAddress);
  const navigate = useNavigate();
  const [records, setRecords] = useState<Map<string, Rec> | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [ranked, setRanked] = useState<Set<string>>(new Set());

  const copiedTheses = useMemo(() => theses.filter((t) => t.copiedFromWallet || t.id.startsWith("copy_")), [theses]);

  useEffect(() => {
    if (!copiedTheses.length) return;
    let alive = true;
    (async () => {
      const [feed, board] = await Promise.all([
        sharedJson(`${AGENT_API}/feed`).catch(() => null),
        sharedJson(`${AGENT_API}/theses/leaderboard`).catch(() => null),
      ]);
      if (!alive) return;
      const rows = Array.isArray(feed?.feed) ? feed.feed.filter((t: { resolution?: boolean }) => !t.resolution) : [];
      setRecords(feedRecords(rows) as Map<string, Rec>);
      const nm = new Map<string, string>();
      for (const t of rows as { wallet?: string; displayName?: string }[]) if (t.wallet && t.displayName) nm.set(t.wallet.toLowerCase(), t.displayName);
      setNames(nm);
      setRanked(new Set(((board?.leaderboard ?? []) as { wallet?: string }[]).map((e) => String(e.wallet || "").toLowerCase())));
    })();
    return () => { alive = false; };
  }, [copiedTheses.length]);

  const leaders = useMemo(
    () => copyLeaders(copiedTheses, records ?? new Map(), ranked, names) as {
      wallet: string; name: string | null; copies: typeof copiedTheses; mine: { open: number; won: number; stopped: number; invalid: number };
      record: Rec; ranked: boolean; why: string | null;
    }[],
    [copiedTheses, records, ranked, names],
  );

  return (
    <div className="nx-stagger">
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 9, color: C.text.muted, fontFamily: MONO, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 5 }}>Follow</div>
        <div style={{ fontFamily: UI, fontSize: 24, fontWeight: 600, color: C.text.bright, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
          Copy Trades <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: C.text.muted, letterSpacing: "0.06em" }}>· {copiedTheses.length} copied</span>
        </div>
        <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, marginTop: 6, lineHeight: 1.5 }}>
          Each caller with their whole graded record, losses included, beside your copies of them.
        </div>
      </div>

      {copiedTheses.length === 0 ? (
        <EmptyState message="no copied calls yet" unlock="Hit COPY on any public call in the Feed and it lands here, beside the caller's whole graded record." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {leaders.map((l) => (
            <section key={l.wallet} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? "12px 12px 6px" : "14px 16px 8px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => navigate(`/feed/trader/${l.wallet}`)} className="nx-text-action"
                  style={{ fontFamily: UI, fontSize: 15, fontWeight: 600, color: C.text.bright, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  {l.name ?? `${l.wallet.slice(0, 6)}…${l.wallet.slice(-4)}`} ↗
                </button>
                {l.ranked && <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: C.canvas, background: C.accent, borderRadius: 3, padding: "1px 6px" }}>RANKED</span>}
              </div>
              <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, marginTop: 4 }}>
                {records ? `Whole record: ${recordLine(l.record)}` : "Reading their record…"}
              </div>
              {records && l.why && <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.muted, marginTop: 2 }}>{l.why}</div>}
              <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.muted, marginTop: 2, marginBottom: 6 }}>{mineLine(l.mine, l.copies.length)}</div>
              {l.copies.map((t) => {
                const ticker = bareTicker(t.symbol);
                const cfg = STATUS_CONFIG[effectiveStatus(t)] ?? STATUS_CONFIG.ACTIVE;
                const rr = callRR(t);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.border}`, flexWrap: isMobile ? "wrap" : "nowrap" }}>
                    <span style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, color: C.text.bright }}><CoinLink coin={ticker}>{ticker}</CoinLink></span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: C.text.fog, border: `1px solid ${C.borderStrong}`, borderRadius: 4, padding: "1px 6px" }}>{t.direction === "LONG" ? "↑ LONG" : "↓ SHORT"}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.text.muted, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {px(t.entryPrice)} → {px(t.takeProfit1)} · stop {px(t.stopLoss)} · {fmtRR(rr)}
                    </span>
                    {t.actualPnl !== null && t.actualPnl !== undefined && effectiveStatus(t) !== "ACTIVE" && (
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.actualPnl >= 0 ? C.pos : C.neg }}>{t.actualPnl >= 0 ? "+" : "−"}${Math.abs(t.actualPnl).toFixed(2)}</span>
                    )}
                    <span style={{ fontFamily: MONO, fontSize: 9.5, padding: "2px 8px", borderRadius: 3, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, flexShrink: 0 }}>{cfg.label}</span>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
