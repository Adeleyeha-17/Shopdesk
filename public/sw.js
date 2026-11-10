// ShopDesk on the phone: shows alerts (new order, money in, a message...) and opens the right page when one is tapped.
// If ShopDesk is open on screen, the page updates itself instead of showing an alert.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let a = {};
  try {
    a = e.data ? e.data.json() : {};
  } catch (x) {
    a = { title: 'ShopDesk', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach((w) => w.postMessage({ type: 'shopdesk-alert', alert: a }));
      // a dot on the app icon until ShopDesk is opened (the app then shows the exact number)
      if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge().catch(() => {});
      if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
      await self.registration.showNotification(a.title || 'ShopDesk', {
        body: a.body || '',
        tag: a.tag || undefined,
        renotify: !!a.tag,
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        data: { url: a.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        if ('navigate' in w) await w.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
