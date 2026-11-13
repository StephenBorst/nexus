// ── /ops/preflight — the $10 live mechanics test, line by line ─────────────────────────────────────────
// borst, 2026-11-13: a read-only page that confirms the safety stop, the pause switch and the one-wallet
// permission before the $10 test (live-money-review.md, step 0). Data: GET /agent/:a/preflight (rule
// app/lib/livePreflight.mjs). It reads; it places, moves and cancels nothing. noindex, not in the nav.
// Wallet = ?wallet=0x…, else the connected one. Re-reads every 15 s while open.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useLabWallet } from "@/hooks/useLabAuth";
import { useIsMobile } from "@/pages/lab/useIsMobile";

const API = "https://og.nexustradinglabs.com";
const POLL_MS = 15_000;

type Check = { id: string; status: "PASS" | "FAIL" | "WAIT" | "INFO"; line: string };
type Report = { ok?: boolean; error?: string; asOf: string; wallet: string; ready: boolean; step: "ENTRY" | "KILL"; next: string; checks: Check[]; note: string };

const LABEL: Record<string, string> = {
  exec: "Agent worker", halt: "Pause switch", kill: "Kill switch", config: "Agent", key: "Trading key", lift: "One-wallet permission",
  backstop: "Safety stop (backstop)", cleanup: "Backstop cleanup", backstop_hit: "Last exchange stop", live_tape: "Live fills on the tape", slippage: "Live slippage",
};
// Not money: no green or red. Bone = pass, amber (caution) = fail, the rest muted.
const MARK: Record<Check["status"], { mark: string; color: string }> = {
  PASS: { mark: "✓", color: C.text.bright },
  FAIL: { mark: "✕", color: SIGNAL.watch },
  WAIT: { mark: "…", color: C.text.fog },
  INFO: { mark: "·", color: C.text.muted },
};

const STEPS = [
  "Dedicated wallet, ~$10 risk, AUTONOMOUS on a single-entry config (not DCA). Every line above reads PASS or WAIT.",
  "The entry fills. Reload: the safety stop line reads PASS with its trigger. On Orderly, Orders → TP/SL shows the same stop.",
  "Tap KILL in the Lab. The position closes; on Orderly the TP/SL is gone; the cleanup line reads PASS.",
  "Write the date and what you saw in the plan’s PR. It proves the plumbing, not an edge.",
];

export default function PreflightPage() {
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const address = useLabWallet()?.address ?? null;
  const wallet = String(params.get("wallet") || address || "").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(wallet);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const read = async () => {
      try {
        const res = await fetch(`${API}/agent/${wallet}/preflight`, { cache: "no-store" });
        const d = (await res.json()) as Report;
        if (!alive) return;
        if (!res.ok || !d?.ok) { setFailed(true); return; }
        setReport(d); setFailed(false);
      } catch { if (alive) setFailed(true); }
    };
    void read();
    const id = setInterval(() => { void read(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [wallet, valid]);

  const pad = isMobile ? 16 : 32;
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: `${isMobile ? 24 : 40}px ${pad}px 64px`, fontFamily: UI, color: C.text.bright }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: C.text.fog, marginBottom: 12 }}>Ops · Live preflight</div>
      <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 34, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
        The $10 mechanics test.
        <span style={{ display: "block", color: C.text.fog }}>Plumbing, not an edge.</span>
      </h1>

      {!valid && <p style={{ color: C.text.fog, fontSize: 15, marginTop: 18 }}>Connect the dedicated wallet, or open this page with ?wallet=0x… to read one.</p>}
      {valid && !report && !failed && <p style={{ color: C.text.fog, fontSize: 15, marginTop: 18 }}>Reading {wallet.slice(0, 6)}…{wallet.slice(-4)}…</p>}
      {valid && failed && !report && <p style={{ color: C.text.fog, fontSize: 15, marginTop: 18 }}>The preflight couldn’t be read right now. Nothing is shown rather than a guess.</p>}

      {report && (
        <>
          <p style={{ margin: "18px 0 0", fontSize: 15, lineHeight: 1.6 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: report.ready ? C.text.bright : SIGNAL.watch }}>{report.ready ? "READY" : "NOT READY"}</span>
            <span style={{ color: C.text.fog }}> · {report.next}</span>
          </p>
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}` }}>
            {report.checks.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.border}`, alignItems: "baseline" }}>
                <span style={{ fontFamily: MONO, fontSize: 13, width: 18, flexShrink: 0, color: MARK[c.status].color }}>{MARK[c.status].mark}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text.fog }}>
                    {LABEL[c.id] || c.id} · <span style={{ color: MARK[c.status].color }}>{c.status}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.55, color: c.status === "INFO" ? C.text.fog : C.text.bright, overflowWrap: "anywhere" }}>{c.line}</div>
                </div>
              </div>
            ))}
          </div>

          <section style={{ marginTop: 28 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: C.text.fog, marginBottom: 10 }}>The test, step by step</div>
            <ol style={{ margin: 0, paddingLeft: 18, color: C.text.fog, fontSize: 14, lineHeight: 1.7 }}>
              {STEPS.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </section>

          <p style={{ margin: "18px 0 0", color: C.text.muted, fontSize: 12.5, lineHeight: 1.6 }}>
            {report.note} Read {new Date(report.asOf).toISOString().slice(11, 19)} UTC, every 15 s.{" "}
            <a href={`${API}/agent/${report.wallet}/preflight`} target="_blank" rel="noopener noreferrer" style={{ color: C.text.fog }}>The raw read (JSON)</a>
          </p>
        </>
      )}
    </main>
  );
}
