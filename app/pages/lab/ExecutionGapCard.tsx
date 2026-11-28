// "Your run vs the read's own run" (borst 2026-11-26, the moat list; numbers only 2026-11-28). For a wallet whose PAPER agent
// runs a registered read, GET /agent/:a/gap (rule app/lib/executionGap.mjs) pairs its trades with the read's own run (its
// paper wallet, else its keyless house run). Shown on the Agent tab, on that read's Shelf card (compact) and on that
// read's /proof/paper page. Each run as n of 30, paired / missed / extra, medians only from 5 pairs, each pair's R's side
// by side. No mean R, no beat-random before a run's 30-trade verdict, no comparative words, never green/red.
// The card renders only when the wallet's run IS this read (gap.read === read) and it isn't the read's own wallet.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { C } from "@/config/theme";
import { agentCardStyle, agentLabelStyle } from "./styles";
import { AGENT_API } from "./agentTypes";
import { NO_STAGE_LINE, GAP_SIGN_LINE } from "@/lib/executionGap.mjs";

type Pair = { coin: string; side: string; refOpenedAt: string; lagMin: number; entryBps: number | null; exitBps: number | null; refR: number | null; myR: number | null; refExit: string | null; myExit: string | null };
type Run = { count: number; target: number };
export type Gap = {
  ok?: boolean; self?: boolean; unread?: boolean; read: string; refWallet: string; house?: boolean; matched?: number; refCount?: number;
  missed?: unknown[]; extra?: unknown[]; pairs?: Pair[]; line?: string | null; note?: string; runs?: { mine: Run; ref: Run };
};

const UI = "var(--nx-font-ui)";
const MONO = "var(--nx-font-mono)";
const signed = (x: number, unit: string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x)}${unit}`;
const fmtR = (r: number | null) => (r == null ? "open" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`);
const fmtBps = (b: number | null) => (b == null ? "—" : signed(b, " bps"));

/** One read of GET /agent/:wallet/gap (re-read every 5 min). null = none or not this wallet's read; "failed" = unread. */
export function useExecutionGap(wallet: string | null | undefined, enabled = true): Gap | null | "failed" | undefined {
  const [gap, setGap] = useState<Gap | null | "failed" | undefined>(undefined);
  useEffect(() => {
    if (!wallet || !enabled) { setGap(null); return; }
    let live = true;
    const load = () => fetch(`${AGENT_API}/agent/${wallet}/gap`)
      .then((r) => r.json().then((d: Gap & { error?: string }) => ({ status: r.status, d })))
      .then(({ status, d }) => { if (!live) return; if (d?.ok) setGap(d); else setGap(status === 400 || status === 404 ? null : "failed"); })
      .catch(() => { if (live) setGap("failed"); });
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => { live = false; clearInterval(id); };
  }, [wallet, enabled]);
  return gap;
}

function Runs({ gap }: { gap: Gap }) {
  if (!gap.runs) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", fontFamily: MONO, fontSize: 11.5, color: C.text.fog }}>
      <span>Your run <span style={{ color: C.text.bright }}>{gap.runs.mine.count}</span> of {gap.runs.mine.target}</span>
      <span>Its own run <span style={{ color: C.text.bright }}>{gap.runs.ref.count}</span> of {gap.runs.ref.target}</span>
    </div>
  );
}

/**
 * @param read the read this surface is about; the card shows only when the wallet's own run is that read.
 * @param compact the Shelf card's version: counts + the line + the no-stage line, no pair list.
 */
export function ExecutionGapCard({ wallet, read, compact = false, gap: given }: { wallet: string | null | undefined; read: string | null; compact?: boolean; gap?: Gap | null | "failed" }) {
  const fetched = useExecutionGap(wallet, given === undefined && !!read);
  const gap = given !== undefined ? given : fetched;
  if (!wallet || !read || gap === undefined || gap === null) return null;
  if (gap !== "failed" && (gap.self || gap.read !== read)) return null;
  const g = gap === "failed" ? null : gap;
  const pairs = (g?.pairs || []).slice(0, 5);
  const runLink = g ? <Link to={`/proof/paper/${encodeURIComponent(g.read)}`} style={{ color: C.text.fog }}>{g.house ? "The read’s house run" : "The read’s own run"} →</Link> : null;

  if (compact) {
    return (
      <div aria-label="Your run of this read" style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "grid", gap: 4 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", color: C.text.muted }}>YOUR RUN OF THIS READ</span>
        {g ? (
          <>
            <Runs gap={g} />
            <span style={{ fontFamily: UI, fontSize: 11.5, lineHeight: 1.45, color: C.text.fog }}>{g.line}</span>
            <span style={{ fontFamily: UI, fontSize: 11, lineHeight: 1.4, color: C.text.muted }}>{NO_STAGE_LINE}</span>
          </>
        ) : <span style={{ fontFamily: UI, fontSize: 11.5, color: C.text.fog }}>Couldn’t read your run right now.</span>}
      </div>
    );
  }

  return (
    <section aria-label="Your run vs the read's own run" style={{ ...agentCardStyle, marginBottom: 12 }}>
      <div style={{ ...agentLabelStyle }}>YOUR RUN VS THE READ’S OWN RUN</div>
      {!g && <p style={{ margin: 0, fontFamily: UI, fontSize: 13, color: C.text.fog }}>The comparison couldn’t be read right now.</p>}
      {g && (
        <>
          <Runs gap={g} />
          <p style={{ margin: "8px 0 0", fontFamily: UI, fontSize: 13, lineHeight: 1.55, color: C.text.bright }}>{g.line}</p>
          {pairs.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 0 }}>
              {pairs.map((p) => (
                <div key={`${p.coin}-${p.refOpenedAt}`} style={{ padding: "7px 0", borderTop: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: C.text.fog }}>
                  <div><span style={{ color: C.text.bright }}>{p.coin} {p.side}</span> · lag {signed(p.lagMin, " min")} · entry gap {fmtBps(p.entryBps)}</div>
                  <div>its own run {fmtR(p.refR)} · yours {fmtR(p.myR)}</div>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: "10px 0 0", fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: C.text.muted }}>
            {NO_STAGE_LINE} {g.note} {GAP_SIGN_LINE} {runLink}
          </p>
        </>
      )}
    </section>
  );
}
