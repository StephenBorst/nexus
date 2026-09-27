// ── Cross-chain · NEAR Intents 1Click ──────────────────────────────────────────
// Move USDC/ETH from Arbitrum, Base or Ethereum to another chain — Solana and Bitcoin
// included. 1Click answers a quote with a deposit address; the user sends ONE plain
// transfer there and a solver delivers on the destination chain.
//
// The money path, in order (nothing reaches the wallet until every step passes):
//   1. quote from 1Click (browser-direct; CORS is open, no key on our side)
//   2. checkQuote(): 1Click's ed25519 signature against the pinned key, AND the signed
//      request must carry this user's recipient + refund address, the pinned assets, the
//      exact amount, ≤1% slippage, a live deadline and a deposit address that fits the
//      origin chain (app/lib/nearIntents.mjs — tested against real signed quotes)
//   3. confirm modal shows every number — nothing auto-sends
//   4. buildDepositTx(): the transfer is built from OUR pinned asset table (token contract,
//      decimals, chain), never from the response; ERC-20 = transfer(), no approval, so no
//      allowance is ever left behind
//   5. status polled until SUCCESS / REFUNDED / FAILED / INCOMPLETE_DEPOSIT — only
//      SUCCESS reads as delivered; a refund goes back to the user's own address.
import { useEffect, useRef, useState } from "react";
import {
  ONE_CLICK_API, XC_ASSETS, CHAIN_NAME, STATUS_TEXT, TERMINAL,
  checkQuote, buildDepositTx, recipientFitsChain, toUnits, fromUnits,
} from "@/lib/nearIntents.mjs";
import { ensureChain, explorerTx, type Eip1193 } from "./swapExec";
import { useEscapeKey } from "@/utils/a11y";

const MONO = "var(--nx-font-mono)", UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUT = "#71717a", FAINT = "#52525b", BORD = "#232327", CARD = "#0f0f11", BG = "#08080a", POS = "#3ecf8e", NEG = "#f7525f";
const MAX_SLIPPAGE_BPS = 100;

type AssetKey = keyof typeof XC_ASSETS;
const KEYS = Object.keys(XC_ASSETS) as AssetKey[];
const ORIGINS = KEYS.filter((k) => XC_ASSETS[k].origin);
const label = (k: AssetKey) => `${XC_ASSETS[k].sym} · ${CHAIN_NAME[XC_ASSETS[k].chain as keyof typeof CHAIN_NAME]}`;
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

type Quote = { quote: Record<string, string | number | undefined>; quoteRequest: Record<string, unknown>; signature: string; timestamp: string };
type Review = { quote: Quote; depositAddress: string; minAmountOut: string; deadlineMs: number; amount: bigint; recipient: string };
type QuoteCheck = { ok: true; depositAddress: string; minAmountOut: string; deadlineMs: number } | { ok: false; reason: string };
type Track = { status: string; hash: string; chainId: number; depositAddress: string; deliveredUrl: string | null; startedAt: number; timedOut?: boolean };

// Money in flight must survive a refresh: the transfer being tracked is saved locally and
// tracking resumes on return (within a day). Per-viewer convenience only; the source of
// truth is always 1Click's status for the deposit address.
const TRACK_KEY = "nx_xc_track_v1";
const TRACK_TTL_MS = 24 * 3600e3;
function loadTrack(): Track | null {
  try {
    const t = JSON.parse(localStorage.getItem(TRACK_KEY) || "null") as Track | null;
    if (!t || typeof t.depositAddress !== "string" || typeof t.hash !== "string") return null;
    return Date.now() - t.startedAt < TRACK_TTL_MS ? t : null;
  } catch { return null; }
}
function saveTrack(t: Track | null) {
  try { if (t) localStorage.setItem(TRACK_KEY, JSON.stringify(t)); else localStorage.removeItem(TRACK_KEY); } catch { /* storage off: tracking just won't resume */ }
}

const pad32 = (hex: string) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
// Balance of the pinned origin asset, read through the wallet's own RPC on the origin chain.
async function originBalance(provider: Eip1193, token: string | null, owner: string): Promise<bigint | null> {
  try {
    const r = token
      ? await provider.request({ method: "eth_call", params: [{ to: token, data: "0x70a08231" + pad32(owner) }, "latest"] })
      : await provider.request({ method: "eth_getBalance", params: [owner, "latest"] });
    return typeof r === "string" && /^0x[0-9a-fA-F]*$/.test(r) ? BigInt(r === "0x" ? "0x0" : r) : null;
  } catch { return null; }
}

export function CrossChainCard({ walletAddress: connected, provider }: { walletAddress: string | null; provider: Eip1193 | undefined }) {
  // The transfer is signed by an EVM wallet; a Solana-only connection can receive (typed
  // address) but not send from here.
  const walletAddress = connected && /^0x[0-9a-fA-F]{40}$/.test(connected) ? connected : null;
  const [from, setFrom] = useState<AssetKey>("USDC.arb");
  const [to, setTo] = useState<AssetKey>("SOL.sol");
  const [amount, setAmount] = useState("");
  const [typedRecipient, setTypedRecipient] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Resume a transfer still in flight from an earlier visit (mount only).
  useEffect(() => {
    const t = loadTrack();
    if (!t) return;
    setTrack(t);
    if (!TERMINAL.has(t.status)) poll(t.depositAddress);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (track) saveTrack(track); }, [track]);
  useEscapeKey(() => setReview(null), !!review && !busy);

  const dest = XC_ASSETS[to];
  const evmDest = dest.chain !== "sol" && dest.chain !== "btc";
  // EVM destinations always pay the connected wallet — no typed address, no typo risk.
  const recipient = evmDest ? walletAddress || "" : typedRecipient.trim();
  const recipientOk = !!recipient && recipientFitsChain(recipient, dest.chain);
  const units = toUnits(amount, XC_ASSETS[from].decimals);
  const sameAsset = XC_ASSETS[from].assetId === dest.assetId;
  const inFlight = !!track && !TERMINAL.has(track.status) && !track.timedOut;
  const canQuote = !!walletAddress && !!provider && !!units && recipientOk && !sameAsset && !busy && !inFlight;

  async function getQuote() {
    if (!walletAddress || !units) return;
    setErr(null); setBusy("Getting a verified quote…");
    try {
      const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
      const body = {
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: MAX_SLIPPAGE_BPS,
        originAsset: XC_ASSETS[from].assetId, depositType: "ORIGIN_CHAIN",
        destinationAsset: dest.assetId, amount: units.toString(),
        recipient, recipientType: "DESTINATION_CHAIN",
        refundTo: walletAddress, refundType: "ORIGIN_CHAIN", deadline,
      };
      const r = await fetch(`${ONE_CLICK_API}/v0/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error((j && typeof j.message === "string" ? j.message : "No quote") + ". Nothing was sent.");
      const chk = checkQuote(j, {
        originAsset: body.originAsset, destinationAsset: body.destinationAsset, amount: body.amount,
        recipient, refundTo: walletAddress, originChain: XC_ASSETS[from].chain, maxSlippageBps: MAX_SLIPPAGE_BPS,
      }) as QuoteCheck;
      if (!chk.ok) throw new Error(`Quote refused (${chk.reason}). Nothing was sent.`);
      if (alive.current) setReview({ quote: j, depositAddress: chk.depositAddress, minAmountOut: chk.minAmountOut, deadlineMs: chk.deadlineMs, amount: units, recipient });
    } catch (e) {
      if (alive.current) setErr((e as Error).message || "No quote. Nothing was sent.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function send() {
    if (!review || !provider || !walletAddress) return;
    setErr(null);
    try {
      if (Date.now() > review.deadlineMs - 30_000) throw new Error("The quote expired. Get a new one. Nothing was sent.");
      const { chainId, tx } = buildDepositTx(from, review.amount, review.depositAddress, walletAddress);
      // The wallet must be signing as the account the quote refunds to.
      const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      // Blocks only on a POSITIVE mismatch: some connectors return [] here, and the refund
      // still goes to the connected address either way.
      if (Array.isArray(accounts) && accounts.length > 0 && !accounts.some((a) => typeof a === "string" && a.toLowerCase() === walletAddress.toLowerCase()))
        throw new Error("Your wallet is on a different account than the one connected. Switch back, then review again. Nothing was sent.");
      setBusy(`Switch to ${CHAIN_NAME[XC_ASSETS[from].chain as keyof typeof CHAIN_NAME]} in your wallet…`);
      await ensureChain(provider, chainId);
      // Check the balance first: an ERC-20 transfer that's short reverts and still costs gas.
      const bal = await originBalance(provider, XC_ASSETS[from].token, walletAddress);
      if (bal != null && bal < review.amount)
        throw new Error(`Not enough ${XC_ASSETS[from].sym} on ${CHAIN_NAME[XC_ASSETS[from].chain as keyof typeof CHAIN_NAME]}. Nothing was sent.`);
      setBusy("Confirm the transfer in your wallet…");
      // chainId inside the tx: wallets that honour it (MetaMask and most others) refuse to sign
      // if the user flipped networks between the switch above and this prompt.
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ ...tx, chainId: "0x" + chainId.toString(16) }] })) as string;
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet didn't return a transaction hash. Check your wallet before retrying.");
      // Optional speed-up: tell 1Click which tx paid the address. Best effort only.
      fetch(`${ONE_CLICK_API}/v0/deposit/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositAddress: review.depositAddress, txHash: hash }) }).catch(() => {});
      if (!alive.current) return;
      setTrack({ status: "PENDING_DEPOSIT", hash, chainId, depositAddress: review.depositAddress, deliveredUrl: null, startedAt: Date.now() });
      setReview(null);
      poll(review.depositAddress);
    } catch (e) {
      if (alive.current) setErr((e as Error).message || "Transfer not sent.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function poll(depositAddress: string) {
    for (let i = 0; i < 240 && alive.current; i++) { // ~24 min at 6s
      await new Promise((res) => setTimeout(res, 6000));
      try {
        const r = await fetch(`${ONE_CLICK_API}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
        if (!r.ok) continue;
        const j = await r.json();
        const status = typeof j?.status === "string" ? j.status : null;
        if (!status || !alive.current) continue;
        const url = j?.swapDetails?.destinationChainTxHashes?.[0]?.explorerUrl;
        setTrack((t) => (t ? { ...t, status, deliveredUrl: typeof url === "string" && url.startsWith("https://") ? url : t.deliveredUrl } : t));
        if (TERMINAL.has(status)) return;
      } catch { /* keep polling */ }
    }
    if (alive.current) setTrack((t) => (t && !TERMINAL.has(t.status) ? { ...t, timedOut: true } : t));
  }

  const sel = { background: BG, border: `1px solid ${BORD}`, borderRadius: 7, color: BRIGHT, fontFamily: MONO, fontSize: 12, padding: "9px 10px", width: "100%" } as const;
  const field = { display: "flex", flexDirection: "column" as const, gap: 6, flex: 1, minWidth: 0 };
  const lab = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: MUT };
  const fromName = CHAIN_NAME[XC_ASSETS[from].chain as keyof typeof CHAIN_NAME];
  const toName = CHAIN_NAME[dest.chain as keyof typeof CHAIN_NAME];

  return (
    <section aria-labelledby="xc-title" style={{ marginTop: 28, marginBottom: 88, maxWidth: 640, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 id="xc-title" style={{ margin: 0, fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em", color: BRIGHT, fontWeight: 600 }}>CROSS-CHAIN</h2>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT }}>via NEAR Intents · one transfer · no approval</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={field}><span style={lab}>FROM</span>
          <select value={from} onChange={(e) => { setFrom(e.target.value as AssetKey); setReview(null); }} style={sel}>
            {ORIGINS.map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        </label>
        <label style={field}><span style={lab}>TO</span>
          <select value={to} onChange={(e) => { setTo(e.target.value as AssetKey); setReview(null); }} style={sel}>
            {KEYS.filter((k) => k !== from).map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        </label>
      </div>

      <label style={field}><span style={lab}>AMOUNT ({XC_ASSETS[from].sym})</span>
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null); }} placeholder="0.00" style={sel} />
      </label>

      {evmDest ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
          Delivered to your wallet on {toName}{walletAddress ? <> · <span style={{ color: FOG }}>{short(walletAddress)}</span></> : null}
        </div>
      ) : (
        <label style={field}><span style={lab}>{toName.toUpperCase()} ADDRESS</span>
          <input value={typedRecipient} onChange={(e) => { setTypedRecipient(e.target.value); setReview(null); }} placeholder={dest.chain === "sol" ? "Solana address" : "bc1… address"} spellCheck={false} autoComplete="off" style={sel} />
          {typedRecipient && !recipientOk && <span style={{ fontFamily: MONO, fontSize: 10.5, color: NEG }}>Not a {toName} address.</span>}
        </label>
      )}

      {!walletAddress ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>{connected ? "Connect an EVM wallet to send from Arbitrum, Base or Ethereum." : "Connect a wallet to move funds across chains."}</div>
      ) : (
        <button type="button" onClick={getQuote} disabled={!canQuote}
          style={{ background: canQuote ? BRIGHT : "transparent", color: canQuote ? "#0a0a0b" : FAINT, border: `1px solid ${canQuote ? BRIGHT : BORD}`, borderRadius: 9, fontFamily: MONO, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.03em", padding: "12px 0", cursor: canQuote ? "pointer" : "not-allowed" }}>
          {busy && !review ? busy : inFlight ? "Transfer in progress" : "Review"}
        </button>
      )}
      {err && !review && <div role="alert" style={{ fontFamily: MONO, fontSize: 11, color: NEG }}>{err}</div>}

      {track && (
        <div aria-live="polite" style={{ borderTop: `1px solid ${BORD}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6, fontFamily: MONO, fontSize: 11.5 }}>
          <div style={{ color: track.status === "SUCCESS" ? POS : TERMINAL.has(track.status) ? NEG : BRIGHT }}>
            {STATUS_TEXT[track.status as keyof typeof STATUS_TEXT] || "In progress"}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: MUT }}>
            {explorerTx(track.chainId, track.hash) && <a href={explorerTx(track.chainId, track.hash) as string} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>your transfer ↗</a>}
            {track.deliveredUrl && <a href={track.deliveredUrl} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>delivery ↗</a>}
            <a href="https://explorer.near-intents.org" target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>NEAR Intents explorer ↗</a>
          </div>
          <div style={{ color: FAINT, fontSize: 10.5, wordBreak: "break-all" }}>Deposit address · {track.depositAddress}</div>
          {track.timedOut && <div style={{ color: FOG, fontSize: 10.5 }}>Still in progress. Search the deposit address on the explorer to follow it.</div>}
          {TERMINAL.has(track.status) && (
            <button type="button" onClick={() => { setTrack(null); saveTrack(null); }}
              style={{ alignSelf: "flex-start", background: "transparent", color: MUT, border: `1px solid ${BORD}`, borderRadius: 6, fontFamily: MONO, fontSize: 10.5, padding: "5px 10px", cursor: "pointer" }}>Clear</button>
          )}
        </div>
      )}

      <div style={{ fontFamily: UI, fontSize: 10.5, lineHeight: 1.5, color: FAINT }}>
        Quotes are signed by 1Click and checked in your browser: paid to your address, refunded to your address. Your wallet sends one transfer. If the swap can’t fill, it refunds to your wallet on {fromName}.
      </div>

      {review && (
        <div role="dialog" aria-modal="true" aria-labelledby="xc-review-title" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: "100%", maxWidth: 420, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 id="xc-review-title" style={{ margin: 0, fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em", color: BRIGHT }}>REVIEW TRANSFER</h3>
            {[
              ["You send", `${fromUnits(review.amount.toString(), XC_ASSETS[from].decimals)} ${XC_ASSETS[from].sym} on ${fromName}`],
              ["You receive (est.)", `${fromUnits(String(review.quote.quote.amountOut), dest.decimals)} ${dest.sym} on ${toName}`],
              ["Minimum received", `${fromUnits(review.minAmountOut, dest.decimals)} ${dest.sym}`],
              ["Delivered to", review.recipient],
              ["Refunds to", walletAddress as string],
              ["Deposit address", review.depositAddress],
              ["Time", review.quote.quote.timeEstimate ? `~${review.quote.quote.timeEstimate}s after your transfer confirms` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: MONO, fontSize: 11.5 }}>
                <span style={{ color: MUT, flexShrink: 0 }}>{k}</span>
                <span style={{ color: BRIGHT, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
              </div>
            ))}
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: POS }}>✓ Signed by 1Click · recipient and refund are yours</div>
            <div style={{ fontFamily: UI, fontSize: 10.5, lineHeight: 1.5, color: FAINT }}>Fees are inside the quote. Send exactly this amount, once.</div>
            {err && <div role="alert" style={{ fontFamily: MONO, fontSize: 11, color: NEG }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setReview(null)} disabled={!!busy}
                style={{ flex: 1, background: "transparent", color: FOG, border: `1px solid ${BORD}`, borderRadius: 9, fontFamily: MONO, fontSize: 12, padding: "11px 0", cursor: busy ? "not-allowed" : "pointer" }}>Cancel</button>
              <button type="button" onClick={send} disabled={!!busy}
                style={{ flex: 2, background: BRIGHT, color: "#0a0a0b", border: "none", borderRadius: 9, fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: "11px 0", cursor: busy ? "wait" : "pointer" }}>{busy || "Send transfer"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
