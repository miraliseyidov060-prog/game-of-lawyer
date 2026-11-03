// Service worker: tətbiq qabığı oflayn açılır, yeniləmələr şəbəkədən gəlir.
// Supabase sorğuları (başqa origin) heç vaxt keşlənmir.
const VERSION = 'kalkhan-v4';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './vendor/supabase.js',
  './privacy.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './brand/emblem.png',
  './brand/wordmark.png',
  './brand/wordmark-dark.png',
  './brand/logo-full.png',
  './brand/logo-full-dark.png',
  './fonts/barlow-latin-500-normal.woff2',
  './fonts/barlow-latin-ext-500-normal.woff2',
  './fonts/barlow-latin-700-normal.woff2',
  './fonts/barlow-latin-ext-700-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/barlow-condensed-latin-ext-700-normal.woff2',
  './fonts/barlow-condensed-latin-800-normal.woff2',
  './fonts/barlow-condensed-latin-ext-800-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
