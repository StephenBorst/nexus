// ── Cross-chain · NEAR Intents 1Click ──────────────────────────────────────────
// Move USDC/ETH from Arbitrum, Base or Ethereum (or SOL/USDC from Solana) to another chain —
// Solana and Bitcoin included. 1Click answers a quote with a deposit address; the user sends ONE
// plain transfer there and a solver delivers on the destination chain. From Solana, that transfer is
// built, simulated and checked in xcSolSend.ts (the one Solana signer for this card).
// "Fund my trading account" = USDC to the trading account's own wallet, then (once the delivery is
// proven on-chain) one click into Orderly's deposit dialog.
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
//   5. status polled until SUCCESS / REFUNDED / FAILED / INCOMPLETE_DEPOSIT
//   6. 1Click's SUCCESS / REFUNDED is a server's word, so it is then CHECKED ON-CHAIN:
//      GET /xc/settlement reads the destination (or refund) transactions from their own chain
//      and compares what reached the user's address with the floor 1Click signed
//      (app/lib/nearSettlement.mjs). "Delivered" shows green only once that check proves it,
//      to the recipient this card sent the quote for.
import { reportSpotFill } from "@/lib/spotReport";
import { useEffect, useRef, useState } from "react";
import {
  ONE_CLICK_API, XC_ASSETS, fetchOneClickQuote, CHAIN_NAME, STATUS_TEXT, TERMINAL,
  checkQuote, buildDepositTx, recipientFitsChain, toUnits, fromUnits,
  xcAppFees, XC_WORKER_API,
} from "@/lib/nearIntents.mjs";
import { settlementLine, settlementReceipt, receiptWanted, depositHandoff, RECHECK } from "@/lib/nearSettlement.mjs";
import { SOL_ORIGINS } from "@/lib/solDeposit.mjs";
import { sendSolDeposit, type SolOriginKey } from "./xcSolSend";
import { solscanTx, type SolProvider } from "./solSwapExec";
import { modal } from "@orderly.network/ui";
import { isAddress } from "viem";
import { getRuntimeConfig } from "@/utils/runtime-config";
import { ensureChain, explorerTx, type Eip1193 } from "./swapExec";
import { useEscapeKey } from "@/utils/a11y";

const MONO = "var(--nx-font-mono)", UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUT = "#71717a", FAINT = "#52525b", BORD = "#232327", CARD = "#0f0f11", BG = "#08080a", POS = "#3ecf8e", NEG = "#f7525f";
const MAX_SLIPPAGE_BPS = 100;

type AssetKey = keyof typeof XC_ASSETS;
const KEYS = Object.keys(XC_ASSETS) as AssetKey[];
const EVM_ORIGINS = KEYS.filter((k) => XC_ASSETS[k].origin);
const SOL_ORIGIN_KEYS = Object.keys(SOL_ORIGINS) as AssetKey[];
const isSolAddr = (a: unknown): a is string => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const label = (k: AssetKey) => `${XC_ASSETS[k].sym} · ${CHAIN_NAME[XC_ASSETS[k].chain as keyof typeof CHAIN_NAME]}`;
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

type Quote = { quote: Record<string, string | number | undefined>; quoteRequest: Record<string, unknown>; signature: string; timestamp: string };
type Review = { quote: Quote; depositAddress: string; minAmountOut: string; deadlineMs: number; amount: bigint; recipient: string; refundTo: string; from: AssetKey };
type QuoteCheck = { ok: true; depositAddress: string; minAmountOut: string; deadlineMs: number } | { ok: false; reason: string };
// check = GET /xc/settlement's reply (the on-chain verdict), null until it answers.
type CheckTx = { hash: string; ok: boolean; credited?: string; final?: boolean; reason?: string; note?: string; method?: string };
type Check = { verdict?: string; chain?: string; to?: string; final?: boolean; error?: string; reason?: string; kind?: string; asset?: string; decimals?: number; bar?: string; credited?: string; txs?: CheckTx[] };
type Track = { status: string; hash: string; chainId: number; depositAddress: string; deliveredUrl: string | null; startedAt: number; timedOut?: boolean; recipient?: string; refundTo?: string; fromChain?: string; check?: Check | null };
const SETTLE_WORDS = new Set(["SUCCESS", "REFUNDED"]);
// The on-chain check can still change its answer (no answer yet, not final, a read failed).
const checkOpen = (t: Track) => SETTLE_WORDS.has(t.status) && (!t.check || !t.check.verdict || RECHECK.has(t.check.verdict));
// 1Click can still move: not terminal, or INCOMPLETE_DEPOSIT (which turns into a refund by the deadline).
const statusOpen = (t: Track) => (!TERMINAL.has(t.status) || t.status === "INCOMPLETE_DEPOSIT") && !t.timedOut;

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
/** A transfer is still moving (saved, under a day old, not finished, not timed out), or its delivery
 *  is still being confirmed on-chain. Spot opens the folded card for it, so tracking resumes instead
 *  of hiding behind a closed row. */
export function hasTransferInFlight(): boolean {
  const t = loadTrack();
  return !!t && (statusOpen(t) || checkOpen(t));
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

// initialTo / initialRecipient: a PRESET from the Spot page's "Get USDC on Solana" prompt — the
// destination and the user's own address, filled in. Nothing is sent until the usual review; the
// recipient is shape-checked like a typed one and is part of the signed quote checkQuote verifies.
// fund: open in "Fund my trading account" mode. connected = the trading (Orderly) account's address.
// solProvider / solAddress: a connected Solana wallet (the Spot page's solSigner), which can SEND.
export function CrossChainCard({ walletAddress: connected, provider, initialTo, initialRecipient, solProvider, solAddress, fund }: {
  walletAddress: string | null; provider: Eip1193 | undefined; initialTo?: string; initialRecipient?: string;
  solProvider?: SolProvider; solAddress?: string | null; fund?: boolean;
}) {
  // EVM sends need the EVM wallet; Solana sends need a Solana signer. Either can receive.
  const walletAddress = connected && /^0x[0-9a-fA-F]{40}$/.test(connected) ? connected : null;
  const solWallet = isSolAddr(solAddress) && solProvider ? solAddress : null;
  // The trading account: an EVM account deposits USDC from Arbitrum, a Solana account USDC on Solana.
  const tradingAccount = walletAddress || (isSolAddr(connected) ? connected : null);
  const fundTo: AssetKey = walletAddress ? "USDC.arb" : "USDC.sol";
  const fundFrom: AssetKey = fundTo === "USDC.arb" ? (solWallet ? "USDC.sol" : "USDC.base") : "USDC.arb";
  const [from, setFrom] = useState<AssetKey>(fund ? fundFrom : "USDC.arb");
  const presetTo = initialTo && (KEYS as string[]).includes(initialTo) && !XC_ASSETS[initialTo as AssetKey].origin ? (initialTo as AssetKey) : null;
  const [to, setTo] = useState<AssetKey>(fund ? fundTo : presetTo || "SOL.sol");
  const [fundMode, setFundMode] = useState(!!fund);
  const [typedEvm, setTypedEvm] = useState("");
  const [amount, setAmount] = useState("");
  const [typedRecipient, setTypedRecipient] = useState(presetTo && typeof initialRecipient === "string" ? initialRecipient.trim().slice(0, 64) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [receipt, setReceipt] = useState<"copied" | "shown" | null>(null);
  const reported = useRef<Set<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Resume a transfer still in flight from an earlier visit (mount only).
  useEffect(() => {
    const t = loadTrack();
    if (!t) return;
    setTrack(t);
    if (statusOpen(t)) poll(t.depositAddress);
    else if (checkOpen(t)) confirmOnChain(t.depositAddress);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (track) saveTrack(track); }, [track]);
  useEscapeKey(() => setReview(null), !!review && !busy);

  const dest = XC_ASSETS[to];
  const evmDest = dest.chain !== "sol" && dest.chain !== "btc";
  const fromIsSol = XC_ASSETS[from].chain === "sol";
  // Who sends (and gets any refund): the Solana wallet for a Solana origin, the EVM wallet otherwise.
  const sender = fromIsSol ? solWallet : (provider ? walletAddress : null);
  // EVM destinations pay the connected EVM wallet (no typo risk). Only with no EVM wallet connected
  // (sending from Solana) is an EVM address typed, and then it must pass a strict checksum check.
  const typingEvm = evmDest && !walletAddress;
  const recipient = evmDest ? walletAddress || typedEvm.trim() : typedRecipient.trim() || (dest.chain === "sol" && solWallet ? solWallet : "");
  const recipientOk = !!recipient && recipientFitsChain(recipient, dest.chain) && (!typingEvm || isAddress(recipient, { strict: true }));
  const units = toUnits(amount, XC_ASSETS[from].decimals);
  const sameAsset = XC_ASSETS[from].assetId === dest.assetId;
  const solToSol = fromIsSol && dest.chain === "sol"; // same chain: that's a swap (the Solana ticket), not a bridge
  const inFlight = !!track && !TERMINAL.has(track.status) && !track.timedOut;
  const canQuote = !!sender && !!units && recipientOk && !sameAsset && !solToSol && !busy && !inFlight;
  const origins = [...EVM_ORIGINS, ...(solWallet ? SOL_ORIGIN_KEYS : [])];

  async function getQuote() {
    if (!sender || !units) return;
    setErr(null); setBusy("Getting a verified quote…");
    try {
      // Our fee (public/config.js VITE_XC_FEE_BPS + VITE_XC_FEE_RECIPIENT); empty ⇒ none sent.
      const appFees = xcAppFees(getRuntimeConfig("VITE_XC_FEE_BPS"), getRuntimeConfig("VITE_XC_FEE_RECIPIENT"));
      const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
      const body = {
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: MAX_SLIPPAGE_BPS,
        originAsset: XC_ASSETS[from].assetId, depositType: "ORIGIN_CHAIN",
        destinationAsset: dest.assetId, amount: units.toString(),
        recipient, recipientType: "DESTINATION_CHAIN",
        refundTo: sender, refundType: "ORIGIN_CHAIN", deadline,
        ...(appFees.length ? { appFees } : {}),
      };
      const { res: r } = await fetchOneClickQuote(body);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error((j && typeof j.message === "string" ? j.message : "No quote") + ". Nothing was sent.");
      const chk = checkQuote(j, {
        originAsset: body.originAsset, destinationAsset: body.destinationAsset, amount: body.amount,
        recipient, refundTo: sender, originChain: XC_ASSETS[from].chain, maxSlippageBps: MAX_SLIPPAGE_BPS, appFees,
        deadline, // the price window WE asked for; the reply's copy isn't signed
      }) as QuoteCheck;
      if (!chk.ok) throw new Error(`Quote refused (${chk.reason}). Nothing was sent.`);
      if (alive.current) setReview({ quote: j, depositAddress: chk.depositAddress, minAmountOut: chk.minAmountOut, deadlineMs: chk.deadlineMs, amount: units, recipient, refundTo: sender, from });
    } catch (e) {
      if (alive.current) setErr((e as Error).message || "No quote. Nothing was sent.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  // From Solana: xcSolSend builds, simulates, checks and signs the one transfer.
  async function sendFromSolana() {
    if (!review || !solProvider || !isSolAddr(review.refundTo)) return;
    setErr(null);
    try {
      if (Date.now() > review.deadlineMs - 30_000) throw new Error("The quote expired. Get a new one. Nothing was sent.");
      const { sig, confirmed } = await sendSolDeposit(solProvider, { assetKey: review.from as SolOriginKey, amount: review.amount, from: review.refundTo, depositAddress: review.depositAddress }, (step) => setBusy(step.charAt(0).toUpperCase() + step.slice(1)));
      fetch(`${ONE_CLICK_API}/v0/deposit/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositAddress: review.depositAddress, txHash: sig }) }).catch(() => {});
      if (!alive.current) return;
      setTrack({ status: "PENDING_DEPOSIT", hash: sig, chainId: 0, depositAddress: review.depositAddress, deliveredUrl: null, startedAt: Date.now(), recipient: review.recipient, refundTo: review.refundTo, fromChain: "sol", check: null });
      setReceipt(null);
      setReview(null);
      if (!confirmed) setErr("Submitted, not confirmed yet. Check Solscan before trying again: it may still land.");
      poll(review.depositAddress);
    } catch (e) {
      if (alive.current) setErr((e as Error).message || "Transfer not sent.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function send() {
    if (review && XC_ASSETS[review.from].chain === "sol") return sendFromSolana();
    if (!review || !provider || !walletAddress) return;
    setErr(null);
    try {
      if (Date.now() > review.deadlineMs - 30_000) throw new Error("The quote expired. Get a new one. Nothing was sent.");
      const { chainId, tx } = buildDepositTx(review.from, review.amount, review.depositAddress, walletAddress);
      // The wallet must be signing as the account the quote refunds to.
      const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      // Blocks only on a POSITIVE mismatch: some connectors return [] here, and the refund
      // still goes to the connected address either way.
      if (Array.isArray(accounts) && accounts.length > 0 && !accounts.some((a) => typeof a === "string" && a.toLowerCase() === walletAddress.toLowerCase()))
        throw new Error("Your wallet is on a different account than the one connected. Switch back, then review again. Nothing was sent.");
      setBusy(`Switch to ${CHAIN_NAME[XC_ASSETS[review.from].chain as keyof typeof CHAIN_NAME]} in your wallet…`);
      await ensureChain(provider, chainId);
      // Check the balance first: an ERC-20 transfer that's short reverts and still costs gas.
      const bal = await originBalance(provider, XC_ASSETS[review.from].token, walletAddress);
      if (bal != null && bal < review.amount)
        throw new Error(`Not enough ${XC_ASSETS[review.from].sym} on ${CHAIN_NAME[XC_ASSETS[review.from].chain as keyof typeof CHAIN_NAME]}. Nothing was sent.`);
      setBusy("Confirm the transfer in your wallet…");
      // chainId inside the tx: wallets that honour it (MetaMask and most others) refuse to sign
      // if the user flipped networks between the switch above and this prompt.
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ ...tx, chainId: "0x" + chainId.toString(16) }] })) as string;
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet didn't return a transaction hash. Check your wallet before retrying.");
      // Optional speed-up: tell 1Click which tx paid the address. Best effort only.
      fetch(`${ONE_CLICK_API}/v0/deposit/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositAddress: review.depositAddress, txHash: hash }) }).catch(() => {});
      if (!alive.current) return;
      setTrack({ status: "PENDING_DEPOSIT", hash, chainId, depositAddress: review.depositAddress, deliveredUrl: null, startedAt: Date.now(), recipient: review.recipient, refundTo: walletAddress, fromChain: XC_ASSETS[review.from].chain, check: null });
      setReceipt(null);
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
        if (SETTLE_WORDS.has(status)) { confirmOnChain(depositAddress); return; }
        // INCOMPLETE_DEPOSIT isn't the end: 1Click refunds it by the deadline, so keep following.
        if (TERMINAL.has(status) && status !== "INCOMPLETE_DEPOSIT") return;
      } catch { /* keep polling */ }
    }
    if (alive.current) setTrack((t) => (t && statusOpen(t) ? { ...t, timedOut: true } : t));
  }

  // 1Click said SUCCESS / REFUNDED: prove it from the chain. Re-asks while the verdict can still
  // change (not final yet, a read failed): every 15 s for 2 min, then every minute, ~30 min in all
  // (L2 "safe" takes minutes, Ethereum "finalized" ~13). Only the verdict and its numbers are kept.
  async function confirmOnChain(depositAddress: string) {
    for (let i = 0; i < 36 && alive.current; i++) {
      if (i > 0) await new Promise((res) => setTimeout(res, i <= 8 ? 15000 : 60000));
      let check: Check;
      try {
        const r = await fetch(`${XC_WORKER_API}/xc/settlement?depositAddress=${encodeURIComponent(depositAddress)}`);
        const j = await r.json().catch(() => null);
        check = j && typeof j === "object" ? (j as Check) : { error: `HTTP ${r.status}` };
      } catch { check = { error: "unreachable" }; }
      if (!alive.current) return;
      const keep: Check = {
        verdict: check.verdict, chain: check.chain, to: check.to, final: check.final, error: check.error, reason: check.reason,
        kind: check.kind, asset: check.asset, decimals: check.decimals, bar: check.bar, credited: check.credited,
        txs: Array.isArray(check.txs) ? check.txs.slice(0, 10).map((x) => ({ hash: x.hash, ok: x.ok, credited: x.credited, final: x.final, reason: x.reason, note: x.note, method: x.method })) : undefined,
      };
      setTrack((t) => (t && t.depositAddress === depositAddress ? { ...t, check: keep } : t));
      // Spot ledger: report once the delivery shows on-chain; the worker re-checks it before booking.
      if ((check.verdict === "DELIVERED" || check.verdict === "CONFIRMING") && !reported.current.has(depositAddress)) {
        reported.current.add(depositAddress);
        reportSpotFill("near", depositAddress);
      }
      if (!check.error && check.verdict && !RECHECK.has(check.verdict)) return;
    }
  }

  const sel = { background: BG, border: `1px solid ${BORD}`, borderRadius: 10, color: BRIGHT, fontFamily: UI, fontSize: 13.5, padding: "9px 10px", width: "100%" } as const;
  const field = { display: "flex", flexDirection: "column" as const, gap: 6, flex: 1, minWidth: 0 };
  const lab = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: MUT };
  const fromName = CHAIN_NAME[XC_ASSETS[from].chain as keyof typeof CHAIN_NAME];
  const toName = CHAIN_NAME[dest.chain as keyof typeof CHAIN_NAME];

  return (
    <section aria-labelledby="xc-title" style={{ marginTop: 8, maxWidth: 640, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 id="xc-title" style={{ margin: 0, fontFamily: UI, fontSize: 16, color: BRIGHT, fontWeight: 600 }}>Cross-chain</h2>
        <span style={{ fontFamily: UI, fontSize: 13, color: MUT }}>via NEAR Intents · one transfer · no approval</span>
      </div>

      {tradingAccount && (walletAddress || solWallet) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" aria-pressed={fundMode}
            onClick={() => {
              if (fundMode) { setFundMode(false); return; }
              setFundMode(true); setTo(fundTo); setReview(null);
              if (from === fundTo || (fundTo === "USDC.sol" && XC_ASSETS[from].chain === "sol")) setFrom(fundFrom);
            }}
            style={{ background: fundMode ? BRIGHT : "transparent", color: fundMode ? "#0a0a0b" : FOG, border: `1px solid ${fundMode ? BRIGHT : BORD}`, borderRadius: 15, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
            Fund my trading account
          </button>
          {fundMode && <span style={{ fontFamily: UI, fontSize: 12, color: MUT }}>Lands as USDC on {CHAIN_NAME[XC_ASSETS[fundTo].chain as keyof typeof CHAIN_NAME]} in your trading wallet. Then one click deposits it.</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={field}><span style={lab}>FROM</span>
          <select value={from} onChange={(e) => { setFrom(e.target.value as AssetKey); setReview(null); }} style={sel}>
            {origins.map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        </label>
        <label style={field}><span style={lab}>TO</span>
          <select value={to} onChange={(e) => { setTo(e.target.value as AssetKey); setFundMode(false); setReview(null); }} style={sel}>
            {KEYS.filter((k) => k !== from).map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        </label>
      </div>

      <label style={field}><span style={lab}>AMOUNT ({XC_ASSETS[from].sym})</span>
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null); }} placeholder="0.00" style={sel} />
      </label>

      {evmDest && !typingEvm ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
          Delivered to your wallet on {toName}{walletAddress ? <> · <span style={{ color: FOG }}>{short(walletAddress)}</span></> : null}
        </div>
      ) : typingEvm ? (
        <label style={field}><span style={lab}>{toName.toUpperCase()} ADDRESS</span>
          <input value={typedEvm} onChange={(e) => { setTypedEvm(e.target.value); setReview(null); }} placeholder="0x… address" spellCheck={false} autoComplete="off" style={sel} />
          {typedEvm && !recipientOk && <span style={{ fontFamily: MONO, fontSize: 10.5, color: NEG }}>Not a valid {toName} address (check the letters’ case).</span>}
          <span style={{ fontFamily: UI, fontSize: 11.5, color: FAINT }}>No EVM wallet connected, so the address is typed. Check it twice: a wrong address can’t be undone.</span>
        </label>
      ) : (
        <label style={field}><span style={lab}>{toName.toUpperCase()} ADDRESS</span>
          <input value={typedRecipient} onChange={(e) => { setTypedRecipient(e.target.value); setReview(null); }} placeholder={dest.chain === "sol" ? (solWallet ? `Your Solana wallet · ${short(solWallet)}` : "Solana address") : "bc1… address"} spellCheck={false} autoComplete="off" style={sel} />
          {typedRecipient && !recipientOk && <span style={{ fontFamily: MONO, fontSize: 10.5, color: NEG }}>Not a {toName} address.</span>}
        </label>
      )}

      {solToSol && <div style={{ fontFamily: UI, fontSize: 12.5, color: MUT }}>Both sides are on Solana. Swap it with the Solana ticket above instead.</div>}
      {!sender ? (
        <div style={{ fontFamily: UI, fontSize: 13, color: MUT }}>{fromIsSol ? "Connect a Solana wallet to send from Solana." : connected || solWallet ? "Connect an EVM wallet to send from Arbitrum, Base or Ethereum." : "Connect a wallet to move funds across chains."}</div>
      ) : (
        <button type="button" onClick={getQuote} disabled={!canQuote}
          style={{ background: canQuote ? BRIGHT : "transparent", color: canQuote ? "#0a0a0b" : FAINT, border: `1px solid ${canQuote ? BRIGHT : BORD}`, borderRadius: 10, fontFamily: UI, fontSize: 14, fontWeight: 600, padding: "12px 0", cursor: canQuote ? "pointer" : "not-allowed" }}>
          {busy && !review ? busy : inFlight ? "Transfer in progress" : "Review"}
        </button>
      )}
      {err && !review && <div role="alert" style={{ fontFamily: MONO, fontSize: 11, color: NEG }}>{err}</div>}

      {track && (
        <div aria-live="polite" style={{ borderTop: `1px solid ${BORD}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6, fontFamily: MONO, fontSize: 11.5 }}>
          {(() => {
            // SUCCESS / REFUNDED read from the on-chain check; everything else is 1Click's word.
            const line = settlementLine(track.status, track.check ?? null, { recipient: track.recipient, refundTo: track.refundTo });
            if (line) return <div style={{ color: line.tone === "pos" ? POS : line.tone === "neg" ? NEG : line.tone === "muted" ? FOG : BRIGHT }}>{line.text}</div>;
            return (
              <div style={{ color: TERMINAL.has(track.status) ? NEG : BRIGHT }}>
                {STATUS_TEXT[track.status as keyof typeof STATUS_TEXT] || "In progress"}
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: MUT }}>
            {track.fromChain === "sol"
              ? <a href={solscanTx(track.hash)} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>your transfer ↗</a>
              : explorerTx(track.chainId, track.hash) && <a href={explorerTx(track.chainId, track.hash) as string} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>your transfer ↗</a>}
            {track.deliveredUrl && <a href={track.deliveredUrl} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>delivery ↗</a>}
            <a href="https://explorer.near-intents.org" target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>NEAR Intents explorer ↗</a>
          </div>
          <div style={{ color: FAINT, fontSize: 10.5, wordBreak: "break-all" }}>Deposit address · {track.depositAddress}</div>
          {track.timedOut && <div style={{ color: FOG, fontSize: 10.5 }}>Still in progress. Search the deposit address on the explorer to follow it.</div>}
          {depositHandoff(track.check ?? null, tradingAccount) && (
            <button type="button"
              onClick={() => {
                // Orderly's own deposit dialog (registered by the SDK under this id); the portfolio page if it isn't.
                try { void Promise.resolve(modal.show("DepositAndWithdrawWithDialogId", { activeTab: "deposit" })).catch(() => window.location.assign("/portfolio")); }
                catch { window.location.assign("/portfolio"); }
              }}
              style={{ alignSelf: "flex-start", background: BRIGHT, color: "#0a0a0b", border: `1px solid ${BRIGHT}`, borderRadius: 15, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer" }}>
              Deposit to your trading account
            </button>
          )}
          {receiptWanted(track, track.check ?? null) && (() => {
            const text = settlementReceipt({ ...track, chainName: track.fromChain ? CHAIN_NAME[track.fromChain as keyof typeof CHAIN_NAME] : undefined }, track.check ?? null);
            return (
              <>
                <div style={{ color: FOG, fontSize: 10.5 }}>Something needs a look. The receipt has every number 1Click support will ask for.</div>
                <button type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(text); setReceipt("copied"); } catch { setReceipt("shown"); }
                  }}
                  style={{ alignSelf: "flex-start", background: "transparent", color: FOG, border: `1px solid ${BORD}`, borderRadius: 15, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>
                  {receipt === "copied" ? "Receipt copied" : "Copy receipt"}
                </button>
                {receipt === "shown" && <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: FOG, fontSize: 10.5, userSelect: "all" }}>{text}</pre>}
              </>
            );
          })()}
          {TERMINAL.has(track.status) && (
            <button type="button" onClick={() => { setTrack(null); saveTrack(null); setReceipt(null); }}
              style={{ alignSelf: "flex-start", background: "transparent", color: MUT, border: `1px solid ${BORD}`, borderRadius: 15, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "5px 12px", cursor: "pointer" }}>Clear</button>
          )}
        </div>
      )}

      <div style={{ fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: FAINT }}>
        Quotes are signed by 1Click and checked in your browser: paid to your address, refunded to your address. Your wallet sends one transfer. If the swap can’t fill, it refunds to your wallet on {fromName}.
      </div>

      {review && (
        <div role="dialog" aria-modal="true" aria-labelledby="xc-review-title" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: "100%", maxWidth: 420, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 id="xc-review-title" style={{ margin: 0, fontFamily: UI, fontSize: 16, fontWeight: 600, color: BRIGHT }}>Review transfer</h3>
            {[
              ["You send", `${fromUnits(review.amount.toString(), XC_ASSETS[from].decimals)} ${XC_ASSETS[from].sym} on ${fromName}`],
              ["You receive (est.)", `${fromUnits(String(review.quote.quote.amountOut), dest.decimals)} ${dest.sym} on ${toName}`],
              ["Minimum received", `${fromUnits(review.minAmountOut, dest.decimals)} ${dest.sym}`],
              ["Delivered to", review.recipient],
              ["Refunds to", review.refundTo],
              ["Deposit address", review.depositAddress],
              ["Time", review.quote.quote.timeEstimate ? `~${review.quote.quote.timeEstimate}s after your transfer confirms` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: MONO, fontSize: 11.5 }}>
                <span style={{ color: MUT, flexShrink: 0 }}>{k}</span>
                <span style={{ color: BRIGHT, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
              </div>
            ))}
            <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG }}>✓ Signed by 1Click · recipient and refund are yours</div>
            <div style={{ fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: FAINT }}>Fees are inside the quote. Send exactly this amount, once.</div>
            {err && <div role="alert" style={{ fontFamily: MONO, fontSize: 11, color: NEG }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setReview(null)} disabled={!!busy}
                style={{ flex: 1, background: "transparent", color: FOG, border: `1px solid ${BORD}`, borderRadius: 10, fontFamily: UI, fontSize: 13, fontWeight: 600, padding: "11px 0", cursor: busy ? "not-allowed" : "pointer" }}>Cancel</button>
              <button type="button" onClick={send} disabled={!!busy}
                style={{ flex: 2, background: BRIGHT, color: "#0a0a0b", border: "none", borderRadius: 10, fontFamily: UI, fontSize: 13, fontWeight: 600, padding: "11px 0", cursor: busy ? "wait" : "pointer" }}>{busy || "Send transfer"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
