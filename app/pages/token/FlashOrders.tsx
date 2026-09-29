// ── Flash orders — the connected wallet's Flash orders on the Spot terminal ─────────────
// Lists what Flash holds for this wallet (open first, then recent), cancels an open order with a
// gasless personal_sign of Flash's exact cancel text, and shows the wallet's standing approvals
// to the Flash contract for this page's token + USDC with a one-tap revoke (approve 0): the
// on-chain off switch that works even if Definitive's servers don't. Read-only until you tap.
import { useCallback, useEffect, useState } from "react";
import { EVM_USDC, ensureChain } from "./swapExec";
import { describeFlashOrder, sortFlashOrders } from "@/lib/flashOrders.mjs";
import { encodeApprove, FLASH_ALLOWANCE } from "@/lib/flashGuards.mjs";
import { FLASH_CHANGED, fetchRecentOrders, cancelOrder, erc20Allowance, human, type Eip1193 } from "./flashApi";

const MONO = "var(--nx-font-mono)", UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUT = "#71717a", FAINT = "#52525b", BORD = "#232327", POS = "#3ecf8e", NEG = "#f7525f";
const CLOSED_SHOWN = 4;
const MAX_UINT = 2n ** 256n - 1n;

type Allow = { sym: string; token: string; amount: bigint; decimals: number };

export function FlashOrders({ chainId, tokenAddress, symbol, walletAddress, provider }: {
  chainId: string; tokenAddress: string; symbol: string;
  walletAddress?: string | null; provider?: Eip1193 | null;
}) {
  const usdc = EVM_USDC[chainId];
  const [orders, setOrders] = useState<Record<string, unknown>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [allows, setAllows] = useState<Allow[] | null>(null);
  const [allowNote, setAllowNote] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    if (!walletAddress) return;
    try {
      const rows = (await fetchRecentOrders(walletAddress, fresh)) as Record<string, unknown>[];
      setOrders(sortFlashOrders(rows)); setErr(null);
    } catch (e) { setErr((e as Error)?.message || "couldn’t load"); }
  }, [walletAddress]);

  // Load on mount / wallet change, when the ticket places or cancels, and every 30 s while the
  // panel is expanded and the tab is visible (Flash allows 5 req/s per endpoint on our key).
  useEffect(() => { setOrders(null); setAllows(null); void load(); }, [load]);
  useEffect(() => {
    const h = () => { void load(true); };
    window.addEventListener(FLASH_CHANGED, h);
    return () => window.removeEventListener(FLASH_CHANGED, h);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30000);
    return () => clearInterval(t);
  }, [open, load]);

  if (!usdc || !walletAddress || !provider) return null;
  const rows = orders || [];
  const live = rows.filter((o) => describeFlashOrder(o).open);
  const closed = rows.filter((o) => !describeFlashOrder(o).open).slice(0, CLOSED_SHOWN);
  if (orders && rows.length === 0 && !open) return null; // nothing on Flash for this wallet: stay out of the way

  const cancel = async (id: string) => {
    setBusyId(id); setNote(null);
    try {
      const r = await cancelOrder(provider, walletAddress, id);
      setNote(r === "filled" ? "It filled before the cancel landed." : "Cancelled. No gas spent.");
      window.dispatchEvent(new Event(FLASH_CHANGED));
    } catch (e) { setNote((e as Error)?.message || "Cancel failed."); }
    finally { setBusyId(null); }
  };

  // Standing approvals: read on the page's chain only (the wallet RPC answers for its current
  // chain), after the user asks — switching networks is theirs to approve.
  const checkAllowances = async () => {
    setAllowNote(null);
    try {
      await ensureChain(provider, usdc.chainId);
      const decOf = async (t: string) => Number(BigInt((await provider.request({ method: "eth_call", params: [{ to: t, data: "0x313ce567" }, "latest"] })) as string));
      const list: Allow[] = [];
      for (const [sym, token] of [[usdc.sym, usdc.usdc], [symbol, tokenAddress]] as const) {
        if (list.some((a) => a.token.toLowerCase() === token.toLowerCase())) continue;
        const amount = await erc20Allowance(provider, token, walletAddress, FLASH_ALLOWANCE);
        list.push({ sym, token, amount, decimals: await decOf(token) });
      }
      setAllows(list);
    } catch (e) { setAllowNote((e as Error)?.message || "Couldn’t read approvals."); }
  };
  const revoke = async (a: Allow) => {
    setAllowNote(null); setBusyId(a.token);
    try {
      await ensureChain(provider, usdc.chainId);
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: walletAddress, to: a.token, data: encodeApprove(FLASH_ALLOWANCE, 0n), value: "0x0" }] })) as string;
      setAllowNote(`Revoke sent (${hash.slice(0, 10)}…). Open orders spending ${a.sym} can’t fill until you approve again.`);
      setTimeout(() => { void checkAllowances(); }, 6000);
    } catch (e) { setAllowNote((e as Error)?.message || "Revoke failed."); }
    finally { setBusyId(null); }
  };

  const btn = (color: string): React.CSSProperties => ({ fontFamily: UI, fontSize: 12, fontWeight: 600, color, background: "none", border: `1px solid ${BORD}`, borderRadius: 15, padding: "4px 11px", cursor: "pointer", flexShrink: 0 });
  const Row = ({ o }: { o: Record<string, unknown> }) => {
    const d = describeFlashOrder(o);
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${BORD}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: d.open ? BRIGHT : FOG, letterSpacing: "0.03em" }}>
            {d.title} <span style={{ fontWeight: 400, color: d.status === "Rejected" ? NEG : d.status === "Filled" ? POS : FAINT }}>· {d.status}</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: FOG, marginTop: 2 }}>{d.size}{d.expires ? <span style={{ color: FAINT }}> · {d.expires}</span> : null}</div>
          {d.detail && <div style={{ fontFamily: UI, fontSize: 11.5, color: MUT, marginTop: 2, lineHeight: 1.4 }}>{d.detail}</div>}
          {d.reason && <div style={{ fontFamily: UI, fontSize: 11.5, color: FAINT, marginTop: 2, lineHeight: 1.4 }}>{d.reason}</div>}
        </div>
        {d.cancellable && (
          <button onClick={() => cancel(d.id)} disabled={!!busyId} style={{ ...btn(NEG), cursor: busyId ? "default" : "pointer", opacity: busyId && busyId !== d.id ? 0.5 : 1 }}>
            {busyId === d.id ? "SIGN…" : "CANCEL"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10, border: `1px solid ${BORD}`, borderRadius: 10, padding: "11px 12px" }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: UI, fontSize: 14, fontWeight: 600, color: BRIGHT }}>
        <span>Flash orders{orders ? <span style={{ color: FAINT, fontWeight: 400 }}> · {live.length} open</span> : null}</span>
        <span style={{ color: FAINT }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {err && <div style={{ fontFamily: UI, fontSize: 12, color: NEG, marginBottom: 6 }}>Flash orders: {err}</div>}
          {!orders && !err && <div style={{ fontFamily: UI, fontSize: 12, color: FAINT }}>Loading…</div>}
          {orders && live.length === 0 && <div style={{ fontFamily: UI, fontSize: 12, color: FAINT, paddingBottom: 6 }}>No open orders.</div>}
          {live.map((o) => <Row key={String(o.orderId)} o={o} />)}
          {closed.length > 0 && <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: FAINT, margin: "10px 0 2px" }}>RECENT</div>}
          {closed.map((o) => <Row key={String(o.orderId)} o={o} />)}
          {note && <div style={{ fontFamily: UI, fontSize: 12, color: FOG, marginTop: 8 }}>{note}</div>}

          <div style={{ borderTop: `1px solid ${BORD}`, marginTop: 10, paddingTop: 9 }}>
            <div style={{ fontFamily: UI, fontSize: 12, color: MUT, lineHeight: 1.5, marginBottom: 7 }}>
              Cancelling is a gasless signature. The on-chain off switch is revoking Flash’s approval: then no order can pull that token, whatever Flash’s servers do.
            </div>
            {!allows && <button onClick={checkAllowances} disabled={!!busyId} style={btn(FOG)}>CHECK APPROVALS</button>}
            {allows && allows.map((a) => (
              <div key={a.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0" }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: FOG }}>
                  {a.sym} <span style={{ color: FAINT }}>· {a.amount === 0n ? "none" : a.amount >= MAX_UINT / 2n ? "unlimited" : human(a.amount, a.decimals)}</span>
                </span>
                {a.amount > 0n && <button onClick={() => revoke(a)} disabled={!!busyId} style={btn(NEG)}>{busyId === a.token ? "SIGN…" : "REVOKE"}</button>}
              </div>
            ))}
            {allowNote && <div style={{ fontFamily: UI, fontSize: 12, color: FOG, marginTop: 6, lineHeight: 1.45 }}>{allowNote}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
