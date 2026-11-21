// Thesis Engine: one-tap starting points before a coin is picked, and the facts before Post (borst 2026-11-21).
// Rules app/lib/callStart.mjs. A chip fills the symbol only: the side stays the trader's pick.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { readWatch } from "@/lib/watchStore";
import { startingPoints, prePostFacts } from "@/lib/callStart.mjs";

const API = "https://og.nexustradinglabs.com";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;

type Group = { key: string; title: string; note: string; chips: { coin: string; fact: string }[] };

export function CallStarts({ listed, onPick }: { listed: string[] | null; onPick: (coin: string) => void }) {
  const [markets, setMarkets] = useState<unknown[] | null>(null);
  const [openCalls, setOpenCalls] = useState<unknown[] | null>(null);
  const [watch] = useState<string[]>(() => { try { return readWatch().coins; } catch { return []; } });
  useEffect(() => {
    let off = false;
    sharedJson(`${API}/intel/mispriced`).then((d: { markets?: unknown[] } | null) => { if (!off) setMarkets(Array.isArray(d?.markets) ? d!.markets : []); });
    sharedJson(`${API}/calls/pulse`).then((d: { openCalls?: unknown[]; engines?: { openCalls?: unknown[] } } | null) => {
      if (!off) setOpenCalls([...(d?.openCalls ?? []), ...((d?.engines?.openCalls ?? []).map((c) => ({ ...(c as object), engine: true })))]);
    });
    return () => { off = true; };
  }, []);
  const groups = useMemo(() => startingPoints({
    watch, markets: (markets ?? []) as never[], openCalls: (openCalls ?? []) as never[], listed: listed && listed.length ? listed : null,
  }) as Group[], [watch, markets, openCalls, listed]);
  if (!groups.length) return null;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: UI, fontSize: 12, color: MUTED }}>Start from a coin. You pick the side.</div>
      {groups.map((g) => (
        <div key={g.key}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }} title={g.note}>{g.title}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {g.chips.map((c) => (
              <button key={c.coin} type="button" onClick={() => onPick(c.coin)} title={g.note}
                style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "7px 11px", minHeight: 36, borderRadius: 999, border: `1px solid ${C.border}`, background: C.canvas, cursor: "pointer", fontFamily: UI }}>
                <span style={{ fontSize: 13, color: BRIGHT, fontWeight: 600 }}>{c.coin}</span>
                <span style={{ fontSize: 11.5, color: FOG }}>{c.fact}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type Fact = { key: string; text: string; watch: boolean };

export function PrePostFacts(p: Parameters<typeof prePostFacts>[0]) {
  const facts = prePostFacts(p) as Fact[];
  if (!facts.length) return null;
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.canvas }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", color: MUTED, marginBottom: 6 }}>BEFORE YOU POST · FACTS, NOT ADVICE</div>
      {facts.map((f) => (
        <div key={f.key} style={{ fontFamily: UI, fontSize: 12.5, lineHeight: 1.5, color: f.watch ? SIGNAL.watch : FOG, padding: "2px 0" }}>
          {f.watch ? "⚠ " : ""}{f.text}
        </div>
      ))}
    </div>
  );
}
