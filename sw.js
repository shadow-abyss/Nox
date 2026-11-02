/* Project NOX — offline service worker.
   Bump CACHE_VERSION whenever you ship changes so clients pick up the new build. */
const CACHE_VERSION = 'nox-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/nox.css',
  './js/db.js',
  './js/util.js',
  './js/ink.js',
  './js/mind.js',
  './js/pdfview.js',
  './js/app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first, refresh in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);

      return cached || network;
    })
  );
});
