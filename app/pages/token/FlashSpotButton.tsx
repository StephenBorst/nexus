// ── Flash (Definitive) — a THIRD EVM router on the Spot terminal, next to Fabric ─────
// Additive: Fabric stays first, the named Uniswap deep-link stays the no-route fallback, and
// this is the extra in-app router. Order types (all live-verified against real quotes,
// 2026-09-27): MARKET, LIMIT, TWAP, and STOP (a breakout buy / a stop-loss sell). A market BUY
// can carry an SL/TP pair when the quote echoes one back. The FLASH_API_KEY stays on our worker
// proxy; the user signs the EIP-712 order in their OWN wallet. The confirm button always gates
// the signature — never auto-submit. EVM chains only (Solana uses the app's Jupiter path).
//
// What the signature does and doesn't bind (Flash's own docs, and our guards): it caps the
// spend, pins the recipient to this wallet and sets the deadline. A limit/stop PRICE is held
// and enforced by Definitive's engine, not by the signature — the ticket says so.
import { useId, useRef, useState } from "react";
import { parseTransaction } from "viem";
import { EVM_USDC, ensureChain } from "./swapExec";
import {
  checkFlashOrder, checkFlashSetupTx, checkFlashBracket, encodeApprove, toBaseUnits, openSpend, approvalPlan, FLASH_ALLOWANCE,
} from "@/lib/flashGuards.mjs";
import { describeFlashOrder } from "@/lib/flashOrders.mjs";
import { FLASH, FLASH_CHANGED, fetchOpenOrders, fetchOrder, erc20Balance, human, txLink, type Eip1193 } from "./flashApi";
import { useEscapeKey } from "@/utils/a11y";

// DexScreener chain id == Flash targetChain for these EVM chains. Contra (USDC) comes from EVM_USDC.
const FLASH_EVM = new Set(["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc", "avalanche"]);

const MONO = "var(--nx-font-mono)", UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUT = "#71717a", FAINT = "#52525b", BORD = "#232327", CARD = "#0f0f11", BG = "#08080a", POS = "#3ecf8e", NEG = "#f7525f";

type OType = "market" | "limit" | "twap" | "stop";
type FlashType = "market" | "limit" | "twap" | "stop" | "stop-loss";
const flashType = (t: OType, side: "buy" | "sell"): FlashType => (t === "stop" ? (side === "buy" ? "stop" : "stop-loss") : t);
const EXPIRIES = [
  { k: "1d", label: "1D", s: 86400 },
  { k: "7d", label: "7D", s: 7 * 86400 },
  { k: "30d", label: "30D", s: 30 * 86400 },
  { k: "gtc", label: "GTC", s: 0 },
] as const;
const DURATIONS = [
  { label: "15M", s: 900 },
  { label: "1H", s: 3600 },
  { label: "4H", s: 14400 },
  { label: "24H", s: 86400 },
] as const;
const TAB_TEXT: Record<OType, (side: "buy" | "sell") => string> = {
  market: (s) => `Market ${s} now. MEV-protected, and you sign it in your own wallet.`,
  limit: (s) => (s === "buy" ? "Buys only at your price or lower." : "Sells only at your price or higher."),
  twap: () => "Splits the order into slices over time, so one big fill doesn’t move the price.",
  stop: (s) => (s === "buy" ? "Buys at market once price rises to your trigger." : "Sells at market if price falls to your trigger."),
};

// Wait for a receipt and require success. A reverted approval must stop the flow (the order
// would fail anyway); a receipt that never lands is "still pending", never "done".
async function waitReceipt(provider: Eip1193, hash: string, tries = 45): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { blockNumber?: unknown; status?: string } | null;
      if (r && r.blockNumber) {
        if (r.status && r.status !== "0x1") throw new Error("The approval transaction reverted — nothing was traded.");
        return;
      }
    } catch (e) { if ((e as Error)?.message?.includes("reverted")) throw e; /* else keep polling */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("The approval is still pending — wait for it to confirm, then retry.");
}

// ERC-20 decimals() via the wallet's own RPC (the wallet is already on the trade's chain).
async function tokenDecimals(provider: Eip1193, token: string): Promise<number> {
  const r = (await provider.request({ method: "eth_call", params: [{ to: token, data: "0x313ce567" }, "latest"] })) as string;
  const d = Number(BigInt(r || "0x0"));
  if (!Number.isInteger(d) || d <= 0 || d > 36) throw new Error("Couldn't read the token's decimals — try again.");
  return d;
}

const refused = (why: string) => new Error(`Refused before signing: ${why}.`);
const posNum = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8 });

type Done = { id: string; kind: FlashType; state: "watching" | "filled" | "failed" | "slow" | "resting"; got?: string; tx?: string | null; reason?: string };

export function FlashSpotButton({ chainId, tokenAddress, symbol, side, defaultAmount, defaultSl, defaultTp, priceUsd, walletAddress, provider }: {
  chainId: string; tokenAddress: string; symbol: string; side: "buy" | "sell"; defaultAmount?: string;
  // A LONG thesis "Express on Spot" carries its FROZEN R-dollar stop/TP1 in via the URL → these
  // seed the STOP $ / TP $ fields (buy only; a bracket still attaches only when the quote echoes it).
  defaultSl?: string; defaultTp?: string;
  priceUsd?: number | null; // the page's live price: a reference line + trigger-side sanity check
  walletAddress?: string | null; provider?: Eip1193 | null;
}) {
  const okSl = (v?: string) => side === "buy" && !!v && parseFloat(v) > 0;
  const usdc = EVM_USDC[chainId]?.usdc;
  const [open, setOpen] = useState(false);
  const [otype, setOtype] = useState<OType>("market");
  const [size, setSize] = useState(defaultAmount && parseFloat(defaultAmount) > 0 ? defaultAmount : (side === "buy" ? "25" : ""));
  const [px, setPx] = useState(""); // limit price or stop trigger, USD per token
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]["k"]>("7d");
  const [dur, setDur] = useState<number>(3600);
  const [sl, setSl] = useState(okSl(defaultSl) ? (defaultSl as string) : ""); const [tp, setTp] = useState(okSl(defaultTp) ? (defaultTp as string) : "");
  const [preview, setPreview] = useState<{ est: string; min: string; fee: string; bracket: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<Done | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const fid = useId();
  const previewSeq = useRef(0); // only the newest preview request may land (tab flips race)
  // Escape = the backdrop click: never while a signature is pending.
  useEscapeKey(() => { if (!busy) setOpen(false); }, open);

  if (!FLASH_EVM.has(chainId) || !usdc) return null; // EVM + known USDC only

  const ft = flashType(otype, side);
  const resting = ft !== "market";
  const outSym = side === "buy" ? symbol : "USDC";
  const inSym = side === "buy" ? "USDC" : symbol;
  const now = priceUsd && priceUsd > 0 ? priceUsd : null;
  const wantsBracket = ft === "market" && side === "buy" && (posNum(sl) > 0 || posNum(tp) > 0);
  // Flash takes the pair only as BOTH legs (one alone = "Request validation failed", live-checked).
  // One leg typed must never read as protection that isn't there, so the ticket waits for both.
  const halfBracket = wantsBracket && !(posNum(sl) > 0 && posNum(tp) > 0);

  // Trigger/limit sanity against the page's live price. A stop whose trigger is already crossed
  // is cancelled by Flash on entry (REASON_ORDER_TRIGGERED_ON_ENTRY) → block it here; a limit on
  // the far side of the market is legal (it just fills now) → say so.
  const pxN = posNum(px);
  const pxIssue: { block: boolean; text: string } | null = (() => {
    if (!now || !pxN || (ft !== "limit" && ft !== "stop" && ft !== "stop-loss")) return null;
    if (ft === "stop" && pxN <= now) return { block: true, text: `Price is already at or above ${fmtUsd(pxN)}. Set the trigger above ${fmtUsd(now)}.` };
    if (ft === "stop-loss" && pxN >= now) return { block: true, text: `Price is already at or below ${fmtUsd(pxN)}. Set the trigger below ${fmtUsd(now)}.` };
    if (ft === "limit" && side === "buy" && pxN >= now) return { block: false, text: "At or above the market: this fills now, like a market buy." };
    if (ft === "limit" && side === "sell" && pxN <= now) return { block: false, text: "At or below the market: this fills now, like a market sell." };
    return null;
  })();
  const needsPx = ft === "limit" || ft === "stop" || ft === "stop-loss";
  const canPlace = posNum(size) > 0 && (!needsPx || pxN > 0) && !pxIssue?.block && !halfBracket;

  // Expiry is fixed ONCE per placement: the same ISO goes on the quote and the order, and the
  // guard checks the signed deadline against it.
  const expiryNow = (f: FlashType = ft): { iso: string; s: number } | null => {
    if (!(f === "limit" || f === "stop" || f === "stop-loss")) return null;
    const e = EXPIRIES.find((x) => x.k === expiry)!;
    if (!e.s) return null; // GTC
    const s = Math.floor(Date.now() / 1000) + e.s;
    return { iso: new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"), s };
  };

  // The quote request. `order: true` = the /order echo: Flash wants the same params back, minus
  // the quote-time-only fields (durationSeconds, expireTime, forceMinimalAllowance — none is in
  // the /v1/order schema; the signed deadline carries the expiry) and minus the bracket block
  // (added separately with its own signature).
  // `over` lets a tab or duration tap preview the NEW choice before React re-renders with it.
  type Over = { otype?: OType; dur?: number };
  type ReqOpts = { order?: boolean; withBracket?: boolean; exp?: { iso: string } | null; over?: Over };
  const requestBody = (qty: string, { order = false, withBracket = false, exp = null, over = {} }: ReqOpts = {}) => {
    const f = over.otype ? flashType(over.otype, side) : ft;
    const d = over.dur ?? dur;
    const b: Record<string, unknown> = {
      targetChain: chainId, contraChain: chainId, targetAsset: tokenAddress, contraAsset: usdc,
      side, qty: String(qty), orderType: f,
      ...(walletAddress ? { funderAddress: walletAddress } : {}),
    };
    if (f === "market") b.maxSlippage = "0.02";
    if (f === "limit") b.limitNotionalPrice = String(pxN);
    if (f === "stop" || f === "stop-loss") b.triggers = [{ notionalPrice: String(pxN), triggerType: f === "stop" ? "upper" : "lower" }];
    const bracket = withBracket && f === "market" && side === "buy" && posNum(sl) > 0 && posNum(tp) > 0;
    if (!order) {
      if (exp) b.expireTime = exp.iso;
      if (f === "twap") b.durationSeconds = d;
      // Ask Flash for the cumulative approval instead of an unlimited one. Flash refuses the flag
      // alongside a bracket; there, approvalPlan caps Flash's unlimited approve on our side.
      if (!bracket) b.forceMinimalAllowance = true;
      if (bracket) {
        const ab: Record<string, unknown> = {};
        if (posNum(tp) > 0) ab.takeProfit = { notionalPrice: String(tp) };
        if (posNum(sl) > 0) ab.stopLoss = { notionalPrice: String(sl) };
        b.attachedBracket = ab;
      }
    }
    return b;
  };

  const fetchPreview = async (qty: string, over: Over = {}) => {
    setErr(null);
    const f = over.otype ? flashType(over.otype, side) : ft;
    const mine = ++previewSeq.current;
    if (!(parseFloat(qty) > 0) || ((f === "limit" || f === "stop" || f === "stop-loss") && !pxN)) { setPreview(null); return; }
    try {
      const r = await fetch(`${FLASH}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(qty, { withBracket: true, exp: expiryNow(f), over })) });
      const q = await r.json();
      if (mine !== previewSeq.current) return; // a newer preview is in flight
      if (!r.ok) throw new Error(q?.error?.message || q?.message || (r.status === 401 ? "Flash key invalid (Portfolio, not Flash)." : `quote ${r.status}`));
      const est = String(q?.to?.amount ?? "");
      const slip = parseFloat(q?.recommendedSlippage ?? "0.01") || 0.01;
      setPreview({ est, min: est && f === "market" ? String(parseFloat(est) * (1 - slip)) : "", fee: String(q?.fees?.estimatedFeeNotional ?? ""), bracket: !!q?.attachedBracket });
    } catch (e) { if (mine === previewSeq.current) { setErr((e as Error)?.message || "quote failed"); setPreview(null); } }
  };

  // Poll a just-placed MARKET order until it settles, so the card says what happened instead of
  // assuming a fill. Reads can trail a placement by a second or two (404 → keep polling).
  const watchMarket = async (id: string, wallet: string) => {
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      try {
        const got = await fetchOrder(wallet, id);
        if (!got) continue;
        const st = String(got.order.status || "");
        if (st === "ORDER_STATUS_FILLED") {
          const amt = side === "buy" ? (got.order.filled as { targetAmount?: string } | undefined)?.targetAmount : (got.order.filled as { contraAmount?: string } | undefined)?.contraAmount;
          const tx = (got.fills.find((f) => typeof f.transactionId === "string")?.transactionId as string | undefined) ?? null;
          setDone((d) => (d && d.id === id ? { ...d, state: "filled", got: amt, tx } : d));
          window.dispatchEvent(new Event(FLASH_CHANGED));
          return;
        }
        if (st === "ORDER_STATUS_CANCELLED" || st === "ORDER_STATUS_REJECTED" || st === "ORDER_STATUS_TERMINATED") {
          const d0 = describeFlashOrder(got.order);
          setDone((d) => (d && d.id === id ? { ...d, state: "failed", reason: d0.reason || d0.status } : d));
          window.dispatchEvent(new Event(FLASH_CHANGED));
          return;
        }
      } catch { /* keep polling */ }
    }
    setDone((d) => (d && d.id === id && d.state === "watching" ? { ...d, state: "slow" } : d));
  };

  const run = async () => {
    setErr(null); setDone(null); setBusy(true); setStatus("Getting a quote…");
    try {
      if (!provider || !walletAddress) throw new Error("Connect a wallet first.");
      const wallet = walletAddress;
      const exp = expiryNow();
      const r = await fetch(`${FLASH}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(size, { withBracket: true, exp })) });
      const q = await r.json();
      if (!r.ok) throw new Error(q?.error?.message || q?.message || q?.error || (r.status === 401 ? "Flash key invalid (Portfolio, not Flash). Regenerate it." : `quote failed (${r.status})`));
      // ── Pre-signature guards (app/lib/flashGuards.mjs) — nothing reaches the wallet unchecked ──
      // Right chain first, then the ORDER is validated before any approval is sent: a FlashOrder
      // on this chain against the pinned Flash contract, bound to THIS wallet as swapper and
      // recipient, spending the right token, no more than the size entered, with the deadline
      // this order type should carry (market ≤ 1h, GTT = the expiry asked, GTC = the sentinel,
      // TWAP = start + duration + buffer).
      const chainNum = EVM_USDC[chainId].chainId;
      await ensureChain(provider, chainNum);
      const fromToken = side === "buy" ? usdc : tokenAddress;
      const toToken = side === "buy" ? tokenAddress : usdc;
      const fromDec = await tokenDecimals(provider, fromToken);
      const typedUnits = toBaseUnits(size, fromDec);
      if (typedUnits == null || typedUnits === 0n) throw new Error("Enter a valid size.");
      const bal = await erc20Balance(provider, fromToken, wallet);
      if (bal < typedUnits) throw new Error(`This wallet holds ${human(bal, fromDec)} ${inSym}, less than this order.`);
      const maxFromAmount = typedUnits + 1n; // one base unit of rounding slack (a long-decimal sell), nothing more
      const chk = checkFlashOrder(q?.evm?.orderTypedData, {
        chainId: chainNum, wallet, fromToken, toToken, maxFromAmount,
        orderType: ft, expireAtS: exp ? exp.s : null, durationS: ft === "twap" ? dur : undefined,
      });
      if (!chk.ok) throw refused(chk.reason ?? "order check failed");
      // A permit is a spend authorization we haven't seen Flash use — never sign one blind.
      if (q?.evm?.permitTypedData) throw refused("Flash asked for an unexpected permit signature");

      // The SL/TP pair is checked BEFORE any approval goes out, so a refused pair never leaves a
      // dangling approval behind. It sells the BOUGHT token from this wallet, so its signed max
      // is capped at 1.2× the quoted output (live headroom is ~5%).
      const ab = q?.attachedBracket;
      const pairAsked = ft === "market" && side === "buy" && posNum(tp) > 0 && posNum(sl) > 0;
      // Typed SL/TP but Flash didn't offer the pair → stop here; never buy "protected" without it.
      if (pairAsked && !ab?.evm?.orderTypedData) throw new Error("Flash didn’t offer the SL/TP pair for this token. Clear STOP/TP to buy without them.");
      let pair: { fromAmount: bigint } | null = null;
      let boughtDec = 0;
      if (pairAsked) {
        boughtDec = await tokenDecimals(provider, tokenAddress);
        const out = toBaseUnits(String(q?.to?.amount ?? ""), boughtDec);
        if (out == null || out === 0n) throw refused("the quote has no output to protect. Clear STOP/TP to trade market-only");
        const bc = checkFlashBracket(ab.evm.orderTypedData, { chainId: chainNum, wallet, boughtToken: tokenAddress, contraToken: usdc, maxFromAmount: (out * 6n) / 5n });
        if (!bc.ok) throw refused(`${bc.reason}. Clear STOP/TP to trade market-only`);
        if (ab?.evm?.permitTypedData) throw refused("the SL/TP asked for an unexpected permit. Clear STOP/TP to trade market-only");
        pair = { fromAmount: bc.fromAmount as bigint };
      }

      // One approval to the pinned Flash contract, sized by approvalPlan: never unlimited, never
      // more than this order + the wallet's OPEN Flash orders on the same token (they share the
      // allowance — approving only this order would starve them), never less than this order.
      const approve = async (raw: { to?: string | null; data?: string | null; value?: bigint | null }, token: string, fromAmount: bigint, decimals: number, sym: string) => {
        const st = checkFlashSetupTx({ to: raw.to ?? undefined, data: raw.data ?? undefined, value: raw.value ?? 0n }, { fromToken: token });
        if (!st.ok) throw refused(st.reason ?? "approval check failed");
        let openAmt = 0n;
        if ((st.amount as bigint) > fromAmount) {
          setStatus("Reading your open Flash orders to size the approval…");
          const rows = await fetchOpenOrders(wallet);
          const o = rows ? openSpend(rows, { chain: chainId, token, decimals }) : null;
          if (o == null) throw new Error("Couldn't read your open Flash orders to size the approval. Nothing was sent; try again.");
          openAmt = o;
        }
        const plan = approvalPlan({ flashAmount: st.amount as bigint, fromAmount, openAmount: openAmt });
        if (!plan.ok) throw refused(plan.reason as string);
        const amount = plan.amount as bigint;
        setStatus(amount === 0n ? `Reset the ${sym} approval for Flash…`
          : openAmt > 0n ? `Approve ${human(amount, decimals)} ${sym} for Flash (this order + your open orders)…`
          : `Approve exactly ${human(amount, decimals)} ${sym} for Flash…`);
        const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: wallet, to: token, data: encodeApprove(FLASH_ALLOWANCE, amount), value: "0x0" }] })) as string;
        setStatus("Waiting for approval to confirm…"); await waitReceipt(provider, hash);
      };

      const setupTxs: string[] = Array.isArray(q?.setupTxs) ? q.setupTxs : [];
      for (const raw of setupTxs) {
        let p: ReturnType<typeof parseTransaction>;
        try { p = parseTransaction(raw as `0x${string}`); } catch { throw refused("Flash sent a setup transaction we can’t read"); }
        await approve({ to: p.to, data: p.data, value: p.value }, fromToken, chk.fromAmount as bigint, fromDec, inSym);
      }
      // The pair's OWN approval of the bought token (Flash returns it on attachedBracket.evm, not in
      // setupTxs). Without it the exits can't pull the tokens when a leg fires.
      if (pair && ab?.evm?.approveTx) {
        await approve({ to: ab.evm.approveTx.to, data: ab.evm.approveTx.data, value: 0n }, tokenAddress, pair.fromAmount, boughtDec, symbol);
      }

      setStatus(resting ? "Sign the order in your wallet (no gas)…" : "Sign the order in your wallet…");
      const sign = async (td: unknown) => (await provider.request({ method: "eth_signTypedData_v4", params: [wallet, typeof td === "string" ? td : JSON.stringify(td)] })) as string;
      const typed = q.evm.orderTypedData;
      const userSignature = await sign(typed);
      // Flash /v1/order wants the order params echoed back (same as the quote, minus the
      // quote-time-only fields) PLUS userSignature; quoteId + evmOrderTypedData bind it to the quote.
      const body: Record<string, unknown> = { ...requestBody(size, { order: true, exp }), quoteId: q.quoteId, userSignature, evmOrderTypedData: typed };
      if (pair) {
        setStatus("Sign the SL/TP pair in your wallet…");
        body.attachedBracket = {
          takeProfit: { notionalPrice: String(tp) }, stopLoss: { notionalPrice: String(sl) },
          userSignature: await sign(ab.evm.orderTypedData),
          salt: ab.salt, deadline: ab.deadline, signedMaxFromAmount: ab.signedMaxFromAmount,
        };
      }
      setStatus("Submitting…");
      const or = await fetch(`${FLASH}/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      // Surface the RAW Flash body (the worker forwards it verbatim) so a 4xx shows the exact
      // validation failure in the modal instead of a swallowed one-line message.
      const rawBody = await or.text();
      let order: Record<string, unknown> = {};
      try { order = JSON.parse(rawBody); } catch { /* non-JSON — the raw text is shown below */ }
      if (!or.ok) {
        const msg = (order?.error as { message?: string })?.message || (order?.message as string) || (typeof order?.error === "string" ? (order.error as string) : "");
        throw new Error(`Flash ${or.status}${msg ? " · " + msg : ""}\n${rawBody.slice(0, 400)}`);
      }
      const id = (order?.orderId as string) || "";
      setDone({ id, kind: ft, state: resting ? "resting" : "watching" });
      window.dispatchEvent(new Event(FLASH_CHANGED));
      if (!resting && id) void watchMarket(id, wallet);
    } catch (e) { setErr((e as Error)?.message || "Flash order failed."); }
    finally { setBusy(false); setStatus(""); }
  };

  // Re-seed SIZE from the live ticket every open (the component stays mounted, so the useState
  // initializer alone would miss an amount typed after mount, and a side flip). Buy empty → "25"
  // starter; sell empty → "" (never an invented default). Mirrors the initializer.
  const openModal = () => {
    const seed = defaultAmount && parseFloat(defaultAmount) > 0 ? defaultAmount : (side === "buy" ? "25" : "");
    setSize(seed);
    // Re-apply the thesis stop/TP ONLY when the Express link carried them — never clobber a stop the
    // user typed directly on the Spot terminal with an empty default.
    if (okSl(defaultSl)) setSl(defaultSl as string);
    if (okSl(defaultTp)) setTp(defaultTp as string);
    setOpen(true); setDone(null); setErr(null); setShareCopied(false);
    if (otype === "market") fetchPreview(seed); else setPreview(null);
  };
  const pickType = (t: OType) => {
    if (busy) return;
    setOtype(t); setPreview(null); setErr(null); setDone(null);
    void fetchPreview(size, { otype: t }); // clears itself when the new type still needs a price
  };
  // Flash success card share link — the token's Spot page (same /token/{ca} the share-on-swap card uses).
  const copyShare = () => {
    try { navigator.clipboard.writeText(`${window.location.origin}/token/${tokenAddress}?venue=spot`); setShareCopied(true); setTimeout(() => setShareCopied(false), 1600); } catch { /* clipboard blocked */ }
  };
  const inStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: BG, border: "1px solid #33333a", borderRadius: 6, color: BRIGHT, fontFamily: MONO, outline: "none" };
  const chip = (on: boolean): React.CSSProperties => ({ flex: 1, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: on ? BRIGHT : FAINT, background: on ? "#ededf012" : "none", border: `1px solid ${on ? "#ededf033" : BORD}`, borderRadius: 6, padding: "6px 0", cursor: busy ? "default" : "pointer" });
  const label: React.CSSProperties = { display: "block", fontSize: 9, letterSpacing: "0.1em", color: MUT, marginBottom: 5 };
  const placeText = busy ? "WORKING…" : ft === "market" ? "CONFIRM & SIGN" : ft === "twap" ? "PLACE TWAP" : ft === "limit" ? "PLACE LIMIT" : "PLACE STOP";
  const tabs: OType[] = ["market", "limit", "twap", "stop"];
  const tabName = (t: OType) => (t === "stop" ? (side === "buy" ? "STOP" : "STOP-LOSS") : t.toUpperCase());

  return (
    <>
      <button onClick={openModal}
        style={{ display: "block", width: "100%", textAlign: "center", marginTop: 8, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: POS, background: "none", border: `1px solid ${POS}44`, borderRadius: 9, padding: "10px 0", cursor: "pointer" }}>
        ◇ {side === "sell" ? "Sell" : "Buy"} {symbol} via Flash <span style={{ color: FAINT, fontWeight: 400 }}>· limit · TWAP · stop</span>
      </button>
      {open && (
        <div role="presentation" onClick={(e) => { if (e.target === e.currentTarget) !busy && setOpen(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-label="Flash order" style={{ width: "100%", maxWidth: 400, maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: CARD, border: "1px solid #33333a", borderRadius: 12, padding: 20, fontFamily: MONO, boxSizing: "border-box" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: BRIGHT, letterSpacing: "0.06em", marginBottom: 10 }}>◇ FLASH · {side === "sell" ? "SELL" : "BUY"} {symbol}</div>
            <div role="tablist" aria-label="Order type" style={{ display: "flex", gap: 6, marginBottom: 9 }}>
              {tabs.map((t) => (
                <button key={t} role="tab" aria-selected={otype === t} disabled={busy} onClick={() => pickType(t)} style={chip(otype === t)}>{tabName(t)}</button>
              ))}
            </div>
            <div style={{ fontFamily: UI, fontSize: 11, color: FOG, lineHeight: 1.5, marginBottom: 14 }}>{TAB_TEXT[otype](side)}</div>

            <label style={label} htmlFor={`${fid}-size`}>{ft === "twap" ? "TOTAL SIZE" : "SIZE"} ({inSym})</label>
            <input id={`${fid}-size`} value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal"
              style={{ ...inStyle, fontSize: 15, padding: "9px 12px", marginBottom: 12 }} />

            {needsPx && (
              <>
                <label style={label} htmlFor={`${fid}-px`}>
                  {ft === "limit" ? `LIMIT PRICE $ PER ${symbol}` : ft === "stop" ? `BUY IF PRICE RISES TO $` : `SELL IF PRICE FALLS TO $`}
                  {now ? <span style={{ color: FAINT }}> · now {fmtUsd(now)}</span> : null}
                </label>
                <input id={`${fid}-px`} value={px} onChange={(e) => setPx(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal" placeholder={now ? String(Number(now.toPrecision(6))) : "0.00"}
                  style={{ ...inStyle, fontSize: 14, padding: "8px 12px", marginBottom: pxIssue ? 6 : 12 }} />
                {pxIssue && <div style={{ fontFamily: UI, fontSize: 10.5, color: pxIssue.block ? NEG : FOG, lineHeight: 1.45, marginBottom: 12 }}>{pxIssue.text}</div>}
                <div style={label}>EXPIRES</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {EXPIRIES.map((e) => <button key={e.k} disabled={busy} onClick={() => setExpiry(e.k)} style={chip(expiry === e.k)} aria-pressed={expiry === e.k}>{e.label}</button>)}
                </div>
              </>
            )}

            {ft === "twap" && (
              <>
                <div style={label}>SPREAD OVER</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {DURATIONS.map((d) => <button key={d.s} disabled={busy} onClick={() => { setDur(d.s); void fetchPreview(size, { dur: d.s }); }} style={chip(dur === d.s)} aria-pressed={dur === d.s}>{d.label}</button>)}
                </div>
              </>
            )}

            {ft === "market" && side === "buy" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 8.5, letterSpacing: "0.08em", color: MUT, marginBottom: 4 }} htmlFor={`${fid}-sl`}>STOP $ (opt)</label>
                  <input id={`${fid}-sl`} value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal" placeholder="—" style={{ ...inStyle, color: NEG, border: `1px solid ${BORD}`, fontSize: 12, padding: "7px 9px" }} /></div>
                <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 8.5, letterSpacing: "0.08em", color: MUT, marginBottom: 4 }} htmlFor={`${fid}-tp`}>TP $ (opt)</label>
                  <input id={`${fid}-tp`} value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => fetchPreview(size)} inputMode="decimal" placeholder="—" style={{ ...inStyle, color: POS, border: `1px solid ${BORD}`, fontSize: 12, padding: "7px 9px" }} /></div>
              </div>
            )}
            {halfBracket && <div style={{ fontFamily: UI, fontSize: 10.5, color: FOG, lineHeight: 1.45, marginTop: -4, marginBottom: 12 }}>Flash attaches the stop and the take-profit as a pair. Set both, or clear both to buy without them.</div>}

            {preview && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, lineHeight: 1.7, marginBottom: 12, borderTop: `1px solid ${BORD}`, paddingTop: 10 }}>
                {ft === "market" && <>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Est. receive</span><span style={{ color: BRIGHT }}>{preview.est ? Number(preview.est).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Min received</span><span style={{ color: FOG }}>{preview.min ? Number(preview.min).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>
                </>}
                {ft === "limit" && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Receive at your price</span><span style={{ color: BRIGHT }}>≈ {preview.est ? Number(preview.est).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>}
                {ft === "twap" && <div style={{ display: "flex", justifyContent: "space-between" }}><span>At today’s price</span><span style={{ color: BRIGHT }}>≈ {preview.est ? Number(preview.est).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} {outSym}</span></div>}
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Fee</span><span style={{ color: FAINT }}>${preview.fee}</span></div>
                {wantsBracket && !halfBracket && <div style={{ display: "flex", justifyContent: "space-between" }}><span>SL/TP</span><span style={{ color: preview.bracket ? POS : FAINT }}>{preview.bracket ? "attached ✓" : "not offered, market only"}</span></div>}
              </div>
            )}

            {resting && (
              <div style={{ fontFamily: UI, fontSize: 10.5, color: MUT, lineHeight: 1.55, marginBottom: 12 }}>
                Rests with Definitive until it fills, expires or you cancel. Keep the {inSym} in this wallet until then.
                {" "}Your signature caps the spend and sends the output only to this wallet. The {ft === "twap" ? "schedule" : "price"} is enforced by Definitive’s engine, not by the signature.
                {ft === "stop" || ft === "stop-loss" ? " Once triggered it fills at market; on thin tokens that can be well past the trigger." : ""}
              </div>
            )}
            {wantsBracket && posNum(sl) > 0 && posNum(tp) > 0 && (
              <div style={{ fontFamily: UI, fontSize: 10.5, color: MUT, lineHeight: 1.55, marginBottom: 12 }}>
                The SL/TP pair sells the {symbol} this buy receives, from this wallet. It needs its own approval, and the {symbol} has to stay here for it to fire.
              </div>
            )}

            {busy && status && <div style={{ fontFamily: UI, fontSize: 11, color: FOG, marginBottom: 12 }}>{status}</div>}
            {err && <div style={{ fontFamily: MONO, fontSize: 10.5, color: NEG, lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 168, overflowY: "auto", background: BG, border: `1px solid ${BORD}`, borderRadius: 6, padding: "8px 10px" }}>{err}</div>}
            {done && (() => {
              // Honest card: what Flash says happened, not what we hoped. Market orders are polled
              // until they settle; resting orders say where they live and how to stop them.
              const nUsd = side === "buy" ? parseFloat(size) : parseFloat(preview?.est || "");
              const dollar = Number.isFinite(nUsd) && nUsd > 0 ? `$${nUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
              const link = txLink(chainId, done.tx);
              const head = done.state === "filled" ? "Filled on Flash ✓"
                : done.state === "failed" ? "Not filled"
                : done.state === "resting" ? `${tabName(otype)} order resting ✓`
                : done.state === "slow" ? "Submitted. Still settling"
                : "Submitted. Waiting for the fill…";
              const color = done.state === "failed" ? NEG : done.state === "filled" || done.state === "resting" ? POS : FOG;
              return (
                <div style={{ background: BG, border: `1px solid ${BORD}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 9.5, letterSpacing: "0.08em", color: FAINT, marginBottom: 3 }}>{symbol} · FLASH{dollar ? ` · ${dollar}` : ""}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>{head}</div>
                  {done.state === "filled" && done.got && <div style={{ fontSize: 10.5, color: FOG, marginBottom: 6 }}>Received {Number(done.got).toLocaleString("en-US", { maximumFractionDigits: 6 })} {outSym}{link ? <> · <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>tx ↗</a></> : null}</div>}
                  {done.state === "failed" && done.reason && <div style={{ fontFamily: UI, fontSize: 10.5, color: FOG, marginBottom: 6 }}>Flash: {done.reason}. Nothing left your wallet.</div>}
                  {done.state === "resting" && <div style={{ fontFamily: UI, fontSize: 10.5, color: FOG, marginBottom: 6 }}>It shows under Flash orders below. Cancel it there any time; cancelling is a gasless signature.</div>}
                  {done.state === "slow" && <div style={{ fontFamily: UI, fontSize: 10.5, color: FOG, marginBottom: 6 }}>Flash hasn’t reported the fill yet. Check Flash orders below.</div>}
                  <div style={{ fontSize: 9, color: FAINT, marginBottom: 9, wordBreak: "break-all" }}>order {done.id || "—"}</div>
                  <button onClick={copyShare} style={{ width: "100%", fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", color: shareCopied ? POS : BRIGHT, background: "none", border: `1px solid ${shareCopied ? "#3ecf8e88" : BORD}`, borderRadius: 7, padding: "9px 0", cursor: "pointer" }}>{shareCopied ? "✓ Link copied" : `Copy ${symbol} link ↗`}</button>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => !busy && setOpen(false)} style={{ flex: 1, background: "none", border: "1px solid #33333a", borderRadius: 7, padding: "9px 0", color: FOG, fontFamily: MONO, fontSize: 11, cursor: busy ? "default" : "pointer" }}>{done ? "CLOSE" : "CANCEL"}</button>
              {!done && <button onClick={run} disabled={busy || !canPlace} style={{ flex: 1.4, background: busy || !canPlace ? "#1a1a1e" : POS, border: "none", borderRadius: 7, padding: "9px 0", color: busy || !canPlace ? MUT : "#08080a", fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{placeText}</button>}
            </div>
            <div style={{ fontFamily: UI, fontSize: 9.5, color: FAINT, marginTop: 10 }}>Definitive Flash · MEV-protected · approvals sized to your orders, never unlimited</div>
          </div>
        </div>
      )}
    </>
  );
}
