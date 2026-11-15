import { useEffect, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { rankConviction, leanWord } from "@/lib/conviction.mjs";
import { fadeFamilyLine } from "@/lib/fadeGrade.mjs";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import { useFadeFamilyGrade } from "./useFadeFamilyGrade";

// ── STRETCHED FUNDING, market-wide (Smart Money) ─────────────────────────────
// Every market whose funding is stretched past the fade floor, with the other inputs beside it: smart money's lean,
// the graded callers' lean, and this market's own past fades. 2026-11-15 (house rule: inputs, never a tally or a
// crown): ordered by how stretched funding is, not by how many inputs agree; no conviction word; the plain fade's own
// live grade on top. A tap opens the coin's drawer (every lens + its grade); the trader picks any side there.
// Rules app/lib/conviction.mjs (shared with the copilot's get_conviction), tested.

const AGENT_API = "https://og.nexustradinglabs.com";

type Read = { label: string; ok: boolean; side?: "LONG" | "SHORT" };
type Row = { coin: string; direction: "LONG" | "SHORT"; fundingAnnualPct: number; reads: Read[]; revertedPct: number | null; samples: number | null; histWeak: boolean };

export function ConvictionScanner() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const fadeGrade = useFadeFamilyGrade();

  useEffect(() => {
    let off = false;
    const load = () => {
      Promise.all([
        sharedJson(`${AGENT_API}/intel/mispriced`).catch(() => null),
        sharedJson(`${AGENT_API}/smart/consensus`).catch(() => null),
        sharedJson(`${AGENT_API}/theses/consensus`).catch(() => null),
      ]).then(([mp, sm, cons]) => {
        if (!off) setRows(rankConviction(mp?.markets || [], sm?.consensus || {}, cons?.consensus || {}, 8) as Row[]);
      }).catch(() => { if (!off) setRows([]); });
    };
    load();
    const id = setInterval(load, 60000);
    return () => { off = true; clearInterval(id); };
  }, []);

  if (rows === null) return <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.faint, padding: "8px 0" }}>Reading the board…</div>;
  if (!rows.length) return null;
  const gradeLine = fadeFamilyLine(fadeGrade);

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: C.text.bright }}>◆ STRETCHED FUNDING</span>
        <span style={{ fontFamily: UI, fontSize: 12, color: C.text.muted }}>with smart money and the graded callers beside it</span>
      </div>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.fog, lineHeight: 1.5, marginBottom: 8 }}>
        {gradeLine ?? "The plain funding fade's grade is unread right now."} Inputs side by side, not a verdict.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((r) => {
          const f = r.fundingAnnualPct;
          const others = r.reads.filter((rd) => rd.label !== "funding" && rd.side);
          return (
            <button key={r.coin} type="button" onClick={() => openMarket(r.coin)}
              style={{ appearance: "none", WebkitAppearance: "none", display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", minHeight: 44 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.text.bright, minWidth: 52 }}>{r.coin}</span>
                <span style={{ fontFamily: UI, fontSize: 12.5, color: C.text.fog }}>{f > 0 ? "Longs" : "Shorts"} pay {Math.abs(f).toFixed(1)}%/yr</span>
                <span aria-hidden style={{ marginLeft: "auto", fontFamily: UI, fontSize: 12, color: C.text.muted }}>Read →</span>
              </span>
              <span style={{ display: "block", fontFamily: UI, fontSize: 12, color: C.text.muted, marginTop: 3, lineHeight: 1.5 }}>
                {others.length ? others.map((rd) => leanWord(rd)).join(" · ") : "No smart-money or caller lean on it."}
                {r.revertedPct != null && r.samples
                  ? <> · <span style={{ color: r.histWeak ? SIGNAL.watch : C.text.muted }}>past fades here reverted {r.revertedPct}% of {r.samples}</span></>
                  : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ConvictionScanner;
