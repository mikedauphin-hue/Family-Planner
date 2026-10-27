self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let message;
    try { message = event.data.json(); } catch { return; }
    const scope = new URL(self.registration.scope);
    let target = new URL(message.url || './', scope);
    if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) target = scope;
    await self.registration.showNotification(message.title || 'Tomorrow’s family plan', {
      body: message.body || 'Open your planner to see tomorrow’s plans.',
      tag: `family-plan-${message.date || 'tomorrow'}`,
      icon: new URL('icon-192.png', scope).href,
      badge: new URL('icon-192.png', scope).href,
      data: { url: target.href },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = event.notification.data?.url || self.registration.scope;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
