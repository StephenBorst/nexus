// 🔔 Live Alerts — "X just opened LONG BTC" when a tracked trader/agent opens a
// position. Polls the public LIVE NOW feed (/agents/live), diffs against what
// we've already seen, and surfaces genuinely-new opens as in-app toasts +
// (opt-in) OS notifications. Reuses existing data — no new backend, no push infra.
// Mounted globally so alerts fire wherever you are in the app.
//
// Follow-aware: if you follow callers (the Feed follow graph, /follows/:wallet), a
// followed caller's open gets a STARRED, prioritized toast that's never crowded out
// by the general market pulse — so following actually DELIVERS alpha instead of just
// filtering a tab. Follow no one and it's unchanged (all opens, pulse mode).
//
// Two event kinds reach you: a position OPEN (from /agents/live — starred if followed,
// everyone in pulse mode) and a NEW CALL, i.e. a followed caller posting a public thesis
// (from /feed — followed-only, since the feed is high-volume; non-followed calls stay in
// the Feed where they belong). A new call is the primary alpha event, so following someone
// now pings you the moment they call, not just when they take a position.
import { useEffect, useRef, useState } from "react";
import { useAccount } from "@orderly.network/hooks";
import { bareTicker } from "@/utils/utils";
import { SIGNAL } from "@/config/theme";

const API_BASE = "https://og.nexustradinglabs.com";
const green = "#ededf0";
const red = "#f7525f";
const star = SIGNAL.follow; // "someone you follow" — the theme's follow colour
const NOTIF_KEY = "nexus_live_notif"; // "on" once the user enables OS notifications
const CALL_FRESH_MS = 15 * 60 * 1000; // only alert on a call posted within this window (guards feed reordering)

type LivePos = {
  wallet: string; agent: boolean; displayName: string | null;
  symbol: string; direction: "LONG" | "SHORT"; opened_at: number | null;
};
type FeedThesis = {
  id?: string; wallet?: string; displayName?: string | null;
  symbol?: string; direction?: string; createdAt?: number; created_at?: number; isPublic?: boolean;
};
// A toast is either a position OPEN (link to the perp) or a new CALL (link to the thesis).
type Toast = { id: string; who: string; symbol: string; direction: "LONG" | "SHORT"; followed: boolean; kind: "open" | "call"; href: string };

const tk = (s: string) => bareTicker(s);
const shortAddr = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const keyOf = (p: LivePos) => `${p.wallet}|${p.symbol}|${p.opened_at ?? ""}`;
const perpHref = (symbol: string) => `/perp/${symbol.startsWith("PERP_") ? symbol : `PERP_${symbol}_USDC`}`;

export default function LiveAlerts() {
  const { state: accountState } = useAccount();
  const walletAddress = (accountState as { address?: string })?.address ?? null;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notif, setNotif] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(NOTIF_KEY) === "on");
  const [showEnable, setShowEnable] = useState(false);
  const seen = useRef<Set<string> | null>(null); // null until first load (don't alert the existing backlog)
  const seenTheses = useRef<Set<string> | null>(null); // same prime-then-diff for followed callers' calls
  const tick = useRef(0); // position poll runs every 20s; the /feed (calls) poll rides every 3rd (~60s)
  // Who this wallet follows (lowercased). A ref so the position poll reads it without
  // re-subscribing; refreshed on connect + every 90s so follows made this session count.
  const followRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!walletAddress) { followRef.current = new Set(); return; }
    let alive = true;
    const load = () => fetch(`${API_BASE}/follows/${walletAddress}`)
      .then((r) => r.json())
      .then((d: { following?: string[] }) => { if (alive) followRef.current = new Set((d.following ?? []).map((w) => w.toLowerCase())); })
      .catch(() => { /* fail-soft — no follow graph = pulse mode */ });
    load();
    const id = setInterval(load, 90000);
    return () => { alive = false; clearInterval(id); };
  }, [walletAddress]);

  useEffect(() => {
    let alive = true;
    // Shared surface for both event kinds: prepend the toast, auto-dismiss, optional OS notif.
    const emit = (t: Toast, verb: string) => {
      setToasts((cur) => [t, ...cur].slice(0, 4));
      setTimeout(() => { if (alive) setToasts((cur) => cur.filter((x) => x.id !== t.id)); }, t.followed ? 12000 : 9000);
      if (notif && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(`${t.followed ? "★ " : ""}${t.who} ${verb} ${t.direction} ${tk(t.symbol)}`,
            { body: t.followed ? "A caller you follow — tap to view" : "Tap to view on Nexus", icon: "/icon-1024.png" });
        } catch { /* ignore */ }
      }
    };
    const poll = async () => {
      const follows = followRef.current;
      // ── position OPENS (everyone in pulse mode; followed get starred + prioritized) ──
      try {
        const d = await (await fetch(`${API_BASE}/agents/live`)).json();
        const positions: LivePos[] = Array.isArray(d?.positions) ? d.positions : [];
        if (!alive) return;
        const keys = positions.map(keyOf);
        if (seen.current === null) { seen.current = new Set(keys); } // prime, no alerts
        else {
          const fresh = positions.filter((p) => !seen.current!.has(keyOf(p)));
          for (const k of keys) seen.current.add(k);
          if (fresh.length) {
            if (!window.localStorage.getItem(NOTIF_KEY)) setShowEnable(true); // nudge once there's activity
            // Callers you follow lead and are never crowded out of the 3-per-tick budget.
            const tagged = fresh
              .map((p) => ({ p, followed: follows.has(p.wallet.toLowerCase()) }))
              .sort((a, b) => Number(b.followed) - Number(a.followed));
            for (const { p, followed } of tagged.slice(0, 3)) {
              const who = p.agent ? "Nexus Agent" : (p.displayName || shortAddr(p.wallet));
              emit({ id: `${keyOf(p)}-${Date.now()}`, who, symbol: p.symbol, direction: p.direction, followed, kind: "open", href: perpHref(p.symbol) }, "opened");
            }
          }
        }
      } catch { /* fail-soft */ }
      // ── NEW CALLS from callers you follow (followed-only; skip the fetch if you follow no one) ──
      // Prime immediately when you have follows, then ride every 3rd tick (~60s) so /feed isn't
      // polled as hard as live positions — a call reaching you in ≤60s is plenty.
      tick.current += 1;
      if (!alive || follows.size === 0) return;
      if (seenTheses.current !== null && tick.current % 3 !== 0) return;
      try {
        const raw = await (await fetch(`${API_BASE}/feed`)).json();
        const rows: FeedThesis[] = Array.isArray(raw) ? raw : (raw?.feed ?? raw?.items ?? []);
        if (!alive) return;
        const now = Date.now();
        const mine = rows.filter((t) => t.id && t.wallet && follows.has(String(t.wallet).toLowerCase()));
        if (seenTheses.current === null) { seenTheses.current = new Set(mine.map((t) => t.id!)); return; } // prime
        const freshCalls = mine.filter((t) => !seenTheses.current!.has(t.id!) && (now - Number(t.createdAt ?? t.created_at ?? 0)) < CALL_FRESH_MS);
        for (const t of mine) seenTheses.current.add(t.id!);
        if (!window.localStorage.getItem(NOTIF_KEY) && freshCalls.length) setShowEnable(true);
        for (const t of freshCalls.slice(0, 3)) {
          const who = t.displayName || shortAddr(String(t.wallet));
          const dir = String(t.direction).toUpperCase() === "SHORT" ? "SHORT" : "LONG";
          emit({ id: `call-${t.id}-${Date.now()}`, who, symbol: String(t.symbol || ""), direction: dir, followed: true, kind: "call", href: `/feed/thesis/${t.wallet}/${t.id}` }, "called");
        }
      } catch { /* fail-soft */ }
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [notif]);

  async function enableNotif() {
    setShowEnable(false);
    try {
      if (typeof Notification === "undefined") return;
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm === "granted") { window.localStorage.setItem(NOTIF_KEY, "on"); setNotif(true); }
    } catch { /* ignore */ }
  }

  if (!toasts.length && !showEnable) return null;

  return (
    <div style={{ position: "fixed", left: 16, bottom: 16, zIndex: 9000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 280 }}>
      {showEnable && (
        <div style={{ background: "#141416", border: "1px solid #232327", borderRadius: 6, padding: "8px 10px", fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa", display: "flex", alignItems: "center", gap: 8 }}>
          <span>🔔 Get pinged when callers you follow open or call</span>
          <button onClick={enableNotif} style={{ marginLeft: "auto", flexShrink: 0, background: "#1a1a1e", color: green, border: "1px solid #33333a", borderRadius: 3, padding: "3px 8px", fontFamily: "var(--nx-font-mono)", fontSize: 9, fontWeight: "bold", cursor: "pointer" }}>ON</button>
          <button onClick={() => { setShowEnable(false); window.localStorage.setItem(NOTIF_KEY, "off"); }} style={{ flexShrink: 0, background: "none", border: "none", color: "#52525b", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      )}
      {toasts.map((t) => (
        <a
          key={t.id}
          href={t.href}
          style={{ textDecoration: "none", background: "#141416", border: `1px solid ${t.followed ? star : t.direction === "LONG" ? "#33333a" : "#4a1e22"}`, borderRadius: 6, padding: "9px 11px", fontFamily: "var(--nx-font-mono)", display: "flex", alignItems: "center", gap: 8, boxShadow: t.followed ? `0 4px 16px ${star}2e` : "0 4px 16px rgba(0,0,0,0.5)" }}
        >
          <span style={{ fontSize: 13 }}>{t.kind === "call" ? "◆" : t.followed ? "★" : "🔔"}</span>
          <span style={{ fontSize: 11, color: "#f4f4f5" }}>
            <b style={{ color: t.followed ? star : "#fff" }}>{t.who}</b>
            {t.followed && <span style={{ color: "#71717a" }}> · following</span>} {t.kind === "call" ? "called" : "opened"}{" "}
            <b style={{ color: t.direction === "LONG" ? green : red }}>{t.direction === "LONG" ? "↑" : "↓"} {t.direction} {tk(t.symbol)}</b>
          </span>
        </a>
      ))}
    </div>
  );
}
