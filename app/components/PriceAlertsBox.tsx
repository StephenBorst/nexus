// Price alerts on one coin, in its panel (drawer + dock). borst 2026-11-23: "all three" (this list, phone, Telegram,
// a switch each) + a Share button, never automatic. Rules: app/lib/priceAlerts.mjs; server: lab-api
// routes-pricealerts.mjs (Lab-signed, private: your levels say where your positions are) + priceWatch.mjs (*/5, on
// 1-minute highs/lows, so a wick counts). The share card is drawn by the server from Orderly's bars, so it can't show
// a cross that didn't trade. This list IS the in-app channel: a fired alert sits here with its minute and price.
import { useEffect, useState } from "react";
import { C, MONO, UI, RADIUS } from "@/config/theme";
import { sendSigned, cachedLabAuth, type LabWallet } from "@/hooks/useLabAuth";
import { alertShareText, alertShareUrl, isArmed, PRICE_ALERTS_MAX } from "@/lib/priceAlerts.mjs";
import { errText } from "@/pages/lab/helpers";

const API = "https://og.nexustradinglabs.com";
type Alert = { id: string; coin: string; level: number; dir: "above" | "below"; setAt: number; channels: { phone: boolean; telegram: boolean }; firedAt?: number; firedPx?: number };

const money = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`);
const hhmm = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const QUICK = [-5, -2, 2, 5];

export function PriceAlertsBox({ coin, price, wallet, labWallet }: { coin: string; price: number | null; wallet: string | null; labWallet: LabWallet }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [level, setLevel] = useState("");
  const [phone, setPhone] = useState(true);
  const [telegram, setTelegram] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");

  const call = async (path: string, body: Record<string, unknown> = {}) => {
    if (!wallet) return null;
    const r = await sendSigned(`${API}/alerts/price/${wallet.toLowerCase()}${path}`, "POST", wallet, labWallet, body);
    if (!r) { setNote("No signature, so nothing was read or saved."); return null; }
    const j = await r.json().catch(() => null);
    if (!r.ok) { setNote(j?.hint || "Couldn’t reach the alerts right now. Nothing changed."); return null; }
    return j as { alerts?: Alert[] };
  };

  // Read the list without a prompt only when this wallet's Lab signature is already held; otherwise one tap reads it.
  useEffect(() => {
    let live = true;
    setAlerts(null); setNote(""); setLevel("");
    if (!wallet || !cachedLabAuth(wallet)) return () => { live = false; };
    (async () => {
      const j = await call("");
      if (live && j?.alerts) setAlerts(j.alerts);
    })().catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, coin]);

  const add = async () => {
    const lv = Number(level.replace(/[$,\s]/g, ""));
    if (!(lv > 0)) { setNote("Type a price."); return; }
    setBusy(true); setNote("");
    try {
      const j = await call("/add", { coin, level: lv, channels: { phone, telegram } });
      if (j?.alerts) { setAlerts(j.alerts); setLevel(""); setNote(`Set. You’ll hear when ${coin} trades ${price != null && lv > price ? "at or above" : "at or below"} ${money(lv)}.`); }
    } catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { const j = await call("/remove", { id }); if (j?.alerts) setAlerts(j.alerts); };
  const shareX = (a: Alert) => window.open(`https://x.com/intent/post?text=${encodeURIComponent(alertShareText(a))}&url=${encodeURIComponent(alertShareUrl(a))}`, "_blank", "noopener");
  const copy = async (a: Alert) => { try { await navigator.clipboard.writeText(alertShareUrl(a)); setCopied(a.id); } catch { setNote(alertShareUrl(a)); } };

  const mine = (alerts || []).filter((a) => a.coin === coin).sort((a, b) => (b.firedAt || b.setAt) - (a.firedAt || a.setAt));
  const armedAll = (alerts || []).filter(isArmed).length;
  const chip: React.CSSProperties = { fontFamily: MONO, fontSize: 11.5, padding: "4px 8px", borderRadius: RADIUS.md, border: `1px solid ${C.borderStrong}`, background: "transparent", color: C.text.fog, cursor: "pointer", minHeight: 30 };
  const small: React.CSSProperties = { fontFamily: UI, fontSize: 12.5, padding: "4px 9px", borderRadius: RADIUS.md, border: `1px solid ${C.borderStrong}`, background: "transparent", color: C.text.bright, cursor: "pointer", minHeight: 30 };
  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: UI, fontSize: 12.5, color: on ? C.text.bright : C.text.muted, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text.muted, marginBottom: 6 }}>Price alerts on {coin}</div>
      {!wallet ? (
        <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog }}>Connect a wallet to set a price alert.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input value={level} onChange={(e) => setLevel(e.target.value)} inputMode="decimal" placeholder={price != null ? `e.g. ${money(price * 1.05)}` : "Price"}
              aria-label={`Alert price for ${coin}`}
              style={{ flex: "1 1 120px", minWidth: 0, fontFamily: MONO, fontSize: 14, padding: "8px 10px", borderRadius: RADIUS.md, border: `1px solid ${C.borderStrong}`, background: C.canvas, color: C.text.bright }} />
            <button type="button" className="nx-press" disabled={busy} onClick={add} style={{ ...small, background: C.accent, color: C.canvas, borderColor: C.accent, padding: "8px 12px" }}>{busy ? "…" : "Set alert"}</button>
          </div>
          {price != null && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {QUICK.map((p) => (
                <button key={p} type="button" style={chip} onClick={() => setLevel(String(Number((price * (1 + p / 100)).toPrecision(6))))}>{p > 0 ? "+" : "−"}{Math.abs(p)}%</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontFamily: UI, fontSize: 12.5, color: C.text.muted }}>Also tell me by:</span>
            {toggle(phone, setPhone, "Phone")}
            {toggle(telegram, setTelegram, "Telegram (if linked)")}
          </div>
          {note && <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.fog, marginTop: 6, lineHeight: 1.5 }}>{note}</div>}
          {alerts == null ? (
            <button type="button" style={{ ...small, marginTop: 8, color: C.text.fog }} onClick={async () => { const j = await call(""); if (j?.alerts) setAlerts(j.alerts); }}>Show my alerts</button>
          ) : (
            <div style={{ marginTop: 8 }}>
              {mine.length === 0 && <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.muted }}>No alerts on {coin}. {armedAll} of {PRICE_ALERTS_MAX} set across your coins.</div>}
              {mine.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontFamily: UI, fontSize: 13, color: isArmed(a) ? C.text.bright : C.text.fog, flex: "1 1 200px", minWidth: 0, lineHeight: 1.45 }}>
                    {isArmed(a)
                      ? <>Waiting: {a.dir === "above" ? "at or above" : "at or below"} <b>{money(a.level)}</b><span style={{ color: C.text.muted }}> · {[a.channels.phone && "phone", a.channels.telegram && "Telegram"].filter(Boolean).join(" · ") || "this list only"}</span></>
                      : <>Traded {a.dir} <b>{money(a.level)}</b> at {hhmm(a.firedAt!)}<span style={{ color: C.text.muted }}> · {a.dir === "above" ? "high" : "low"} {money(a.firedPx!)}</span></>}
                  </span>
                  {!isArmed(a) && <button type="button" style={small} onClick={() => shareX(a)}>Share on 𝕏</button>}
                  {!isArmed(a) && <button type="button" style={{ ...small, color: C.text.fog }} onClick={() => copy(a)}>{copied === a.id ? "Copied" : "Copy link"}</button>}
                  <button type="button" style={{ ...small, color: C.text.muted, border: "none" }} onClick={() => remove(a.id)} aria-label={`Remove the ${money(a.level)} alert`}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontFamily: UI, fontSize: 11.5, color: C.text.muted, marginTop: 8, lineHeight: 1.5 }}>
            Checked every 5 minutes on Orderly’s 1-minute highs and lows, so a quick wick counts. Fires once. Shared cards are
            re-checked against the same public bars.
          </div>
        </>
      )}
    </div>
  );
}
