// The two pieces of phone alerts main.tsx needs at startup, kept free of wallet/SDK imports so the
// entry chunk doesn't grow. The rest lives in pushAlerts.ts and loads with the bell.

/** The alerts worker's scope: a path with no pages, so it never controls one (see push-sw.js). */
export const PUSH_SW_SCOPE = "/push/";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * A tapped alert asks an open app window to go to its page (the alerts worker controls no page,
 * so it can't navigate one). Routed through history so react-router picks it up without a reload.
 */
export function listenForPushTaps() {
  if (!pushSupported()) return;
  try {
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "nexus-open" || typeof d.url !== "string") return;
      let u: URL;
      try { u = new URL(d.url, location.origin); } catch { return; }
      if (u.origin !== location.origin) return;
      const path = u.pathname + u.search + u.hash;
      if (path === location.pathname + location.search + location.hash) return;
      history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    navigator.serviceWorker.startMessages?.();
  } catch { /* ignore */ }
}
