/**
 * Link Telegram — the deep link carries a one-time code, never the wallet address.
 *
 * The bot used to link whatever address it was sent, so anyone could send "/start <your wallet>"
 * and take your agent alerts. Now the wallet signs (its Lab signature, the same one saves use), the
 * worker hands back a code that lasts 10 minutes and links once (workers/nexus-lab-api/
 * routes-telegram.mjs), and only then does the "Open Telegram" link appear: two taps, because a
 * link opened after an await is blocked by most phone browsers.
 */
import { useState } from "react";
import { sendSigned, useLabWallet } from "@/hooks/useLabAuth";
import { AGENT_API, TG_BOT } from "./agentTypes";
import { navBtnStyle } from "./styles";

type Ready = { url: string; command: string };

const btn = {
  fontFamily: "var(--nx-font-ui)", fontSize: 11.5, fontWeight: "bold", textDecoration: "none",
  color: "#6cb6ff", border: "1px solid #33333a", background: "#0f0f11", borderRadius: 3, padding: "7px 14px",
  flexShrink: 0, cursor: "pointer", display: "inline-block",
} as const;

export function useTelegramLink(wallet: string) {
  const labWallet = useLabWallet();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setError(null);
    const r = await sendSigned(`${AGENT_API}/tg/link`, "POST", wallet, labWallet, { wallet });
    setBusy(false);
    if (!r) { setError("Sign with your wallet to make a link."); return; }
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.url) { setError(d?.reason === "wrong_signer" ? "Switch your wallet to this account." : "Couldn't make a link. Try again."); return; }
    setReady({ url: d.url, command: d.command });
  };
  return { busy, ready, error, start };
}

/** The Agent tab card's control: Link → sign → Open Telegram, with the /start fallback. */
export function TelegramLinkPanel({ wallet, linked }: { wallet: string; linked: boolean }) {
  const { busy, ready, error, start } = useTelegramLink(wallet);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {linked && !ready && (
          <a href={`https://t.me/${TG_BOT}`} target="_blank" rel="noopener noreferrer" style={btn}>Manage ↗</a>
        )}
        {ready ? (
          <a href={ready.url} target="_blank" rel="noopener noreferrer" style={btn}>Open Telegram ↗</a>
        ) : (
          <button type="button" onClick={start} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Sign in wallet…" : linked ? "Link another chat" : "Link Telegram"}
          </button>
        )}
      </div>
      {(ready || error) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1a1a1e", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}>
          {error ? (
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#fbbf24", lineHeight: 1.4 }}>{error}</span>
          ) : ready && (
            <>
              <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#71717a", lineHeight: 1.4, flex: 1, minWidth: 150 }}>
                Works once, for 10 minutes. Link not opening Telegram? Some in-app browsers block it. Open <b style={{ color: "#a1a1aa" }}>@{TG_BOT}</b> in Telegram and send this:
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(ready.command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
                }}
                style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11.5, fontWeight: "bold", color: copied ? "#ededf0" : "#a1a1aa",
                  border: `1px solid ${copied ? "#33333a" : "#232327"}`, background: "#0a0a0b", borderRadius: 3, padding: "6px 12px", cursor: "pointer", flexShrink: 0 }}>
                {copied ? "Copied ✓" : "Copy /start command"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** The small ALERTS button on an active call card: same flow, one line. */
export function TelegramAlertsButton({ wallet }: { wallet: string }) {
  const { busy, ready, error, start } = useTelegramLink(wallet);
  const style = { ...navBtnStyle, fontSize: 10, color: "#6cb6ff", borderColor: "#1a1a1e", textDecoration: "none", display: "inline-block", textAlign: "center" as const, minHeight: 36, lineHeight: "22px", padding: "6px 12px" };
  if (ready) return <a href={ready.url} target="_blank" rel="noopener noreferrer" style={style} title="Works once, for 10 minutes">OPEN TELEGRAM ↗</a>;
  return (
    <button type="button" onClick={start} disabled={busy} title={error || "Telegram alerts for this wallet"} style={{ ...style, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
      {busy ? "SIGN…" : error ? "ALERTS · RETRY" : "ALERTS"}
    </button>
  );
}
