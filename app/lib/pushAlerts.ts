/**
 * Phone alerts (Web Push) from the browser side. The worker side is workers/nexus-lab-api/push.mjs.
 *
 * Nothing here runs until someone presses "Turn on": no worker is registered on page load. The
 * alerts worker (/push-sw.js) is registered at scope "/push/" — a path with no pages — so it can
 * never serve or cache a page (the app's old caching worker broke wallet browsers; see main.tsx).
 */
import { getLabAuth, type LabWallet } from "@/hooks/useLabAuth";
import { PUSH_SW_SCOPE, pushSupported } from "@/lib/pushTaps";

export { PUSH_SW_SCOPE, pushSupported };

export const PUSH_API = "https://og.nexustradinglabs.com";
export const PUSH_SW_URL = "/push-sw.js";

export type PushTopics = { calls: boolean; agent: boolean; social: boolean };
export const DEFAULT_PUSH_TOPICS: PushTopics = { calls: true, agent: true, social: false };
const TOPICS_KEY = "nx_push_topics";

export type PushStatus =
  | "unsupported"  // this browser can't do push (iOS outside an installed app, old browsers)
  | "off-server"   // the server's push key isn't set yet
  | "blocked"      // the user (or the browser) denied notifications
  | "off"
  | "on";

export function savedTopics(): PushTopics {
  try { return { ...DEFAULT_PUSH_TOPICS, ...JSON.parse(localStorage.getItem(TOPICS_KEY) || "{}") }; } catch { return { ...DEFAULT_PUSH_TOPICS }; }
}
function saveTopics(t: PushTopics) {
  try { localStorage.setItem(TOPICS_KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

let configP: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
export function pushConfig() {
  configP ??= fetch(`${PUSH_API}/push/config`).then((r) => r.json()).catch(() => ({ enabled: false, publicKey: null }));
  return configP;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE)) || null; } catch { return null; }
}

/** Resolves once `reg` has an active worker (subscribe needs one). Gives up after 10s. */
function activeWorker(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const sw = reg.installing || reg.waiting;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The alerts worker didn’t start. Reload and try again.")), 10_000);
    if (!sw) { clearTimeout(t); reject(new Error("The alerts worker didn’t install.")); return; }
    const check = () => {
      if (sw.state === "activated") { clearTimeout(t); resolve(); }
      if (sw.state === "redundant") { clearTimeout(t); reject(new Error("The alerts worker didn’t install.")); }
    };
    sw.addEventListener("statechange", check);
    check(); // it may have activated before the listener was attached
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  try { return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; }
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const cfg = await pushConfig();
  if (!cfg.enabled || !cfg.publicKey) return "off-server";
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}

function keyBytes(b64u: string): Uint8Array {
  const s = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${PUSH_API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: { error?: string } = {};
  try { data = await r.json(); } catch { /* empty */ }
  return { ok: r.ok, status: r.status, data };
}

/**
 * Switch alerts on for this device and wallet. Asks the browser for permission, then for the Lab
 * signature if it isn't already held (the same one saves use, good for a day).
 */
export async function enablePush(wallet: string, labWallet: LabWallet, topics: PushTopics = savedTopics()): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushSupported()) return { ok: false, error: "This browser can’t show alerts." };
  const cfg = await pushConfig();
  if (!cfg.enabled || !cfg.publicKey) return { ok: false, error: "Alerts aren’t switched on yet." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Notifications are blocked for this site. Allow them in the browser’s site settings." };

  let why = "";
  const labAuth = await getLabAuth(wallet, labWallet, "explicit", { fallbackSigner: wallet, onError: (m) => { why = m; } });
  if (!labAuth) return { ok: false, error: why || "Sign the Nexus message to turn alerts on." };

  let sub: PushSubscription;
  try {
    const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
    // Not navigator.serviceWorker.ready: that waits for a worker controlling THIS page, and the
    // alerts worker controls none, so it would never resolve.
    await activeWorker(reg);
    sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) as BufferSource });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn’t register this device." };
  }
  const r = await post("/push/subscribe", { wallet: wallet.toLowerCase(), subscription: sub.toJSON(), topics, labAuth });
  if (!r.ok) {
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    return { ok: false, error: r.status === 401 ? "The signature didn’t check out. Try again." : `Couldn’t save this device (${r.data.error || r.status}).` };
  }
  saveTopics(topics);
  return { ok: true };
}

/** Change which alerts this device gets. Needs the device to be on already. */
export async function updatePushTopics(wallet: string, labWallet: LabWallet, topics: PushTopics) {
  saveTopics(topics);
  const sub = await currentSubscription();
  if (!sub) return { ok: false as const, error: "Alerts are off on this device." };
  const labAuth = await getLabAuth(wallet, labWallet, "explicit", { fallbackSigner: wallet });
  if (!labAuth) return { ok: false as const, error: "Sign the Nexus message to change alerts." };
  const r = await post("/push/topics", { wallet: wallet.toLowerCase(), subscription: sub.toJSON(), topics, labAuth });
  return r.ok ? { ok: true as const } : { ok: false as const, error: `Couldn’t save (${r.data.error || r.status}).` };
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => null);
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  }
  const reg = await registration();
  try { await reg?.unregister(); } catch { /* ignore */ }
}

export async function sendTestPush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: false, error: "Alerts are off on this device." };
  const r = await post("/push/test", { endpoint: sub.endpoint });
  if (r.ok) return { ok: true };
  return { ok: false, error: r.status === 429 ? "One test a minute." : `Test failed (${r.data.error || r.status}).` };
}
