// Service worker: makes the app work fully offline by caching the app shell.
const CACHE = 'look-inventory-v16';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/config.js',
  './js/flags.js',
  './js/i18n.js',
  './js/db.js',
  './js/scanner.js',
  './js/sync.js',
  './js/btprint.js',
  './js/barcode.js',
  './js/cloud.js',
  './js/license.js',
  './js/quiz.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// Let the page trigger activation of a freshly installed worker ("Refresh" button).
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept Google API / auth / Firebase CDN calls — they need the network.
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')
      || url.hostname.includes('gstatic.com') || url.hostname.includes('firebaseio.com')
      || url.hostname.includes('firestore.googleapis.com')) return;

  // Cache-first for our own app shell, fall back to network, then update cache.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
