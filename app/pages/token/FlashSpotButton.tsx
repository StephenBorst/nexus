// ── Flash (Definitive) — a THIRD EVM router on the Spot terminal, next to Fabric ─────
// Additive: Fabric stays first, the named Uniswap deep-link stays the no-route fallback, and
// this is the extra in-app router. Market BUY and SELL; a bracket (SL/TP) is ATTACHED to a buy
// ONLY when the quote echoes attachedBracket back (Definitive's UI still says "Bracket SOON",
// so we never promise it). The FLASH_API_KEY stays on our worker proxy; the user signs the
// EIP-712 order in their OWN wallet — the SAME sign path as Fabric. Confirm modal always gates
// the signature — never auto-submit. EVM chains only (Solana uses the app's Jupiter path).
import { useState } from "react";
import { parseTransaction } from "viem";
import { EVM_USDC } from "./swapExec";

const FLASH = "https://og.nexustradinglabs.com/flash";
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
// DexScreener chain id == Flash targetChain for these EVM chains. Contra (USDC) comes from EVM_USDC.
const FLASH_EVM = new Set(["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc", "avalanche"]);

const MONO = "var(--nx-font-mono)", UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUT = "#71717a", FAINT = "#52525b", BORD = "#232327", CARD = "#0f0f11", BG = "#08080a", POS = "#3ecf8e", NEG = "#f7525f";

async function waitReceipt(provider: Eip1193, hash: string, tries = 45): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try { const r = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }); if (r && (r as { blockNumber?: unknown }).blockNumber) return; } catch { /* keep polling */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

export function FlashSpotButton({ chainId, tokenAddress, symbol, side, defaultAmount, walletAddress, provider }: {
  chainId: string; tokenAddress: string; symbol: string; side: "buy" | "sell"; defaultAmount?: string;
  walletAddress?: string | null; provider?: Eip1193 | null;
}) {
  const usdc = EVM_USDC[chainId]?.usdc;
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(defaultAmount && parseFloat(defaultAmount) > 0 ? defaultAmount : (side === "buy" ? "25" : ""));
  const [sl, setSl] = useState(""); const [tp, setTp] = useState("");
  const [preview, setPreview] = useState<{ est: string; min: string; fee: string; bracket: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);

  if (!FLASH_EVM.has(chainId) || !usdc) return null; // EVM + known USDC only

  const outSym = side === "buy" ? symbol : "USDC";
  const quoteBody = (qty: string, withBracket: boolean) => {
    const b: Record<string, unknown> = {
      targetChain: chainId, contraChain: chainId, targetAsset: tokenAddress, contraAsset: usdc,
      side, qty: String(qty), orderType: "market", maxSlippage: "0.02",
      ...(walletAddress ? { funderAddress: walletAddress } : {}),
    };
    if (withBracket && side === "buy" && (parseFloat(sl) > 0 || parseFloat(tp) > 0)) {
      const ab: Record<string, unknown> = {};
      if (parseFloat(tp) > 0) ab.takeProfit = { notionalPrice: String(tp) };
      if (parseFloat(sl) > 0) ab.stopLoss = { notionalPrice: String(sl) };
      b.attachedBracket = ab;
    }
    return b;
  };

  const fetchPreview = async (qty: string) => {
    setErr(null);
    if (!(parseFloat(qty) > 0)) { setPreview(null); return; }
    try {
      const r = await fetch(`${FLASH}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(quoteBody(qty, true)) });
      const q = await r.json();
      if (!r.ok) throw new Error(q?.error?.message || q?.message || (r.status === 401 ? "Flash key invalid (Portfolio, not Flash)." : `quote ${r.status}`));
      const est = String(q?.to?.amount ?? "");
      const slip = parseFloat(q?.recommendedSlippage ?? "0.01") || 0.01;
      setPreview({ est, min: est ? String(parseFloat(est) * (1 - slip)) : "", fee: String(q?.fees?.estimatedFeeNotional ?? ""), bracket: !!q?.attachedBracket });
    } catch (e) { setErr((e as Error)?.message || "quote failed"); setPreview(null); }
  };

  const run = async () => {
    setErr(null); setDone(null); setBusy(true); setStatus("Getting a quote…");
    try {
      if (!provider || !walletAddress) throw new Error("Connect a wallet first.");
      const r = await fetch(`${FLASH}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(quoteBody(size, true)) });
      const q = await r.json();
      if (!r.ok) throw new Error(q?.error?.message || q?.message || q?.error || (r.status === 401 ? "Flash key invalid (Portfolio, not Flash). Regenerate it." : `quote failed (${r.status})`));
      // one-time token approval Flash returns as a raw tx → decode + send + wait, before signing.
      const setupTxs: string[] = Array.isArray(q?.setupTxs) ? q.setupTxs : [];
      for (const raw of setupTxs) {
        setStatus(side === "buy" ? "Approve USDC for Flash…" : `Approve ${symbol} for Flash…`);
        let to: `0x${string}` | null | undefined, data: `0x${string}` | undefined, value: bigint | undefined;
        try { const p = parseTransaction(raw as `0x${string}`); to = p.to; data = p.data; value = p.value; }
        catch { throw new Error("Approve the token for Flash in your wallet, then retry."); }
        const tx: Record<string, unknown> = { from: walletAddress, to, data };
        if (value && value > 0n) tx.value = `0x${value.toString(16)}`;
        const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
        setStatus("Waiting for approval to confirm…"); await waitReceipt(provider, hash);
      }
      setStatus("Sign the order in your wallet…");
      const typed = q?.evm?.orderTypedData;
      if (!typed) throw new Error("Flash returned nothing to sign — check the size/market.");
      const sign = async (td: unknown) => (await provider.request({ method: "eth_signTypedData_v4", params: [walletAddress, typeof td === "string" ? td : JSON.stringify(td)] })) as string;
      const userSignature = await sign(typed);
      const body: Record<string, unknown> = { quoteId: q.quoteId, userSignature, evmOrderTypedData: typed, funderAddress: walletAddress };
      if (q?.evm?.permitTypedData) { body.evmPermitSignature = await sign(q.evm.permitTypedData); body.evmPermitTypedData = q.evm.permitTypedData; }
      setStatus("Submitting…");
      const or = await fetch(`${FLASH}/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const order = await or.json();
      if (!or.ok) throw new Error(order?.error?.message || order?.message || order?.error || `order failed (${or.status})`);
      setDone(order?.orderId || order?.id || "submitted");
    } catch (e) { setErr((e as Error)?.message || "Flash order failed."); }
    finally { setBusy(false); setStatus(""); }
  };

  const openModal = () => { setOpen(true); setDone(null); setErr(null); fetchPreview(size); };
  const inStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: BG, border: "1px solid #33333a", borderRadius: 6, color: BRIGHT, fontFamily: MONO, outline: "none" };

  return (
    <>
      <button onClick={openModal}
        style={{ display: "block", width: "100%", textAlign: "center", marginTop: 8, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: POS, background: "none", border: `1px solid ${POS}44`, borderRadius: 9, padding: "10px 0", cursor: "pointer" }}>
        ◇ {side === "sell" ? "Sell" : "Buy"} {symbol} via Flash
      </button>
      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: CARD, border: "1px solid #33333a", borderRadius: 12, padding: 20, fontFamily: MONO }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: BRIGHT, letterSpacing: "0.06em", marginBottom: 4 }}>◇ FLASH · {side === "sell" ? "SELL" : "BUY"} {symbol}</div>
            <div style={{ fontFamily: UI, fontSize: 11, color: FOG, lineHeight: 1.5, marginBottom: 14 }}>Market {side} on Definitive Flash — MEV-protected, non-custodial: you sign it in your own wallet.</div>
            <label style={{ display: "block", fontSize: 9, letterSpacing: "0.1em", color: MUT, marginBottom: 5 }}>SIZE ({side === "buy" ? "USDC" : symbol})</label>
            <input value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal"
              style={{ ...inStyle, fontSize: 15, padding: "9px 12px", marginBottom: 12 }} />
            {side === "buy" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 8.5, letterSpacing: "0.08em", color: MUT, marginBottom: 4 }}>STOP $ (opt)</label>
                  <input value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal" placeholder="—" style={{ ...inStyle, color: NEG, border: `1px solid ${BORD}`, fontSize: 12, padding: "7px 9px" }} /></div>
                <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 8.5, letterSpacing: "0.08em", color: MUT, marginBottom: 4 }}>TP $ (opt)</label>
                  <input value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal" placeholder="—" style={{ ...inStyle, color: POS, border: `1px solid ${BORD}`, fontSize: 12, padding: "7px 9px" }} /></div>
              </div>
            )}
            {preview && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, lineHeight: 1.7, marginBottom: 12, borderTop: `1px solid ${BORD}`, paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Est. receive</span><span style={{ color: BRIGHT }}>{preview.est ? Number(preview.est).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Min received</span><span style={{ color: FOG }}>{preview.min ? Number(preview.min).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Fee</span><span style={{ color: FAINT }}>${preview.fee}</span></div>
                {side === "buy" && (parseFloat(sl) > 0 || parseFloat(tp) > 0) && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Bracket</span><span style={{ color: preview.bracket ? POS : FAINT }}>{preview.bracket ? "attached ✓" : "not echoed — market only"}</span></div>}
              </div>
            )}
            {busy && status && <div style={{ fontFamily: UI, fontSize: 11, color: FOG, marginBottom: 12 }}>{status}</div>}
            {err && <div style={{ fontFamily: UI, fontSize: 11, color: NEG, lineHeight: 1.5, marginBottom: 12 }}>{err}</div>}
            {done && <div style={{ fontFamily: UI, fontSize: 12, color: POS, marginBottom: 12 }}>Order placed on Flash ✓ <span style={{ color: MUT }}>{done}</span></div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => !busy && setOpen(false)} style={{ flex: 1, background: "none", border: "1px solid #33333a", borderRadius: 7, padding: "9px 0", color: FOG, fontFamily: MONO, fontSize: 11, cursor: busy ? "default" : "pointer" }}>{done ? "CLOSE" : "CANCEL"}</button>
              {!done && <button onClick={run} disabled={busy || !(parseFloat(size) > 0)} style={{ flex: 1.4, background: busy || !(parseFloat(size) > 0) ? "#1a1a1e" : POS, border: "none", borderRadius: 7, padding: "9px 0", color: busy || !(parseFloat(size) > 0) ? MUT : "#08080a", fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{busy ? "WORKING…" : "CONFIRM & SIGN"}</button>}
            </div>
            <div style={{ fontFamily: UI, fontSize: 9.5, color: FAINT, marginTop: 10 }}>Definitive Flash · MEV-protected · @DefinitiveFi</div>
          </div>
        </div>
      )}
    </>
  );
}
