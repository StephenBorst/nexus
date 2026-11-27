/**
 * HoldersRoom — $NEXUS holders-only Thesis room (Lab tab).
 *
 * Access perk: theses authored by $NEXUS holders, visible only to holders.
 * Non-holders see a locked teaser explaining how to enter. Pure access/status —
 * no financial right, no promise; $NEXUS stays a pure community meme token.
 *
 * Gate = the connected wallet's tier (useNexusTier) for the screen, and the server's own signed check + Base balance
 * read for the content (POST /feed/holders). Rules in app/lib/holdersRoom.mjs (tested): the signature goes in the
 * body, the connected wallet signs (WalletConnect + Android work), an unread balance is never "locked", and each row
 * says a private holders call isn't graded.
 */

import { C } from "@/config/theme";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLabWallet, type LabWallet } from "@/hooks/useLabAuth";
import { signHoldersAccess, holderRows, holderCallState, lockState, roomError, NOT_GRADED_LINE, HOLDERS_SIG_REUSE_MS } from "@/lib/holdersRoom.mjs";
import { fmtPrice } from "@/lib/tradeLog.mjs";
import { bareTicker } from "@/utils/utils";
import {
  useNexusTier,
  TIER_META,
  TIER_THRESHOLDS,
} from "@/hooks/useNexusTier";
import { NexusTierBadge } from "@/components/NexusTierBadge";
import { callRR, fmtRR } from "@/lib/callMath.mjs";
import { TreasuryInventory } from "@/components/TreasuryInventory";
import { GuestPanel } from "@/components/GuestPanel";
import { BuyNexusButton } from "@/components/BuyNexusButton";
import { PRO_HOLDER_TIER } from "@/config/subscription";

const API_BASE = "https://og.nexustradinglabs.com";

/**
 * Proves wallet ownership for the Holders Room. Reuses a signature for 8 min (the server allows 10) so a visit
 * doesn't re-prompt. Signs with the connected wallet's provider, never only an injected one.
 */
async function getHoldersAccess(address: string, wallet: LabWallet): Promise<{ ts: number; sig: string }> {
  const key = `nexus_holders_sig_${address.toLowerCase()}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (cached && Date.now() - cached.ts < HOLDERS_SIG_REUSE_MS) return cached;
  } catch { /* ignore */ }
  const access = await signHoldersAccess(address, wallet);
  try { sessionStorage.setItem(key, JSON.stringify(access)); } catch { /* ignore */ }
  return access;
}

function forgetHoldersAccess(address: string) {
  try { sessionStorage.removeItem(`nexus_holders_sig_${address.toLowerCase()}`); } catch { /* ignore */ }
}

type FeedThesis = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  riskReward: number;
  status: string;
  createdAt: number;
  wallet: string;
  displayName: string | null;
  notes: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  isPublic?: boolean;
  holdersOnly?: boolean;
  gradedOutcome?: string;
  gradedR?: number;
};

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

function LockScreen({ address, balance }: { address: string; balance: number | null }) {
  const minOperator = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1].min;
  const lock = lockState({ address, balance, need: minOperator });
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>◆</div>
      <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 14, color: "#ededf0", letterSpacing: "0.1em", marginBottom: 10 }}>
        HOLDERS ROOM · LOCKED
      </div>
      <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#a1a1aa", lineHeight: 1.7, marginBottom: 12 }}>
        A private room for $NEXUS holders. Calls from holders, for holders.
        <br />
        Hold at least <b style={{ color: "#fff" }}>{minOperator.toLocaleString()} $NEXUS</b> on Base for the
        {" "}<span style={{ color: TIER_META.OPERATOR.color }}>{TIER_META.OPERATOR.glyph} OPERATOR</span> tier to enter.
      </div>
      {/* Why it's shut, from the read itself: an unread balance is never "you're not a holder". */}
      <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 12, color: lock.kind === "UNREAD" ? "#fbbf24" : "#ededf0", lineHeight: 1.6, marginBottom: 16 }}>{lock.line}</div>
      {lock.kind === "BELOW" && <div style={{ marginBottom: 16 }}><BuyNexusButton size="sm" /></div>}
      {lock.kind === "UNREAD" && <div style={{ marginBottom: 16 }}><button onClick={() => window.location.reload()} style={{ background: "#1a1a1e", border: "1px solid #33333a", borderRadius: 3, color: "#ededf0", fontFamily: "var(--nx-font-ui)", fontSize: 12.5, padding: "6px 14px", cursor: "pointer" }}>Try again</button></div>}
      <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11, color: "#71717a", lineHeight: 1.6 }}>
        $NEXUS is a community token. It pays for Nexus data and PRO. No yield. No revenue share.
        <br />
        Tiers unlock access &amp; status inside the Lab, nothing more.
      </div>
    </div>
  );
}

export function HoldersRoom({ walletAddress }: { walletAddress: string | null }) {
  const navigate = useNavigate();
  const { tier, balance, isLoading: tierLoading } = useNexusTier(walletAddress);
  const wallet = useLabWallet();
  const [theses, setTheses] = useState<FeedThesis[] | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signNonce, setSignNonce] = useState(0); // bump to retry signing

  const isHolder = tier !== "NONE";

  useEffect(() => {
    if (!isHolder || !walletAddress) return;
    let cancelled = false;
    setLoadingFeed(true);
    setAuthError(null);
    (async () => {
      let access: { ts: number; sig: string };
      try {
        access = await getHoldersAccess(walletAddress, wallet);
      } catch (e) {
        // Declined, or the wallet couldn't sign: say which, nothing was sent.
        if (!cancelled) { setAuthError(e instanceof Error && e.message ? e.message : "Signature required to enter the room."); setLoadingFeed(false); }
        return;
      }
      try {
        // The signature goes in the BODY (it used to ride in the URL, where every log kept it).
        const r = await fetch(`${API_BASE}/feed/holders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: walletAddress.toLowerCase(), ts: access.ts, sig: access.sig }),
        });
        if (!r.ok) {
          if (r.status === 401) forgetHoldersAccess(walletAddress);
          if (!cancelled) setAuthError(roomError(r.status));
          return;
        }
        const data: { feed?: FeedThesis[] } = await r.json();
        if (!cancelled) setTheses(holderRows(data.feed ?? []) as FeedThesis[]);
      } catch {
        if (!cancelled) setAuthError(roomError(0));
      } finally {
        if (!cancelled) setLoadingFeed(false);
      }
    })();
    return () => { cancelled = true; };
    // wallet.provider changes identity on reconnect; the address + nonce are the real triggers.
  }, [isHolder, walletAddress, signNonce]);

  if (!walletAddress) {
    // Logged out (2026-11-21): what the room is and what each tier opens, from the same thresholds the gate reads.
    const min = (t: string) => (TIER_THRESHOLDS.find((x) => x.tier === t)?.min ?? 0).toLocaleString();
    return (
      <GuestPanel
        eyebrow="$NEXUS holders"
        title="The Holders Room"
        lede="Calls from $NEXUS holders, visible only to holders. Your tier is read from your wallet's balance on Base when you connect: nothing to sign until you open the room."
        rows={[
          { k: `${TIER_META.OPERATOR.glyph} Operator`, v: <>{min("OPERATOR")} $NEXUS. Opens this room.</> },
          { k: `${TIER_META.ARCHITECT.glyph} Architect`, v: <>{min("ARCHITECT")} $NEXUS. The room{PRO_HOLDER_TIER === "ARCHITECT" ? ", plus PRO for as long as you hold it" : ""}.</> },
          { k: `${TIER_META.ORACLE.glyph} Oracle`, v: <>{min("ORACLE")} $NEXUS. The top badge. No extra access.</> },
        ]}
        footnote="$NEXUS is a community token. Tiers unlock access and status inside the Lab, nothing more: no yield, no revenue share."
      >
        <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#a1a1aa" }}>Connect a wallet (top right) to check your tier.</span>
        <BuyNexusButton size="sm" />
      </GuestPanel>
    );
  }

  if (tierLoading) {
    return (
      <div style={{ textAlign: "center", padding: "48px 20px", fontFamily: "var(--nx-font-mono)", fontSize: 12, color: "#71717a" }}>
        Checking $NEXUS balance…
      </div>
    );
  }

  if (!isHolder) return <LockScreen address={walletAddress} balance={balance} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Welcome + burn counter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "#71717a", fontFamily: "var(--nx-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 5 }}>Hold</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 24, fontWeight: 600, color: C.text.bright, lineHeight: 1.1, letterSpacing: "-0.02em" }}>The Holders Room</span>
            <NexusTierBadge tier={tier} size="md" />
          </div>
        </div>
        <TreasuryInventory compact />
      </div>

      {loadingFeed && (
        <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#71717a", padding: "20px 0", textAlign: "center" }}>
          verifying signature &amp; loading holder theses…
        </div>
      )}

      {authError && !loadingFeed && (
        <div style={{ textAlign: "center", padding: "32px 0", fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#fbbf24", lineHeight: 1.6 }}>
          {authError}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setSignNonce((n) => n + 1)}
              style={{ background: "#1a1a1e", border: "1px solid #33333a", borderRadius: 3, color: "#ededf0", fontFamily: "var(--nx-font-ui)", fontSize: 12.5, padding: "6px 14px", cursor: "pointer" }}
            >
              ◆ Sign to enter
            </button>
          </div>
        </div>
      )}

      {theses && theses.length > 0 && (
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>{NOT_GRADED_LINE}</div>
      )}

      {theses && theses.length === 0 && !loadingFeed && (
        <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: "#a1a1aa", padding: "32px 0", textAlign: "center", lineHeight: 1.6 }}>
          No holders calls yet. In the Thesis Engine, set a call to ◆ HOLDERS to share it here.
        </div>
      )}

      {theses && theses.map((t) => {
        const ticker = bareTicker(t.symbol);
        const name = t.displayName ?? `${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`;
        const st = holderCallState(t);
        const lv = [["Entry", t.entryPrice], ["Stop", t.stopLoss], ["Target", t.takeProfit1], ["Target 2", t.takeProfit2]]
          .filter(([, v]) => Number(v) > 0) as [string, number][];
        return (
          <div key={`${t.wallet}:${t.id}`} style={{ background: "#141416", border: "1px solid #232327", borderRadius: 4, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => navigate(`/feed/trader/${t.wallet}`)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--nx-font-ui)", fontSize: 12.5, color: "#a1a1aa" }}
              >
                {name}
                <NexusTierBadge address={t.wallet} />
              </button>
              <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 14, fontWeight: "bold", color: "#fff" }}>{ticker}</span>
              {/* Direction and R:R in ink: green/red is money only, and a low R:R isn't a warning. */}
              <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#ededf0" }}>
                {t.direction === "LONG" ? "↑" : "↓"} {t.direction}
              </span>
              <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#a1a1aa" }}>{fmtRR(callRR(t))}</span>
              {t.createdAt > 0 && <span style={{ marginLeft: "auto", fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#71717a" }}>{ago(t.createdAt)}</span>}
            </div>
            {lv.length > 0 && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#a1a1aa" }}>
                {lv.map(([k, v]) => <span key={k}><span style={{ color: "#71717a" }}>{k}</span> {fmtPrice(v)}</span>)}
              </div>
            )}
            {t.notes && t.notes.trim() && (
              <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12.5, color: "#a1a1aa", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {t.notes.trim().slice(0, 400)}{t.notes.trim().length > 400 ? "…" : ""}
              </div>
            )}
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: st.graded ? "#ededf0" : "#71717a" }}>{st.line}{st.graded ? "" : " Not graded."}</div>
          </div>
        );
      })}
    </div>
  );
}
