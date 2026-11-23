// ◆ SIGNALS — the global bell on top of every DEX page. One request, GET /intel/bell (lab-api routes-bell.mjs, rules
// app/lib/signals.mjs v2): registered reads that just acted on their paper wallets lead, then stretched funding,
// trend and tracked-wallet tier moves; EVERY row carries its grade line (the exact rule's grade, its nearest graded
// relative named as such, or "Not graded"). Badges only genuinely NEW rows (stable ids marked "seen" in
// localStorage). Public + fail-soft; no wallet, no key.
//
// YOURS (2026-11-23, borst: "a your-alerts inbox in the bell first"): the wallet's own notifications (price alerts,
// calls graded/filled, agent trades, follows…), which no screen read before. Private: POST /notifications/:w with the
// Lab signature. It loads by itself only while that signature is already held (no prompt from a bell); otherwise one
// tap signs. Opening the tab marks the rows read (PUT …/read). Rules: app/lib/inbox.mjs (tested).
import { useCallback, useEffect, useRef, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { useNavigate } from "react-router-dom";
import { useAccount } from "@orderly.network/hooks";
import { countUnseen } from "@/lib/signals.mjs";
import { C, SIGNAL } from "@/config/theme";
import PushAlertsPanel from "@/components/PushAlertsPanel";
import { cachedLabAuth, sendSigned, useLabWallet } from "@/hooks/useLabAuth";
import { inboxRows, unreadCount, ago } from "@/lib/inbox.mjs";

type InboxRow = ReturnType<typeof inboxRows>[number];

const AGENT_API = "https://og.nexustradinglabs.com";
const SEEN_KEY = "nexus_signals_seen";
const PRUNE_MS = 14 * 86400 * 1000;

interface Signal { id: string; kind: string; priority: number; ts: number; tab: string; title: string; detail: string; graded?: string; path?: string; }

const loadSeen = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; } };
const saveSeen = (m: Record<string, number>) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* private mode */ } };

const KIND_GLYPH: Record<string, string> = { READ: "◆", FADE_ALIGN: "≈", DIVERGENCE: "⚔", MOMENTUM: "↗", FUNDING: "≈", TIER: "✦" };

export default function SignalsNavButton() {
  const [list, setList] = useState<Signal[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Phone alerts are per wallet (PushAlertsPanel); the signals list itself needs no wallet.
  const { state: accountState } = useAccount();
  const walletAddress = (accountState as { address?: string })?.address ?? null;
  const labWallet = useLabWallet();
  const labWalletRef = useRef(labWallet);
  labWalletRef.current = labWallet;
  const [tab, setTab] = useState<"yours" | "signals">("signals");
  const [mine, setMine] = useState<InboxRow[] | null>(null); // null = not read yet (needs the Lab signature)
  const [mineNote, setMineNote] = useState("");
  const [copied, setCopied] = useState("");

  // Your notifications: only while the wallet's Lab signature is already held (never a prompt from the bell itself).
  const readMine = useCallback(async (explicit = false) => {
    if (!walletAddress) { setMine(null); return; }
    if (!explicit && !cachedLabAuth(walletAddress)) return;
    if (typeof document !== "undefined" && document.hidden && !explicit) return;
    const r = await sendSigned(`${AGENT_API}/notifications/${walletAddress.toLowerCase()}`, "POST", walletAddress, labWalletRef.current, {});
    if (!r) { if (explicit) setMineNote("No signature, so nothing was read."); return; }
    if (!r.ok) { setMineNote("Couldn’t read your alerts right now."); return; }
    const j = await r.json().catch(() => null);
    setMineNote("");
    setMine(inboxRows(Array.isArray(j) ? j : [], walletAddress));
  }, [walletAddress]);

  useEffect(() => {
    setMine(null); setMineNote("");
    readMine();
    const id = setInterval(() => readMine(), 120_000);
    return () => clearInterval(id);
  }, [readMine]);

  const unreadMine = unreadCount(mine || []);
  // Opening the tab marks your rows read (signature already held: the rows were read with it).
  const markMineRead = useCallback(async () => {
    if (!walletAddress || !mine || !unreadCount(mine) || !cachedLabAuth(walletAddress)) return;
    setMine((m) => (m ? m.map((r) => ({ ...r, unread: false })) : m));
    await sendSigned(`${AGENT_API}/notifications/${walletAddress.toLowerCase()}/read`, "PUT", walletAddress, labWalletRef.current, {}).catch(() => null);
  }, [walletAddress, mine]);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const bell = await sharedJson(`${AGENT_API}/intel/bell`).catch(() => null);
      if (!bell || !Array.isArray(bell.list)) return; // keep the last list
      const built = bell.list as Signal[];
      setList(built);
      setUnseen(countUnseen(built, loadSeen()));
    } catch { /* fail-soft — keep the last list */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 120_000); // gentle — public data, visibility-gated
    const onVis = () => refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  // Mark everything currently shown as seen (clears the badge). Pruned on write.
  const markAllSeen = useCallback(() => {
    const now = Date.now();
    const seen = loadSeen();
    for (const s of list) seen[s.id] = now;
    for (const k of Object.keys(seen)) if (now - seen[k] > PRUNE_MS) delete seen[k];
    saveSeen(seen);
    setUnseen(0);
  }, [list]);

  const toggle = () => setOpen((o) => {
    const n = !o;
    if (n) {
      // Open on Yours when something of yours is unread; the signals list is marked seen only when it's the tab shown.
      const t = unreadMine > 0 ? "yours" : "signals";
      setTab(t);
      if (t === "signals") markAllSeen(); else markMineRead();
    }
    return n;
  });
  const pickTab = (t: "yours" | "signals") => { setTab(t); if (t === "signals") markAllSeen(); else markMineRead(); };
  const badge = unseen + unreadMine;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const go = (s: Signal) => {
    setOpen(false);
    if (s.path) { navigate(s.path); return; }
    try { window.dispatchEvent(new CustomEvent("nexus:lab-tab", { detail: { tab: s.tab } })); } catch { /* ignore */ }
    navigate(`/lab?tab=${s.tab}`);
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        onClick={toggle}
        title={badge > 0 ? `Alerts and signals, ${badge} new` : "Alerts and signals"}
        aria-label={badge > 0 ? `Alerts and signals, ${badge} new` : "Alerts and signals"}
        style={{ appearance: "none", WebkitAppearance: "none", position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: "none", border: "none", cursor: "pointer", color: "var(--oui-color-base-contrast-54, #d4d4d8)", padding: 0 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {badge > 0 && (
          <span style={{ position: "absolute", top: -2, right: -2, minWidth: 15, height: 15, padding: "0 4px", borderRadius: 8, background: C.accent, color: C.canvas, fontFamily: "var(--nx-font-mono)", fontSize: 9, fontWeight: "bold", lineHeight: "15px", textAlign: "center", boxSizing: "border-box" }}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        // Anchored to the VIEWPORT (fixed), not the button — so the panel can never
        // overflow off-screen on mobile where the bell sits mid-nav.
        <div className="nx-fade-in" style={{ position: "fixed", top: 54, right: 8, zIndex: 9500, width: "min(360px, calc(100vw - 16px))", maxHeight: "72vh", overflowY: "auto", background: "#0f0f11", border: "1px solid #33333a", borderRadius: 10, boxShadow: "0 16px 50px rgba(0,0,0,0.6)" }}>
          <div role="tablist" style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 10px", borderBottom: "1px solid #232327", position: "sticky", top: 0, background: "#0f0f11", zIndex: 1 }}>
            {(["yours", "signals"] as const).map((t) => {
              const on = tab === t;
              const n = t === "yours" ? unreadMine : unseen;
              return (
                <button key={t} role="tab" aria-selected={on} onClick={() => pickTab(t)}
                  style={{ appearance: "none", background: on ? "#ededf015" : "none", border: `1px solid ${on ? "#ededf055" : "transparent"}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: on ? "#ededf0" : "#a1a1aa", fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12.5, fontWeight: 600, minHeight: 32 }}>
                  {t === "yours" ? "Yours" : "Signals"}{n > 0 ? ` · ${n}` : ""}
                </button>
              );
            })}
            <span style={{ marginLeft: "auto", fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", letterSpacing: "0.05em" }}>{tab === "yours" ? "private · this wallet" : "public · each with its grade"}</span>
          </div>
          {tab === "yours" ? (
            !walletAddress ? (
              <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12.5, color: "#a1a1aa", padding: "18px 14px", lineHeight: 1.6 }}>
                Connect a wallet to see your alerts: price alerts you set, your calls when they fill or grade, your agent’s trades.
              </div>
            ) : mine == null ? (
              <div style={{ padding: "16px 14px" }}>
                <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12.5, color: "#a1a1aa", lineHeight: 1.6, marginBottom: 10 }}>
                  Your alerts are private. Sign once with this wallet (valid a day, moves nothing) to read them here.
                </div>
                <button type="button" onClick={() => readMine(true)} style={{ appearance: "none", background: C.accent, color: C.canvas, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12.5, fontWeight: 600 }}>Show my alerts</button>
                {mineNote && <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12, color: "#a1a1aa", marginTop: 8 }}>{mineNote}</div>}
              </div>
            ) : mine.length === 0 ? (
              <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12.5, color: "#a1a1aa", padding: "18px 14px", lineHeight: 1.6 }}>
                Nothing yet. Set a price alert in any coin’s panel, or post a call: fills, grades and alerts land here.
              </div>
            ) : (
              mine.map((r) => (
                <div key={r.id} style={{ borderBottom: "1px solid #1a1a1e", padding: "11px 14px", background: r.unread ? "#ededf008" : "none" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, letterSpacing: "0.08em", color: r.unread ? "#ededf0" : "#71717a", textTransform: "uppercase" }}>{r.unread ? "● " : ""}{r.label}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#71717a" }}>{ago(r.at)}</span>
                  </div>
                  {r.href ? (
                    <button type="button" onClick={() => { setOpen(false); navigate(r.href as string); }}
                      style={{ appearance: "none", display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, marginTop: 4, cursor: "pointer", fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 13, color: "#f4f4f5", lineHeight: 1.45 }}>{r.message}</button>
                  ) : (
                    <div style={{ marginTop: 4, fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 13, color: "#f4f4f5", lineHeight: 1.45 }}>{r.message}</div>
                  )}
                  {r.share && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(r.share!.text)}&url=${encodeURIComponent(r.share!.url)}`, "_blank", "noopener")}
                        style={{ appearance: "none", background: "none", border: "1px solid #33333a", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "#ededf0", fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12, minHeight: 30 }}>Share on 𝕏</button>
                      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(r.share!.url); setCopied(r.id); } catch { /* clipboard blocked */ } }}
                        style={{ appearance: "none", background: "none", border: "1px solid #33333a", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "#a1a1aa", fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 12, minHeight: 30 }}>{copied === r.id ? "Copied" : "Copy link"}</button>
                    </div>
                  )}
                </div>
              ))
            )
          ) : list.length === 0 ? (
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#71717a", padding: "18px 14px", textAlign: "center", lineHeight: 1.6 }}>
              Quiet tape. No registered read acted, no stretched funding and no tier moves right now.
            </div>
          ) : (
            list.map((s) => (
              <button key={s.id} onClick={() => go(s)} style={{ appearance: "none", WebkitAppearance: "none", display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #1a1a1e", cursor: "pointer", padding: "11px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: s.kind === "READ" ? C.accent : s.kind === "DIVERGENCE" ? SIGNAL.watch : "#71717a", flexShrink: 0 }}>{KIND_GLYPH[s.kind] ?? "◆"}</span>
                  <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 12, color: "#f4f4f5", fontWeight: 600, lineHeight: 1.35 }}>{s.title}</span>
                </div>
                <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 11.5, color: "#a1a1aa", lineHeight: 1.5, marginTop: 3, paddingLeft: 19 }}>{s.detail}</div>
                {s.graded && <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 11, color: s.kind === "READ" ? "#d4d4d8" : "#71717a", lineHeight: 1.5, marginTop: 3, paddingLeft: 19 }}>{s.graded}</div>}
              </button>
            ))
          )}
          {tab === "signals" && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", padding: "9px 14px", textAlign: "center" }}>Registered reads first. The rest are inputs, each with its grade. Grades live on Proof.</div>}
          <PushAlertsPanel wallet={walletAddress} />
        </div>
      )}
    </div>
  );
}
