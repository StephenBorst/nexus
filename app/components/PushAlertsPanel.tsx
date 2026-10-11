/**
 * The "PHONE ALERTS" block at the bottom of the ◆ SIGNALS bell (SignalsNavButton — the bell that is
 * actually in the nav; NotificationBell.tsx is not mounted anywhere). Switch alerts on for this device,
 * pick which ones, send a test. Hidden until the server's push key is set (push.mjs).
 */
import { useEffect, useState } from "react";
import { C } from "@/config/theme";
import { useLabWallet } from "@/hooks/useLabAuth";
import {
  pushStatus, enablePush, disablePush, updatePushTopics, sendTestPush, savedTopics,
  type PushStatus, type PushTopics,
} from "@/lib/pushAlerts";

const TOPIC_ROWS: { key: keyof PushTopics; label: string }[] = [
  { key: "calls", label: "Your calls, when graded" },
  { key: "agent", label: "Your agent opens or closes a trade" },
  { key: "social", label: "Comments, follows, copies" },
];

const label: React.CSSProperties = { fontFamily: "var(--nx-font-mono)", fontSize: 9, letterSpacing: "0.12em", color: C.text.faint };
const line: React.CSSProperties = { fontFamily: "var(--nx-font-mono)", fontSize: 11, color: C.text.fog, lineHeight: 1.45 };
const btn = (primary: boolean): React.CSSProperties => ({
  background: primary ? C.accent : "none",
  color: primary ? C.canvas : C.text.fog,
  border: `1px solid ${primary ? C.accent : C.borderStrong}`,
  borderRadius: 4,
  fontFamily: "var(--nx-font-ui)",
  fontSize: 12,
  padding: "5px 10px",
  cursor: "pointer",
});

export default function PushAlertsPanel({ wallet }: { wallet: string | null }) {
  const labWallet = useLabWallet();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [topics, setTopics] = useState<PushTopics>(() => savedTopics());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    let live = true;
    pushStatus().then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, []);

  // Dark until the server can send, and silent while it's still checking.
  if (!status || status === "off-server") return null;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okNote = "") => {
    setBusy(true); setNote("");
    try {
      const r = await fn();
      setNote(r.ok ? okNote : r.error || "Something went wrong.");
    } finally {
      setStatus(await pushStatus());
      setBusy(false);
    }
  };

  const toggleTopic = (k: keyof PushTopics) => {
    const next = { ...topics, [k]: !topics[k] };
    setTopics(next);
    if (status === "on" && wallet) run(() => updatePushTopics(wallet, labWallet, next), "Saved.");
  };

  return (
    <div style={{ padding: "10px 14px 12px", borderTop: `1px solid ${C.border}`, display: "grid", gap: 8 }}>
      <span style={label}>■ PHONE ALERTS</span>

      {status === "unsupported" && <div style={line}>This browser can’t show alerts. The Android app and Chrome can.</div>}
      {status === "blocked" && <div style={line}>Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.</div>}

      {(status === "off" || status === "on") && !wallet && (
        <div style={line}>Connect a wallet to get alerts on this device: your calls when graded, your agent’s trades.</div>
      )}

      {(status === "off" || status === "on") && wallet && (
        <>
          <div style={line}>{status === "on" ? "On for this device." : "Get an alert on this device when:"}</div>
          <div style={{ display: "grid", gap: 4 }}>
            {TOPIC_ROWS.map((t) => (
              <label key={t.key} style={{ ...line, display: "flex", gap: 8, alignItems: "center", cursor: busy ? "default" : "pointer" }}>
                <input type="checkbox" checked={topics[t.key]} disabled={busy} onChange={() => toggleTopic(t.key)} style={{ accentColor: C.accent, margin: 0 }} />
                {t.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "off" ? (
              <button type="button" disabled={busy} style={btn(true)} onClick={() => wallet && run(() => enablePush(wallet, labWallet, topics), "On. Send a test to check.")}>
                {busy ? "Turning on…" : "Turn on"}
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} style={btn(true)} onClick={() => run(sendTestPush, "Test sent.")}>Send test</button>
                <button type="button" disabled={busy} style={btn(false)} onClick={() => run(async () => { await disablePush(); return { ok: true }; }, "Off.")}>Turn off</button>
              </>
            )}
          </div>
        </>
      )}
      {note && <div style={{ ...line, color: C.text.muted }}>{note}</div>}
    </div>
  );
}
