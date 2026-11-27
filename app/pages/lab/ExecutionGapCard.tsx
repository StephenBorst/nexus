// "Your run vs the read's own run" on the Agent tab (borst 2026-11-26, the moat list): for a PAPER agent running a
// registered read, GET /agent/:a/gap (rule app/lib/executionGap.mjs) pairs its trades with the read's reference run
// (its own paper wallet, else its keyless house run). Counts, the median entry gap in bps and the lag, a few recent
// pairs with both R's side by side. Never a sum of R, never green/red: it measures execution, not money.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { C } from "@/config/theme";
import { agentCardStyle, agentLabelStyle } from "./styles";
import { AGENT_API } from "./agentTypes";
import { axisForConfig } from "@/lib/paperParity.mjs";

type Pair = { coin: string; side: string; refOpenedAt: string; lagMin: number; entryBps: number | null; exitBps: number | null; refR: number | null; myR: number | null; refExit: string | null; myExit: string | null };
type Gap = { ok?: boolean; self?: boolean; unread?: boolean; read: string; refWallet: string; house?: boolean; matched?: number; refCount?: number; missed?: unknown[]; extra?: unknown[]; pairs?: Pair[]; line?: string | null; note?: string };

const fmtR = (r: number | null) => (r == null ? "open" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`);
const fmtBps = (b: number | null) => (b == null ? "—" : b === 0 ? "same" : `${b > 0 ? "+" : "−"}${Math.abs(b)} bps`);

export function ExecutionGapCard({ wallet, config }: { wallet: string | null | undefined; config: { mode?: string } & Record<string, unknown> }) {
  const read = config?.mode === "PAPER" ? axisForConfig(config) : null;
  const [gap, setGap] = useState<Gap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!wallet || !read) { setGap(null); return; }
    let live = true;
    const load = () => fetch(`${AGENT_API}/agent/${wallet}/gap`)
      .then((r) => r.json())
      .then((d: Gap) => { if (live) { if (d?.ok) { setGap(d); setFailed(false); } else setFailed(true); } })
      .catch(() => { if (live) setFailed(true); });
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => { live = false; clearInterval(id); };
  }, [wallet, read]);

  if (!wallet || !read || gap?.self) return null;
  const pairs = (gap?.pairs || []).slice(0, 5);
  return (
    <section aria-label="Your run vs the read's own run" style={{ ...agentCardStyle, marginBottom: 12 }}>
      <div style={{ ...agentLabelStyle }}>YOUR RUN VS THE READ’S OWN RUN</div>
      {!gap && !failed && <p style={{ margin: 0, fontFamily: "var(--nx-font-ui)", fontSize: 13, color: C.text.fog }}>Reading both runs…</p>}
      {failed && !gap && <p style={{ margin: 0, fontFamily: "var(--nx-font-ui)", fontSize: 13, color: C.text.fog }}>The comparison couldn’t be read right now.</p>}
      {gap && (
        <>
          <p style={{ margin: 0, fontFamily: "var(--nx-font-ui)", fontSize: 13, lineHeight: 1.55, color: C.text.bright }}>{gap.line}</p>
          {pairs.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 0 }}>
              {pairs.map((p) => (
                <div key={`${p.coin}-${p.refOpenedAt}`} style={{ padding: "7px 0", borderTop: `1px solid ${C.border}`, fontFamily: "var(--nx-font-mono)", fontSize: 11.5, lineHeight: 1.6, color: C.text.fog }}>
                  <div><span style={{ color: C.text.bright }}>{p.coin} {p.side}</span> · {p.lagMin === 0 ? "same minute" : `${Math.abs(p.lagMin)} min ${p.lagMin > 0 ? "later" : "earlier"}`} · entry {fmtBps(p.entryBps)}</div>
                  <div>theirs {fmtR(p.refR)} · yours {fmtR(p.myR)}</div>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: "10px 0 0", fontFamily: "var(--nx-font-ui)", fontSize: 12, lineHeight: 1.5, color: C.text.muted }}>
            {gap.note} + bps = your fill was worse.{" "}
            <Link to={`/proof/paper/${encodeURIComponent(gap.read)}`} style={{ color: C.text.fog }}>{gap.house ? "The house run" : "The read’s own run"} →</Link>
          </p>
        </>
      )}
    </section>
  );
}
