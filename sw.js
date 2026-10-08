const CACHE_NAME = 'gts-pwa-v1';
const ASSETS = ['/', '/index.html', '/GLOBAL.png', '/EASYFLY TRANSIT.jpg'];

// Installation et mise en cache initiale
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Interception des requêtes
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});