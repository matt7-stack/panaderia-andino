const CACHE_NAME = 'mattsystem-pwa-v18';
const APP_SHELL = ['/app.bundle.html', '/employee-access.js', '/erp-modules.js', '/admin-nav.js', '/business-expenses.js', '/manifest.webmanifest', '/icons/icon.svg?v=3'];

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

  if (APP_SHELL.includes(url.pathname)) {
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) { if ('focus' in client) return client.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/app.bundle.html');
  })());
});
