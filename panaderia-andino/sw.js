const CACHE_NAME = 'mattsystem-pwa-v23';
const APP_SHELL = ['/app.bundle.html', '/employee-access.js', '/erp-modules.js', '/admin-nav.js', '/business-expenses.js', '/operations-tools.js?v=2', '/manifest.webmanifest', '/icons/icon.svg?v=3'];
const APP_SHELL_PATHS = new Set(APP_SHELL.map(path => new URL(path, self.location.origin).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Las operaciones y datos siempre se consultan al servidor; nunca se guardan en caché.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/app.bundle.html') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/app.bundle.html', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('/app.bundle.html')) || Response.error())
    );
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      }))
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(payload.title || 'MATTSYSTEM');
  const options = {
    body: String(payload.body || 'Tenés una nueva notificación.'),
    icon: '/icons/icon.svg?v=3',
    badge: '/icons/icon.svg?v=3',
    tag: String(payload.tag || 'mattsystem-push'),
    data: { url: String(payload.url || '/app.bundle.html#notificaciones') },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) { if ('focus' in client) { await client.focus(); if ('navigate' in client) return client.navigate(event.notification.data?.url || '/app.bundle.html#notificaciones'); return client; } }
    if (self.clients.openWindow) return self.clients.openWindow(event.notification.data?.url || '/app.bundle.html#notificaciones');
  })());
});
