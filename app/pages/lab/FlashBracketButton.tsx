// ── Flash bracket (Definitive) — the SPOT exec door for a LONG thesis ─────────
// Additive to the Orderly perp book, never a replacement. A LONG frozen thesis becomes a
// one-tap spot BUY on Flash with the SAME frozen levels attached as a bracket: TP = 1.5R,
// SL = 1.2× H4 ATR — no re-derivation, the thesis's own numbers. Flow is quote → sign →
// submit, client-signed with the user's OWN wallet (non-custodial; the FLASH_API_KEY stays
// on our worker proxy, never in the browser). A CONFIRM MODAL always gates the signature —
// never auto-submit. LONG-only (you can't short a spot buy) + curated spot markets only;
// everything else stays on Orderly perps and this renders nothing.
import { useState } from "react";
import { useWalletConnector } from "@orderly.network/hooks";

const FLASH = "https://og.nexustradinglabs.com/flash";
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

// Curated symbol → Flash spot market (EVM signing path). USDC in, token out. Extensible: add a
// verified {chain, asset, contra} and the button lights up for that symbol. Kept tight on purpose
// — a wrong token address just fails the quote, but we'd rather list only what we've verified.
const FLASH_SPOT: Record<string, { chain: string; asset: string; contra: string; label: string }> = {
  ETH: { chain: "base", asset: "0x4200000000000000000000000000000000000006", contra: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", label: "WETH · Base" },
};

const bareOf = (s: string) => s.replace(/^PERP_/, "").replace(/_USDC$/, "").toUpperCase();

export function FlashBracketButton({ symbol, direction, entryPrice, stopLoss, takeProfit, walletAddress, navBtnStyle }: {
  symbol: string; direction: "LONG" | "SHORT"; entryPrice: string | number; stopLoss: string | number; takeProfit: string | number;
  walletAddress?: string | null; navBtnStyle?: React.CSSProperties;
}) {
  const wc = (useWalletConnector() as unknown as { wallet?: { provider?: Eip1193 } | null }).wallet || null;
  const [open, setOpen] = useState(false);
  const [usd, setUsd] = useState("25");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const spot = FLASH_SPOT[bareOf(symbol)];
  // LONG-only (spot can't short) + curated market only → otherwise the Orderly perp book owns it.
  if (direction !== "LONG" || !spot) return null;

  const run = async () => {
    setErr(null); setDone(null); setBusy(true);
    try {
      const provider = wc?.provider;
      if (!provider || !walletAddress) throw new Error("Connect a wallet first.");
      // 1) quote — funderAddress present so Flash returns the EIP-712 order to sign.
      const quoteBody = {
        targetChain: spot.chain, contraChain: spot.chain, targetAsset: spot.asset, contraAsset: spot.contra,
        side: "buy", qty: String(usd), orderType: "bracket", maxSlippage: "0.02", funderAddress: walletAddress,
        attachedBracket: { takeProfit: { notionalPrice: String(takeProfit) }, stopLoss: { notionalPrice: String(stopLoss) } },
      };
      const qr = await fetch(`${FLASH}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(quoteBody) });
      const quote = await qr.json();
      if (!qr.ok) throw new Error(quote?.message || quote?.error || (qr.status === 401 ? "401 — the key is a Portfolio key, not Flash. Regenerate it." : `quote failed (${qr.status})`));
      const typed = quote?.evm?.orderTypedData;
      if (!typed) throw new Error("Flash returned nothing to sign — check the size/market.");
      // 2) sign the order (and a Permit2 approval if Flash asks) with the user's OWN wallet.
      const sign = async (td: unknown) => (await provider.request({ method: "eth_signTypedData_v4", params: [walletAddress, typeof td === "string" ? td : JSON.stringify(td)] })) as string;
      const userSignature = await sign(typed);
      const body: Record<string, unknown> = { quoteId: quote.quoteId, userSignature, evmOrderTypedData: typed, funderAddress: walletAddress };
      if (quote?.evm?.permitTypedData) { body.evmPermitSignature = await sign(quote.evm.permitTypedData); body.evmPermitTypedData = quote.evm.permitTypedData; }
      // 3) submit.
      const or = await fetch(`${FLASH}/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const order = await or.json();
      if (!or.ok) throw new Error(order?.message || order?.error || `order failed (${or.status})`);
      setDone(order?.orderId || order?.id || "submitted");
    } catch (e) { setErr((e as Error)?.message || "Flash order failed."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}
        title={`Buy ${bareOf(symbol)} spot on Flash with this thesis's bracket (TP ${takeProfit} / SL ${stopLoss}). You confirm and sign before anything is placed.`}
        style={{ ...(navBtnStyle || {}), fontSize: 10, color: "#3ecf8e", borderColor: "#1e4a34", minHeight: 36, padding: "6px 12px" }}>
        ◇ FLASH BRACKET
      </button>
      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, background: "#0f0f11", border: "1px solid #33333a", borderRadius: 12, padding: 20, fontFamily: "var(--nx-font-mono)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f4f4f5", letterSpacing: "0.06em", marginBottom: 4 }}>◇ FLASH BRACKET · SPOT</div>
            <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11.5, color: "#a1a1aa", lineHeight: 1.55, marginBottom: 14 }}>
              Buy <b style={{ color: "#f4f4f5" }}>{bareOf(symbol)}</b> ({spot.label}) on Flash with your thesis's frozen bracket — <b style={{ color: "#f4f4f5" }}>TP 1.5R / SL 1.2× H4 ATR</b>. Non-custodial: you sign it, we never hold funds. The Orderly perp book stays available.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
              {([["ENTRY", entryPrice, "#f4f4f5"], ["STOP", stopLoss, "#f7525f"], ["TP", takeProfit, "#3ecf8e"]] as const).map(([l, v, c]) => (
                <div key={l} style={{ border: "1px solid #232327", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#71717a" }}>{l}</div>
                  <div style={{ fontSize: 12, color: c, marginTop: 3 }}>${v}</div>
                </div>
              ))}
            </div>
            <label style={{ display: "block", fontSize: 9, letterSpacing: "0.1em", color: "#71717a", marginBottom: 5 }}>SIZE (USDC)</label>
            <input value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
              style={{ width: "100%", boxSizing: "border-box", background: "#08080a", border: "1px solid #33333a", borderRadius: 6, padding: "9px 12px", color: "#f4f4f5", fontFamily: "var(--nx-font-mono)", fontSize: 14, marginBottom: 14 }} />
            {err && <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11, color: "#f7525f", lineHeight: 1.5, marginBottom: 12 }}>{err}</div>}
            {done && <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#3ecf8e", marginBottom: 12 }}>Order placed on Flash ✓ <span style={{ color: "#71717a" }}>{done}</span></div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => !busy && setOpen(false)} style={{ flex: 1, background: "none", border: "1px solid #33333a", borderRadius: 7, padding: "9px 0", color: "#a1a1aa", fontFamily: "var(--nx-font-mono)", fontSize: 11, cursor: "pointer" }}>{done ? "CLOSE" : "CANCEL"}</button>
              {!done && <button onClick={run} disabled={busy || !(parseFloat(usd) > 0)} style={{ flex: 1.4, background: busy || !(parseFloat(usd) > 0) ? "#1a1a1e" : "#3ecf8e", border: "none", borderRadius: 7, padding: "9px 0", color: busy || !(parseFloat(usd) > 0) ? "#71717a" : "#08080a", fontFamily: "var(--nx-font-mono)", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{busy ? "SIGNING…" : "CONFIRM & SIGN"}</button>}
            </div>
            <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 9.5, color: "#52525b", marginTop: 10, lineHeight: 1.5 }}>Advanced order via Definitive Flash · MEV-protected · @DefinitiveFi</div>
          </div>
        </div>
      )}
    </>
  );
}
