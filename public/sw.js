const CACHE_NAME = 'keepy-v1';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname === '/share' && e.request.method === 'POST') {
    e.respondWith(Response.redirect('/?shared=true', 303));
    e.waitUntil(
      (async () => {
        const data = await e.request.formData();
        const files = data.getAll('images');
        const allClients = await self.clients.matchAll({ type: 'window' });
        const target = allClients[0];
        if (target && files.length > 0) {
          const imageFiles = files.filter((f) => f.type.startsWith('image/'));
          if (imageFiles.length > 0) {
            target.postMessage({ type: 'shared-images', files: imageFiles });
          }
        }
      })()
    );
    return;
  }

  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
