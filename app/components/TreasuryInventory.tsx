/**
 * TreasuryInventory — the treasury "glass jar", v1 (scope B, borst-confirmed 2026-09-12).
 *
 * A public, read-only inventory of what the Nexus treasury actually holds, streamed live from the
 * chain (poll 45s, fail-soft). Two live sources, both clean enough to represent honestly:
 *   • HELD — the treasury Safe (1/1, Arbitrum+Base): USDC (both chains) + accumulated $NEXUS (Base,
 *     with % of supply) + a small ETH gas reserve (both chains). The war chest.
 *   • ACCRUING — the subs/AI receiver EOA: USDC + $NEXUS sitting pre-sweep.
 * Two sources are shown as STATIC LABELS only, never live balances, because the wallets are mixed /
 * personal and a live figure would misrepresent them (matches the "verify, don't trust" standard):
 *   • broker fees → borst.eth (Orderly-registered, swept manually)
 *   • x402 data revenue → the Bankr deployer wallet (shared/mixed)
 * No sweep transactions here — inventory only. Everything is a public balanceOf/getBalance, no secrets.
 *
 * Cosmetic/informational. $NEXUS stays a pure community meme token — no revenue share, no yield; the
 * treasury is a separate, fee-funded mechanism that accumulates $NEXUS and HOLDS it.
 */

import { useEffect, useState } from "react";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { arbitrum, base } from "viem/chains";
import { C } from "@/config/theme";

// ⚠️ Verified deployed addresses — DON'T edit (a one-char-off look-alike permanently ate a test send).
const SAFE = "0x4Fe2c01bbeFaFFa35706C994646a3F8493B1C733" as const;      // treasury Safe (Arbitrum+Base)
const SUBS = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A" as const;      // subs/AI receiver EOA
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const; // native USDC, 6 decimals
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const NEXUS = "0x3D958634ab725B627919EF8F2Ed59227309fDba3" as const;     // $NEXUS on Base, 18 decimals
const WETH_BASE = "0x4200000000000000000000000000000000000006" as const; // for the ETH/USD price

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

// CORS-friendly public RPCs (chain defaults rate-limit browsers) — fallback() tries each in order.
const baseClient = createPublicClient({ chain: base, transport: fallback([
  http("https://base.llamarpc.com"), http("https://base-rpc.publicnode.com"), http("https://base.drpc.org"), http(),
]) });
const arbClient = createPublicClient({ chain: arbitrum, transport: fallback([
  http("https://arbitrum.llamarpc.com"), http("https://arbitrum-one-rpc.publicnode.com"), http("https://arbitrum.drpc.org"), http(),
]) });

// $NEXUS + ETH USD price from GeckoTerminal (CLIENT-SIDE — GT 403s datacenter IPs), fail-soft → null.
async function gtPriceUsd(token: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/base/tokens/${token}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { attributes?: { price_usd?: string } } };
    const p = Number(j?.data?.attributes?.price_usd);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

const num = (r: PromiseSettledResult<bigint>, dec: number): number =>
  r.status === "fulfilled" ? Number(formatUnits(r.value, dec)) : 0;

// base & arbitrum clients have distinct viem chain types; the calls we make are identical, so pin a
// shared minimal shape (a client union won't let us call methods on it) — same trick as holdings.ts.
type BalanceClient = {
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
  readContract: (args: { address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "balanceOf" | "totalSupply"; args?: readonly unknown[] }) => Promise<bigint>;
};
const baseBC = baseClient as unknown as BalanceClient;
const arbBC = arbClient as unknown as BalanceClient;

interface Inv {
  safeUsdc: number; safeNexus: number; safeEth: number;
  subsUsdc: number; subsNexus: number;
  pctSupply: number | null;
  nexusPrice: number | null; ethPrice: number | null;
  ok: boolean; // at least one read succeeded
}

async function readInventory(): Promise<Inv | null> {
  const A = SAFE as `0x${string}`, S = SUBS as `0x${string}`;
  const bal = (client: BalanceClient, token: `0x${string}`, who: `0x${string}`) =>
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [who] });
  const [
    safeUsdcB, safeUsdcA, safeNexusB, safeEthB, safeEthA,
    subsUsdcB, subsUsdcA, subsNexusB, supply,
  ] = await Promise.allSettled([
    bal(baseBC, USDC_BASE, A), bal(arbBC, USDC_ARB, A), bal(baseBC, NEXUS, A),
    baseBC.getBalance({ address: A }), arbBC.getBalance({ address: A }),
    bal(baseBC, USDC_BASE, S), bal(arbBC, USDC_ARB, S), bal(baseBC, NEXUS, S),
    baseBC.readContract({ address: NEXUS, abi: ERC20_ABI, functionName: "totalSupply" }),
  ]);
  const anyOk = [safeUsdcB, safeUsdcA, safeNexusB, safeEthB, safeEthA, subsUsdcB, subsUsdcA, subsNexusB]
    .some((r) => r.status === "fulfilled");
  if (!anyOk) return null; // every read failed → let the caller render nothing

  const [nexusPrice, ethPrice] = await Promise.all([gtPriceUsd(NEXUS), gtPriceUsd(WETH_BASE)]);
  const safeNexus = num(safeNexusB, 18);
  const supplyN = supply.status === "fulfilled" ? Number(formatUnits(supply.value, 18)) : 0;
  return {
    safeUsdc: num(safeUsdcB, 6) + num(safeUsdcA, 6),
    safeNexus,
    safeEth: num(safeEthB, 18) + num(safeEthA, 18),
    subsUsdc: num(subsUsdcB, 6) + num(subsUsdcA, 6),
    subsNexus: num(subsNexusB, 18),
    pctSupply: supplyN > 0 ? (safeNexus / supplyN) * 100 : null,
    nexusPrice, ethPrice, ok: true,
  };
}

const fmtTok = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K`
  : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtUsd = (n: number): string =>
  n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// One inventory line: label · token amount · (USD, when priced).
function Line({ label, amount, sym, usd }: { label: string; amount: number; sym: string; usd: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ fontSize: 10.5, color: C.text.muted }}>{label}</span>
      <span style={{ fontSize: 11, color: C.text.bright, whiteSpace: "nowrap" }}>
        {fmtTok(amount)} {sym}
        {usd != null && <span style={{ color: C.text.faint, marginLeft: 6 }}>{fmtUsd(usd)}</span>}
      </span>
    </div>
  );
}

export function TreasuryInventory({ compact = false }: { compact?: boolean }) {
  const [inv, setInv] = useState<Inv | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => readInventory()
      .then((v) => { if (cancelled) return; if (v) setInv(v); else setFailed(true); })
      .catch(() => { if (!cancelled) setFailed(true); });
    load();
    const id = setInterval(load, 45000); // 45s stream, fail-soft
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (failed && !inv) return null; // both chains unreadable → render nothing

  const px = inv?.nexusPrice ?? null;
  const ethPx = inv?.ethPrice ?? null;
  const nexusUsd = (n: number) => (px != null ? n * px : null);
  const ethUsd = (n: number) => (ethPx != null ? n * ethPx : null);
  // War-chest total = only what we can price (USDC + priced $NEXUS + priced ETH).
  const totalUsd = inv
    ? inv.safeUsdc + inv.subsUsdc + (px != null ? (inv.safeNexus + inv.subsNexus) * px : 0) + (ethPx != null ? inv.safeEth * ethPx : 0)
    : 0;

  const border = `1px solid ${C.border}`;
  const eyebrow = (t: string) => <div style={{ fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: C.text.muted, marginBottom: 4 }}>{t}</div>;

  return (
    <div style={{ background: C.surfaceAlt, border, borderRadius: 6, padding: compact ? "10px 12px" : "14px 16px", fontFamily: "var(--nx-font-mono)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: C.text.bright }}>◆ Treasury Inventory</span>
        <span style={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: C.text.bright }}>{inv ? fmtUsd(totalUsd) : "—"}</span>
      </div>

      {/* HELD — the Safe (the war chest). */}
      {eyebrow("Held · treasury Safe")}
      <Line label="USDC · Base + Arbitrum" amount={inv?.safeUsdc ?? 0} sym="USDC" usd={inv ? inv.safeUsdc : null} />
      <Line label={`$NEXUS · Base${inv?.pctSupply != null ? ` · ${inv.pctSupply.toFixed(4)}% supply` : ""}`} amount={inv?.safeNexus ?? 0} sym="NEXUS" usd={inv ? nexusUsd(inv.safeNexus) : null} />
      <Line label="ETH · gas reserve" amount={inv?.safeEth ?? 0} sym="ETH" usd={inv ? ethUsd(inv.safeEth) : null} />

      {!compact && (
        <>
          {/* ACCRUING — the dedicated subs/AI receiver, pre-sweep. */}
          <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
          {eyebrow("Accruing · subs / AI receiver")}
          <Line label="USDC" amount={inv?.subsUsdc ?? 0} sym="USDC" usd={inv ? inv.subsUsdc : null} />
          <Line label="$NEXUS" amount={inv?.subsNexus ?? 0} sym="NEXUS" usd={inv ? nexusUsd(inv.subsNexus) : null} />

          {/* Sources shown as LABELS only — mixed/personal wallets we don't itemize live. */}
          <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
          {eyebrow("Also feeding the treasury")}
          <div style={{ fontSize: 9.5, color: C.text.faint, lineHeight: 1.6 }}>
            broker fees → borst.eth · swept manually<br />
            x402 data revenue → Bankr wallet · shared/mixed
          </div>
          <div style={{ fontSize: 8, color: C.text.faint, marginTop: 8, lineHeight: 1.4 }}>
            Swept → accumulated as $NEXUS &amp; held. Live balances above are on-chain, verifiable. Not financial advice; $NEXUS is a community token with no revenue share.
          </div>
        </>
      )}
    </div>
  );
}
