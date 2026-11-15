// VENUES (Lab home lens, 2026-11-15): the same coin's funding on Orderly, Hyperliquid and OKX, annualized the same way,
// biggest gap first. One request (GET /intel/funding-venues, 5 min cache); rules app/lib/crossFunding.mjs (tested).
// An input, not a trade: the note says why a gap isn't free. A tap on a coin opens its drawer.
import { useEffect, useState } from "react";
import { C, MONO, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { VENUE_NOTE } from "@/lib/crossFunding.mjs";
import { CoinLink } from "@/components/CoinLink";

const AGENT_API = "https://og.nexustradinglabs.com";
type Row = { coin: string; orderly: number; hyperliquid: number | null; okx: number | null; gap: number | null };
// Signed to one decimal; a value that rounds to 0.0 carries no sign.
const signed = (v: number) => { const t = Math.abs(v).toFixed(1); return t === "0.0" ? t : `${v > 0 ? "+" : "−"}${t}`; };
const cell = (v: number | null) => (v == null ? "—" : `${signed(v)}%`);

export function FundingVenues() {
  const isMobile = useIsMobile();
  const [board, setBoard] = useState<{ rows: Row[]; unread: string[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    sharedJson(`${AGENT_API}/intel/funding-venues`)
      .then((j) => { if (alive) { if (j?.rows) setBoard(j); else setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "8px 0" }}>Venue funding is unread right now.</div>;
  if (!board) return <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.faint, padding: "8px 0" }}>Reading Orderly, Hyperliquid and OKX…</div>;

  const compared = board.rows.filter((r) => r.gap != null);
  const shown = all ? compared : compared.slice(0, 10);
  const cols = isMobile ? "44px repeat(3, minmax(0, 1fr)) 50px" : "90px repeat(3, minmax(0, 1fr)) 110px";
  const head = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: C.text.muted, textTransform: "uppercase" as const };
  const num = { fontFamily: MONO, fontSize: isMobile ? 11.5 : 12.5, color: C.text.fog, textAlign: "right" as const, whiteSpace: "nowrap" as const };

  return (
    <div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, lineHeight: 1.5, marginBottom: 10 }}>
        Annual funding, + = longs pay. Gap = Orderly minus the other venues’ average.
        {board.unread.length ? <span style={{ color: C.text.muted }}> Unread right now: {board.unread.join(", ")}.</span> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: isMobile ? "0 4px" : "0 8px", padding: "0 0 6px", borderBottom: `1px solid ${C.border}` }}>
        <span style={head}>Coin</span>
        <span style={{ ...head, textAlign: "right" }}>Orderly</span>
        <span style={{ ...head, textAlign: "right" }}>{isMobile ? "HL" : "Hyperliquid"}</span>
        <span style={{ ...head, textAlign: "right" }}>OKX</span>
        <span style={{ ...head, textAlign: "right" }}>Gap</span>
      </div>
      {shown.length === 0 ? (
        <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "10px 0" }}>No other venue lists these markets right now.</div>
      ) : shown.map((r) => (
        <div key={r.coin} style={{ display: "grid", gridTemplateColumns: cols, gap: isMobile ? "0 4px" : "0 8px", alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.text.bright }}><CoinLink coin={r.coin}>{r.coin}</CoinLink></span>
          <span style={num}>{cell(r.orderly)}</span>
          <span style={num}>{cell(r.hyperliquid)}</span>
          <span style={num}>{cell(r.okx)}</span>
          <span style={{ ...num, color: Math.abs(r.gap ?? 0) >= 5 ? C.text.bright : C.text.muted, fontWeight: Math.abs(r.gap ?? 0) >= 5 ? 700 : 400 }}>{r.gap == null ? "—" : signed(r.gap)}</span>
        </div>
      ))}
      {compared.length > 10 && (
        <button type="button" onClick={() => setAll((v) => !v)} style={{ background: "none", border: "none", padding: "10px 0", minHeight: 40, cursor: "pointer", fontFamily: UI, fontSize: 13, color: C.text.muted }}>
          {all ? "Show fewer" : `Show all ${compared.length}`}
        </button>
      )}
      <div style={{ fontFamily: UI, fontSize: 12, color: C.text.muted, lineHeight: 1.5, marginTop: 8 }}>{VENUE_NOTE} Not graded.</div>
    </div>
  );
}

export default FundingVenues;
