// ── /ops/revenue — where Nexus's money sits, for the owner only ─────────────────────────────────
// The worker (POST /ops/revenue, workers/nexus-lab-api/routes-revenue.mjs) reads every revenue wallet,
// the NEAR Intents fee balance and the treasury Safe, and answers only a Safe owner (or an
// OPS_WALLETS address) who signed the Lab message. This page reads; it moves nothing. Sweeps stay
// in the wallet. noindex, and not in the nav.
// The one control here is the live-entry pause (POST /ops/halt, app/lib/liveHalt.mjs): it stops live
// agents opening new positions. It closes nothing and moves nothing.
import { useCallback, useEffect, useState } from "react";
import { C, MONO, UI, S, RADIUS, SIGNAL } from "@/config/theme";
import { getLabAuth, useLabWallet, clearLabAuth } from "@/hooks/useLabAuth";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { Button } from "@/components/ui";
import { signLiveHalt } from "@/lib/liveHalt.mjs";

const API = "https://og.nexustradinglabs.com";

type Row = { key: string; sym: string; chain: string; amount: number | null; usd: number | null; change?: Record<string, number | null> };
type Group = { id: string; label: string; note: string; address: string; rows: Row[]; usd: number; unread: number; change?: Record<string, number | null> };
type Revenue = {
  at: number;
  prices: Record<string, number | null>;
  groups: Group[];
  elsewhere: { label: string; where: string; url: string }[];
  totals: { notSwept: number; treasury: number };
  history?: { since: string | null; compareDays: Record<string, string | null> };
  spot?: { days: number; total: Record<string, { trades: number; feeUsd: number; notionalUsd: number }>; rows: { day: string; routes: Record<string, { trades: number }> }[] };
};

// Spot ledger routes (workers/nexus-lab-api/spotLedger.mjs). What each count proves.
const SPOT_ROUTES: { id: string; label: string; note: string }[] = [
  { id: "flash", label: "Flash", note: "orders filled · fee from Flash's fills" },
  { id: "spandex", label: "spanDEX", note: "EVM swaps · receipt checked" },
  { id: "jupiter", label: "Jupiter", note: "Solana swaps · confirmation checked" },
  { id: "near", label: "NEAR Intents", note: "cross-chain · 1Click SUCCESS checked" },
  { id: "woofi", label: "WooFi", note: "widget OPENS, not trades (it reports no fills)" },
];

const CHAIN: Record<string, string> = { arb: "Arbitrum", base: "Base", eth: "Ethereum", sol: "Solana", btc: "Bitcoin" };
const EXPLORER: Record<string, string> = { arb: "https://arbiscan.io/address/", base: "https://basescan.org/address/" };

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (n: number | null) =>
  n == null ? "unread" : n === 0 ? "0" : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Number(n.toPrecision(4)).toString();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Change({ v, money = true }: { v: number | null | undefined; money?: boolean }) {
  if (v == null) return <span style={{ color: C.text.faint }}>—</span>;
  if (Math.abs(v) < (money ? 0.005 : 1e-9)) return <span style={{ color: C.text.muted }}>0</span>;
  const sign = v > 0 ? "+" : "−";
  const abs = Math.abs(v);
  return (
    <span style={{ color: v > 0 ? C.pos : C.neg }}>
      {sign}{money ? usd(abs) : amt(abs)}
    </span>
  );
}

type Halt = { halted: boolean; since?: number | null; reason?: string };

// Live-entry pause. Each switch is its own signature (5 minutes), checked against the Safe's owners.
function HaltBox({ address, wallet, box, label }: { address: string; wallet: ReturnType<typeof useLabWallet>; box: React.CSSProperties; label: React.CSSProperties }) {
  const [halt, setHalt] = useState<Halt | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API}/ops/halt`).then((r) => r.json()).then((j) => { if (live) setHalt(j as Halt); }).catch(() => { if (live) setMsg("Couldn’t read the switch."); });
    return () => { live = false; };
  }, []);

  const flip = async (on: boolean) => {
    setBusy(true);
    setMsg("");
    try {
      const signed = await signLiveHalt(address, wallet, on);
      const r = await fetch(`${API}/ops/halt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signed, reason: on ? reason : undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403) setMsg(j.ownersRead === false ? "Couldn’t read the Safe’s owners right now. Try again in a minute." : "This wallet isn’t an owner of the treasury Safe.");
      else if (!r.ok) setMsg(j.error || `HTTP ${r.status}`);
      else { setHalt(j as Halt); setReason(""); }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const on = !!halt?.halted;
  return (
    <div style={{ ...box, marginBottom: S.lg, borderColor: on ? SIGNAL.watch : C.border }}>
      <div style={label}>Live agent entries</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: S.xs, color: on ? SIGNAL.watch : C.text.bright }}>
        {halt == null ? "Reading…" : on ? "Paused" : "Running"}
      </div>
      <div style={{ fontSize: 12, color: C.text.fog, marginTop: S.xs, lineHeight: 1.5 }}>
        {on
          ? <>No live agent opens a new position. Open positions keep their exits. Paper agents keep running.{halt?.since ? ` Since ${new Date(halt.since).toUTCString().slice(5, 22)} UTC.` : ""}{halt?.reason ? ` Reason: ${halt.reason}` : ""}</>
          : "Pausing stops every live agent opening new positions. Open positions keep their exits. Paper agents keep running. Nothing closes."}
      </div>
      {halt != null && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: S.sm, marginTop: S.md, alignItems: "center" }}>
          {!on && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={140}
              placeholder="Reason (shown to users)"
              aria-label="Reason for the pause"
              style={{ flex: "1 1 220px", minWidth: 0, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.text.bright, fontFamily: UI, fontSize: 13, padding: `${S.xs}px ${S.sm}px` }}
            />
          )}
          <Button variant={on ? "primary" : "secondary"} disabled={busy} onClick={() => flip(!on)}>
            {busy ? "Signing…" : on ? "Resume live entries" : "Pause live entries"}
          </Button>
        </div>
      )}
      {msg && <div style={{ marginTop: S.sm, fontSize: 12, color: C.warn }}>{msg}</div>}
    </div>
  );
}

export default function RevenuePage() {
  const wallet = useLabWallet();
  const isMobile = useIsMobile();
  const address = wallet?.address?.toLowerCase() || null;
  const [rev, setRev] = useState<Revenue | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "denied" | "error">("idle");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (!address) return;
    setState("loading");
    setMsg("");
    const labAuth = await getLabAuth(address, wallet, "explicit", { onError: setMsg });
    if (!labAuth) { setState("error"); return; }
    try {
      const r = await fetch(`${API}/ops/revenue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, labAuth, refresh }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { clearLabAuth(address); setState("error"); setMsg("Signature not accepted. Sign again."); return; }
      if (r.status === 403) {
        setState("denied");
        setMsg(j.ownersRead === false
          ? "Couldn't read the Safe's owners right now. Try again in a minute."
          : "This wallet isn't an owner of the treasury Safe.");
        return;
      }
      if (!r.ok) { setState("error"); setMsg(j.error || `HTTP ${r.status}`); return; }
      setRev(j as Revenue);
      setState("idle");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [address, wallet]);

  const box = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: S.lg } as const;
  const label = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: C.text.muted, textTransform: "uppercase" } as const;

  const week = rev?.history?.compareDays?.["7"];
  const month = rev?.history?.compareDays?.["30"];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: `${S.xl}px ${S.lg}px ${S.huge}px`, fontFamily: UI, color: C.text.bright }}>
      <div style={{ borderTop: `3px solid ${C.brand}`, paddingTop: S.md, marginBottom: S.xl }}>
        <div style={label}>{"// OPS · REVENUE"}</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: `${S.sm}px 0 ${S.xs}px` }}>Where the money sits</h1>
        <div style={{ fontSize: 13, color: C.text.fog, lineHeight: 1.5 }}>
          Every revenue wallet, the NEAR Intents fee balance and the treasury Safe. Read from the chain. Nothing moves from here.
        </div>
      </div>

      {!address && <div style={{ ...box, color: C.text.fog, fontSize: 13 }}>Connect the wallet that owns the treasury Safe.</div>}

      {address && <HaltBox address={address} wallet={wallet} box={box} label={label} />}

      {address && !rev && (
        <div style={{ ...box, display: "flex", flexDirection: isMobile ? "column" : "row", gap: S.md, alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, color: C.text.fog }}>
            Sign once to open it. Owners of the treasury Safe only. <span style={{ fontFamily: MONO, color: C.text.muted }}>{short(address)}</span>
          </div>
          <Button variant="primary" disabled={state === "loading"} onClick={() => load(false)}>
            {state === "loading" ? "Reading…" : "Sign to view"}
          </Button>
        </div>
      )}

      {msg && <div style={{ marginTop: S.md, fontSize: 12, color: state === "denied" ? C.text.fog : C.warn }}>{msg}</div>}

      {rev && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: S.md, marginBottom: S.lg }}>
            <div style={box}>
              <div style={label}>Not swept yet</div>
              <div style={{ fontFamily: MONO, fontSize: 22, marginTop: S.xs }}>{usd(rev.totals.notSwept)}</div>
              <div style={{ fontSize: 11, color: C.text.faint, marginTop: S.xs }}>Revenue wallets + NEAR Intents, priced holdings only.</div>
            </div>
            <div style={box}>
              <div style={label}>Treasury Safe</div>
              <div style={{ fontFamily: MONO, fontSize: 22, marginTop: S.xs }}>{usd(rev.totals.treasury)}</div>
              <div style={{ fontSize: 11, color: C.text.faint, marginTop: S.xs }}>USDC, ETH and $NEXUS on Arbitrum + Base.</div>
            </div>
            <div style={box}>
              <div style={label}>Read</div>
              <div style={{ fontFamily: MONO, fontSize: 13, marginTop: S.xs, color: C.text.fog }}>{new Date(rev.at).toUTCString().slice(5, 22)} UTC</div>
              <div style={{ fontSize: 11, color: C.text.faint, marginTop: S.xs }}>
                {rev.history?.since ? `Daily snapshots since ${rev.history.since}.` : "First snapshot today."}
              </div>
              <Button size="sm" style={{ marginTop: S.sm }} disabled={state === "loading"} onClick={() => load(true)}>
                {state === "loading" ? "Reading…" : "Read again"}
              </Button>
            </div>
          </div>

          <div style={{ fontSize: 11, color: C.text.faint, marginBottom: S.md, fontFamily: MONO }}>
            Prices: ETH {usd(rev.prices.ETH)} · SOL {usd(rev.prices.SOL)} · BTC {usd(rev.prices.BTC)} · $NEXUS {rev.prices.NEXUS ? `$${Number(rev.prices.NEXUS).toPrecision(3)}` : "—"}
            {" · "}Changes vs {week || "— (7d)"} / {month || "— (30d)"}. A sweep shows as a drop in its wallet and a rise in the Safe.
          </div>

          {rev.groups.map((g) => (
            <div key={g.id} style={{ ...box, marginBottom: S.md }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: S.sm, justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{g.label}</div>
                  <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>{g.note}</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: MONO }}>
                  <div style={{ fontSize: 16 }}>{usd(g.usd)}</div>
                  <div style={{ fontSize: 11 }}>
                    <span style={{ color: C.text.faint }}>7d </span><Change v={g.change?.["7"]} />
                    <span style={{ color: C.text.faint }}> · 30d </span><Change v={g.change?.["30"]} />
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.faint, margin: `${S.sm}px 0` }}>
                {g.id === "near"
                  ? <a href="https://near-intents.org" target="_blank" rel="noreferrer" style={{ color: C.text.fog }}>{short(g.address)} · intents.near ↗</a>
                  : <>
                      <a href={`${EXPLORER.arb}${g.address}`} target="_blank" rel="noreferrer" style={{ color: C.text.fog }}>{short(g.address)} · Arbiscan ↗</a>
                      {" · "}
                      <a href={`${EXPLORER.base}${g.address}`} target="_blank" rel="noreferrer" style={{ color: C.text.fog }}>Basescan ↗</a>
                    </>}
                {g.unread > 0 && <span style={{ color: SIGNAL.watch }}> · {g.unread} not readable right now</span>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 460 }}>
                  {g.rows.filter((r) => r.amount !== 0 || (r.change?.["7"] ?? 0) !== 0 || (r.change?.["30"] ?? 0) !== 0).map((r) => (
                    <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.9fr 0.9fr", gap: S.sm, padding: `${S.xs}px 0`, borderTop: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 12 }}>
                      <span>{r.sym} <span style={{ color: C.text.faint }}>{CHAIN[r.chain] || r.chain}</span></span>
                      <span style={{ textAlign: "right", color: r.amount == null ? C.text.faint : C.text.bright }}>{amt(r.amount)}</span>
                      <span style={{ textAlign: "right", color: C.text.fog }}>{usd(r.usd)}</span>
                      <span style={{ textAlign: "right" }}><Change v={r.change?.["7"]} money={false} /></span>
                      <span style={{ textAlign: "right" }}><Change v={r.change?.["30"]} money={false} /></span>
                    </div>
                  ))}
                  {g.rows.every((r) => r.amount === 0) && (
                    <div style={{ padding: `${S.xs}px 0`, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.text.faint }}>Empty.</div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {rev.spot && (
            <div style={{ ...box, marginTop: S.lg }}>
              <div style={label}>Spot · last {rev.spot.days} days</div>
              <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>
                Counted only once the chain proves it. Since the ledger shipped (2026-10-28); earlier trades aren’t here.
              </div>
              <div style={{ overflowX: "auto", marginTop: S.sm }}>
                <div style={{ minWidth: 460 }}>
                  {SPOT_ROUTES.map((r) => {
                    const t = rev.spot?.total[r.id];
                    const week = (rev.spot?.rows || []).slice(0, 7).reduce((n, d) => n + (d.routes[r.id]?.trades || 0), 0);
                    return (
                      <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.7fr 1fr 1fr", gap: S.sm, padding: `${S.xs}px 0`, borderTop: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 12, alignItems: "baseline" }}>
                        <span>{r.label} <span style={{ color: C.text.faint, fontFamily: UI, fontSize: 11 }}>{r.note}</span></span>
                        <span style={{ textAlign: "right" }}><span style={{ color: C.text.faint }}>7d </span>{week}</span>
                        <span style={{ textAlign: "right" }}><span style={{ color: C.text.faint }}>30d </span>{t?.trades ?? 0}</span>
                        <span style={{ textAlign: "right", color: C.text.fog }}>{r.id === "flash" && t ? `${usd(t.notionalUsd)} vol` : ""}</span>
                        <span style={{ textAlign: "right" }}>{r.id === "flash" && t ? `${usd(t.feeUsd)} fee` : ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div style={{ ...box, marginTop: S.lg }}>
            <div style={label}>Not read here</div>
            {rev.elsewhere.map((e) => (
              <div key={e.label} style={{ fontSize: 13, marginTop: S.sm }}>
                {e.label} <span style={{ color: C.text.muted }}>· {e.where} </span>
                <a href={e.url} target="_blank" rel="noreferrer" style={{ color: C.text.fog, fontSize: 12 }}>Open ↗</a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

