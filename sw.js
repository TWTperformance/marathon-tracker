const CACHE_NAME = 'marathon-tracker-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './plan.js',
  './app.js',
  './sync.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for our own app files (so updates show up promptly when
// online), falling back to cache when offline. Never intercept Google API
// calls — let those hit the network directly and fail normally if offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // cache: 'no-store' bypasses the browser's own HTTP cache, not just the
  // service worker's — without this, a stale copy can keep being served
  // from disk cache even though this handler always tries the network first.
  const freshRequest = new Request(event.request, { cache: 'no-store' });

  event.respondWith(
    fetch(freshRequest)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
