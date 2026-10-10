// Phone alerts only. This worker shows pushes and opens the app when one is tapped. Nothing else.
//
// ⚠️ It must never get a fetch handler or touch the Cache API. The app's old service worker cached
// pages and crashed wallet in-app browsers after deploys (see sw.js). This one is registered with
// scope "/push/", a path with no pages, so it controls no page at all; push events reach it anyway.
// It is only registered when someone switches alerts on (app/lib/pushAlerts.ts).

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Nexus';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/push-badge.png',
    tag: data.tag || undefined,
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        // This worker controls no page, so it can't navigate one; the page routes itself on this
        // message (listenForPushTaps in app/lib/pushAlerts.ts).
        try { w.postMessage({ type: 'nexus-open', url }); } catch (e) { /* ignore */ }
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
